import { useRef, type RefObject } from "react";
import { showToast } from "./toast";
import { haptics } from "./haptics";
import { useDictation } from "./useDictation";

// SPEAK THE REPLY, SPEAK THE FACT (UP-MIND-26, Email E4 and 5.8; Brain 5.0
// voice-first). Speech is about three times faster than a phone keyboard
// with fewer errors, and the ADHD capture failure happens at the moment of
// encoding: if getting the thought out takes a minute of thumbs, the thought
// is gone.
//
// Until 2026-10-17 this was a POINTER: it focused the field and, once per
// device, said where the keyboard's mic is. Where the field was already
// focused (Smart Paste autofocuses its box) the tap did nothing visible, and
// a hint shown once is no hint the second time. It is the thing itself now,
// through useDictation (the browser's SpeechRecognition, feature-detected):
// tap, allow the microphone, the button says Listening, the words land in
// the draft as they are said, tap again to stop. Nothing is committed by this
// control; the person's own Capture or Send tap is still the only way out,
// which is the law this item exists under: nothing sends or files without
// the words on screen first.
//
// Where the API is absent the old pointer stays, and the hint now shows EVERY
// time, because a button that does nothing is a dead button.

const KEY = "jarvis.dictation.hint.v1";

export const DICTATION_HINT = "Tap the Mic on Your Keyboard to Talk"; // Title Case, a toast (2026-10-05)

/** Kept for the callers that read it; the hint is no longer shown once only. */
export function hintSeen(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try { return storage.getItem(KEY) === "1"; } catch { return false; }
}

export function markHintSeen(storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(KEY, "1"); } catch { /* private mode: it says it again, which is harmless */ }
}

/** A quiet control beside a field. With dictation: Speak, then Listening with
 *  a second tap to stop, the words arriving through onText; a failure is a
 *  line under it. Without: focuses the field and says where the mic is. */
export default function Dictate({
  target,
  label = "Speak",
  onText,
}: {
  target: RefObject<HTMLElement | null>;
  label?: string;
  /** The words as they are said (`final` false, replaced by the next call) and
   *  as they settle (`final` true). The caller writes them into its draft. */
  onText?: (text: string, final: boolean) => void;
}) {
  const sink = useRef(onText);
  sink.current = onText;
  const d = useDictation({ onText: (t, f) => sink.current?.(t, f) });
  const live = d.supported && !!onText;
  const listening = d.status === "listening";
  return (
    <>
      <button
        type="button"
        className="quiet-action"
        aria-pressed={live ? listening : undefined}
        onClick={() => {
          haptics.selection();
          target.current?.focus();
          if (!live) { markHintSeen(); showToast({ message: DICTATION_HINT }); return; }
          if (listening) d.stop(); else d.start();
        }}
      >{listening ? "Listening" : label}</button>
      {live && d.status === "error" && d.error && <span className="input-error" role="alert">{d.error}</span>}
    </>
  );
}
