// HMN-F-22 (2026-09-05): "Export This Log" on Take This to the Doctor was a
// toast of the report's first line and nothing else -- it exported nothing.
// This is the same handoff backup/exportFile.ts established in S3-Q16 and
// tasks/ics.ts adopted in TODAY-F-03, generalised to plain text so the next
// screen that wants to hand a file to the OS does not write a third copy of
// it. Those two callers keep their own copies for now: they carry their own
// filename and mime rules and their own tests, and rewriting them was not
// this finding's blast radius.
//
// NATIVE (Capacitor iOS/Android): the blob-and-anchor-click a browser honors
// is silently ignored inside the iOS WKWebView, so the file is written to the
// app's cache and handed to the OS share sheet.
// WEB: the anchor click, which a real browser does honor.
//
// Resolves true when the file left the app, false when the person dismissed
// the share sheet without sending it anywhere. Throws on a genuine failure,
// so the caller can never report success for an export that did not happen.
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

// @capacitor/share 8 REJECTS on a cancel, with the message "Share canceled"
// on both iOS (SharePlugin.swift:63) and Android (SharePlugin.java:60). That
// one message is a cancel; every other rejection is a real error.
function isShareCancel(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e ?? "");
  return /share cancell?ed/i.test(m);
}

export async function saveTextFile(
  text: string,
  filename: string,
  opts: { title?: string; mime?: string } = {},
): Promise<boolean> {
  const mime = opts.mime ?? "text/plain;charset=utf-8";
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    try {
      await Share.share({ title: opts.title ?? filename, files: [uri] });
    } catch (e) {
      if (isShareCancel(e)) return false;
      throw e;
    }
    return true;
  }
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick: revoking synchronously can cancel the download
  // on Safari before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
