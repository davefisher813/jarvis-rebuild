// A FILE OF ANY KIND LEAVES THE APP (the writing system, wave 2, 2026-09-14).
// saveTextFile.ts next door hands over text; a PDF or a Word file is bytes.
//
// NATIVE (Capacitor iOS/Android): the bytes go to the app's cache as base64
// and the OS share sheet takes the file, the way saveTextFile does.
// WEB: the browser's share sheet when it can carry files (feature-detected
// with navigator.canShare({ files }), so nothing is claimed that the browser
// cannot do), and a download otherwise.
//
// Resolves "shared" or "downloaded" when the file left, false when the
// person dismissed the sheet, and throws on a real failure, so no caller can
// report an export that did not happen. Nothing here says the file reached
// Files or another app: the browser cannot know that, and neither can we.
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

export type SaveFileResult = "shared" | "downloaded" | false;

function isShareCancel(e: unknown): boolean {
  if (e && typeof e === "object" && "name" in e && (e as { name?: string }).name === "AbortError") return true;
  const m = e instanceof Error ? e.message : String(e ?? "");
  return /share cancell?ed/i.test(m) || /abort/i.test(m);
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error("Could not read the file"));
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.readAsDataURL(blob);
  });
}

/** Whether the share sheet on this browser can take a file at all. */
export function canShareFiles(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  if (!nav?.share || typeof nav.canShare !== "function" || typeof File === "undefined") return false;
  try { return nav.canShare({ files: [new File(["x"], "x.txt", { type: "text/plain" })] }); } catch { return false; }
}

export async function saveFile(blob: Blob, filename: string, opts: { title?: string } = {}): Promise<SaveFileResult> {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({ path: filename, data: await toBase64(blob), directory: Directory.Cache });
    try {
      await Share.share({ title: opts.title ?? filename, files: [uri] });
    } catch (e) {
      if (isShareCancel(e)) return false;
      throw e;
    }
    return "shared";
  }
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  if (nav?.share && typeof nav.canShare === "function" && typeof File !== "undefined") {
    const file = new File([blob], filename, { type: blob.type });
    let can = false;
    try { can = nav.canShare({ files: [file] }); } catch { can = false; }
    if (can) {
      try {
        await nav.share({ files: [file], title: opts.title ?? filename });
      } catch (e) {
        if (isShareCancel(e)) return false;
        throw e;
      }
      return "shared";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
