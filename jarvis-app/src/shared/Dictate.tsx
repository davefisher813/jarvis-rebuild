import { useRef, type RefObject } from "react";
import { showToast } from "./toast";
import { haptics } from "./haptics";

// SPEAK THE REPLY, SPEAK THE FACT (UP-MIND-26, Email E4 and 5.8; Brain 5.0
// voice-first). Chosen option: lean on the keyboard's own dictation.
//
// Speech is about three times faster than a phone keyboard with fewer
// errors, and the ADHD capture failure happens at the moment of encoding: if
// getting the thought out takes a minute of thumbs, the thought is gone.
// Every phone this app runs on already has dictation, on the keyboard, one
// tap away, and most people have never noticed it is there.
//
// So this is a POINTER, not a feature: it focuses the field, which raises
// the keyboard, and the first time it says where the mic is. Zero native
// work, no plugin, no microphone permission, no Info.plist strings, and
// nothing to break in an App Store review. The words appear in the field the
// user is looking at, edited by them, and sent or saved by their tap, which
// is the law this item exists under: nothing sends or files without the
// words on screen first.
//
// The native path (a plugin, partial results streaming into the field) is
// option (a) and is not built. This does not pretend to be it: the button
// says Speak, the hint says where the mic is, and it promises nothing else.

const KEY = "jarvis.dictation.hint.v1";

export const DICTATION_HINT = "Tap the mic on your keyboard to talk";

export function hintSeen(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try { return storage.getItem(KEY) === "1"; } catch { return false; }
}

export function markHintSeen(storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(KEY, "1"); } catch { /* private mode: it says it again, which is harmless */ }
}

/** A quiet control beside a field. Focuses it, and says where the mic is the
 *  first time. Renders nothing when there is no field to focus. */
export default function Dictate({
  target,
  label = "Speak",
}: {
  target: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  label?: string;
}) {
  const said = useRef(false);
  return (
    <button
      type="button"
      className="quiet-action"
      onClick={() => {
        haptics.selection();
        target.current?.focus();
        // Once per device, and once per mount at most: a hint repeated every
        // time is an instruction the app thinks you cannot follow.
        if (said.current || hintSeen()) return;
        said.current = true;
        markHintSeen();
        showToast({ message: DICTATION_HINT });
      }}
    >{label}</button>
  );
}
