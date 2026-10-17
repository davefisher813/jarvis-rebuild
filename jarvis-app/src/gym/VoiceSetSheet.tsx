import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MeasureKind, SetEntry } from "./types";
import { logButtonLabel } from "./measures";
import { parseVoiceSet, voiceEntry, voiceExample, voiceReadBack, voiceSpoken } from "./voiceSet";
import { voiceDraftStore } from "./sessionDrafts";
import { useDictation, spokenInto } from "../shared/useDictation";
import { DICTATION_HINT } from "../shared/Dictate";
import { speak, stopSpeaking } from "../messages/readAloud";
import { haptics } from "../shared/haptics";

// LOG A SET BY VOICE, AS A TEST (the Logging Standard, addendum 5,
// 2026-10-17; Dave delegated "Whatever is standard", Alfred ruled the same
// day). The adopted standard, in order:
//   1. A DELIBERATE PHRASE STARTS IT. "Log" leads the words ("Log 225 for 5",
//      "Log same", "Log done"); anything else is read as nothing, so a bare
//      "yes" never logs (voiceSet.ts).
//   2. THE APP READS THE SET BACK. On screen as the words change ("Log 225
//      Lb × 5 on Bench Press"), and aloud once, when a phrase spoken through
//      Speak first reads as a set. Typed or keyboard-dictated words are read
//      back on screen only: speaking at every keystroke would talk over him.
//   3. HE CONFIRMS. One tap on the primary button, or Return in the field.
//      Nothing is logged without it; a valid read-back alone writes nothing.
//   4. UNDO AFTER. The sheet closes and hands the entry to onLog; the CALLER
//      writes it and raises the receipt with Undo, the same toast every
//      other logging door raises. The sheet closes BEFORE onLog runs: a
//      toast raised under an open sheet is painted behind the scrim and its
//      Undo cannot be tapped (CLAUDE.md, Email 2026-10-13).
// Tapping the big Log button stays the primary way to log a set; this sheet
// has to beat it in a real gym before it is treated as the better path.
//
// VOICE, TWO HONEST PATHS (the standard's speech box). The field opens
// focused with the keyboard up, so the keyboard's own mic (path a) works on
// every device with zero build. Where the browser offers SpeechRecognition,
// Speak listens in the app too (shared/useDictation); where it does not, no
// Speak button is drawn and the line under the field says where the mic is,
// every time, rather than a button that does nothing. A toast would not do:
// it would sit behind this sheet.
//
// The words survive a kill (rule 8) when the caller names the session and
// exercise (`draftScope`); the confirm spends them.

export default function VoiceSetSheet({ name, kind, unit, timeUnit, sided, lastSet, draftScope, onLog, onClose }: {
  /** The exercise he is standing at, as the session names it. */
  name: string;
  kind: MeasureKind;
  unit?: string;
  timeUnit?: string;
  sided?: boolean;
  /** The last WORKING set already logged on this exercise (never a warm-up):
   *  what "Log same" repeats and where "Log 8 reps" takes its weight. */
  lastSet?: SetEntry;
  /** The live session's startedAt and this exercise's id, to keep the words
   *  through a kill. Absent, the words live in the field alone. */
  draftScope?: { startedAt: number; exerciseId: string };
  /** The confirmed set: a fresh id and state "reported". The caller writes it
   *  and raises the receipt with Undo. Called once, after onClose. */
  onLog: (entry: SetEntry) => void;
  onClose: () => void;
}) {
  const measure = useMemo(() => ({ kind, ...(unit ? { unit } : {}), ...(timeUnit ? { timeUnit } : {}), ...(sided ? { sided } : {}) }),
    [kind, unit, timeUnit, sided]);
  const draft = draftScope ? voiceDraftStore(draftScope.startedAt, draftScope.exerciseId) : null;
  const [text, setTextState] = useState(() => draft?.read() ?? "");
  const textRef = useRef(text);
  const held = useRef<string | null>(null);
  const spent = useRef(false);
  const field = useRef<HTMLInputElement>(null);

  const setText = (next: string) => {
    textRef.current = next;
    setTextState(next);
    draft?.write(next);
  };

  const read = parseVoiceSet(text, measure, lastSet);

  const dictation = useDictation({
    onText: (words, final) => {
      const next = spokenInto(held, textRef.current, words, final);
      setText(next);
      if (!final) return;
      // THE READ-BACK, ALOUD, ONCE. The microphone is closed first, or the
      // recognizer would hear the app's own voice and write it into the field.
      const heard = parseVoiceSet(next, measure, lastSet);
      if (!heard.ok) return;
      dictation.stop();
      speak(voiceSpoken(name, measure, heard.set));
    },
  });
  const listening = dictation.status === "listening";

  // Leaving the sheet ends the voice with it.
  useEffect(() => () => stopSpeaking(), []);

  const confirm = () => {
    if (!read.ok || spent.current) return;
    spent.current = true;
    haptics.confirm(); // a tap that commits (shared/haptics)
    if (listening) dictation.stop();
    draft?.clear();
    const entry = voiceEntry(read.set);
    onClose();
    onLog(entry);
  };

  const toggleSpeak = () => {
    haptics.selection();
    field.current?.focus();
    if (listening) { dictation.stop(); return; }
    // Each Speak is one set: the field starts empty so the new words never
    // land behind the last ones.
    held.current = null;
    setText("");
    dictation.start();
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" role="dialog" aria-label="Log a Set by Voice" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Log by Voice</div></div>
        <div className="pad-x sheet-form">
          <input
            ref={field}
            className="input"
            aria-label="Say or Type the Set"
            placeholder={voiceExample(kind)}
            value={text}
            autoFocus
            autoComplete="off"
            enterKeyHint="go"
            onChange={(e) => { held.current = null; setText(e.target.value); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirm(); } }}
          />
          {dictation.supported && (
            <div className="msg-quiet-acts">
              <button type="button" className="quiet-action" aria-pressed={listening} onClick={toggleSpeak}>
                {listening ? "Listening" : "Speak"}
              </button>
            </div>
          )}
          {dictation.status === "error" && dictation.error && <div className="input-error" role="alert">{dictation.error}</div>}
          {/* ONE LINE UNDER THE FIELD, saying the one thing that matters now:
              the set as it will be written, why the words are not a set yet,
              or, on an empty field with no in-app speech, where the mic is. */}
          <div role="status" aria-live="polite">
            {read.ok
              ? <div className="voice-readback">{voiceReadBack(name, measure, read.set)}</div>
              : text.trim()
                ? <div className="input-hint">{read.reason}</div>
                : !dictation.supported && <div className="input-hint">{DICTATION_HINT}</div>}
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button type="button" className="btn btn-primary btn-launch btn-block" disabled={!read.ok} onClick={confirm}>
            {logButtonLabel(measure, null)}
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
