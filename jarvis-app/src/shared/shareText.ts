// UP-ATH-05 (2026-09-06): handing a piece of TEXT to whatever the person
// already uses to reach people, as opposed to saveTextFile.ts next door,
// which hands over a FILE. Still There?'s dated summary wants a message, not
// an attachment, and an athlete with no trusted adult saved still has to be
// able to get the summary out of the phone.
//
// NATIVE (Capacitor iOS/Android): the OS share sheet, same plugin
// saveTextFile.ts uses.
// WEB: the browser's own share sheet where there is one, and the clipboard
// where there is not, which is the only honest fallback a page has.
//
// Resolves "shared" or "copied" when the text left, false when the person
// dismissed the sheet without sending it anywhere. Throws on a genuine
// failure, so no caller can ever report success for a share that did not
// happen (the same contract saveTextFile.ts already carries).
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";

export type ShareTextResult = "shared" | "copied" | false;

// @capacitor/share 8 REJECTS on a cancel with the message "Share canceled"
// (SharePlugin.swift:63, SharePlugin.java:60), and the Web Share API rejects
// an abandoned sheet with an AbortError. Both are a cancel; everything else
// is a real error.
function isShareCancel(e: unknown): boolean {
  if (e && typeof e === "object" && "name" in e && (e as { name?: string }).name === "AbortError") return true;
  const m = e instanceof Error ? e.message : String(e ?? "");
  return /share cancell?ed/i.test(m) || /abort/i.test(m);
}

// UP-ATH-11 (2026-09-06): the explicit Copy the web needs. A browser with no
// share sheet still has to be able to get a report out of the page, and a
// button labelled Copy that quietly opened a share sheet instead would be a
// different action than the one the person tapped. Throws when the clipboard
// is unavailable, so the caller says so rather than claiming a copy.
export async function copyText(text: string): Promise<void> {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  if (!nav?.clipboard?.writeText) throw new Error("No clipboard in this browser");
  await nav.clipboard.writeText(text);
}

export async function shareText(text: string, title?: string): Promise<ShareTextResult> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ title, text });
    } catch (e) {
      if (isShareCancel(e)) return false;
      throw e;
    }
    return "shared";
  }
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  if (nav?.share) {
    try {
      await nav.share({ title, text });
    } catch (e) {
      if (isShareCancel(e)) return false;
      throw e;
    }
    return "shared";
  }
  if (!nav?.clipboard?.writeText) throw new Error("No way to share from this browser");
  await nav.clipboard.writeText(text);
  return "copied";
}
