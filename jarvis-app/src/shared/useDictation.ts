import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

// DICTATION INTO THE DRAFT (the Logging Standard, 2026-10-17). Speak used to
// focus the field and point at the keyboard's own mic, and where the field was
// already focused (Smart Paste autofocuses its box) the tap did nothing a
// person could see. This is the web half of the real thing: the browser's
// SpeechRecognition (Chrome, Edge, Safari 14.1+ as webkitSpeechRecognition),
// feature-detected, with interim results so the words appear while they are
// being said.
//
// The rules it lives under:
//   - the words land in the EDITABLE draft, through onText, and nothing is
//     committed by this hook; the person's own Capture or Send tap does that
//   - a tap asks for the microphone (the API itself prompts), shows a
//     Listening state, and a second tap stops
//   - a denied permission or a failed recognition is SAID, in a line the
//     person can read; a silent failure is a dead button
//   - where the API is absent, status is "unsupported" and the caller keeps
//     the keyboard-mic hint, shown every time, so the button never does nothing
//
// The native path for the iOS build is @capacitor-community/speech-recognition,
// a pod install and a real build, so it is deferred the way the keyboard
// accessory note in CLAUDE.md is; nothing here depends on it, and the hook is
// the one place that path would be wired in.

export type DictationStatus = "unsupported" | "idle" | "listening" | "error";

export interface Dictation {
  status: DictationStatus;
  /** What went wrong, in words for the screen, or null. */
  error: string | null;
  supported: boolean;
  start: () => void;
  stop: () => void;
}

interface ResultAlt { transcript: string }
interface ResultItem { isFinal: boolean; length: number; [i: number]: ResultAlt; 0: ResultAlt }
interface ResultEvent { resultIndex: number; results: { length: number; [i: number]: ResultItem } }
interface ErrorEvent { error: string }
export interface Recognizer {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognizerCtor = new () => Recognizer;

/** The constructor the page offers, or null. Looked up at call time so a test can plant one. */
export function recognizerCtor(): RecognizerCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** The error, as the line a person reads: one short Title Case line, as every line the app writes (shortCopy law). */
export function dictationErrorLine(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Allow the Microphone in Settings to Speak";
    case "no-speech":
      return "Nothing Heard, Try Again";
    case "audio-capture":
      return "No Microphone Found";
    case "network":
      return "Dictation Needs a Connection";
    default:
      return "Dictation Stopped, Try Again";
  }
}

export function useDictation({ onText, lang = "en-US" }: {
  /** The words so far: `final` false is the phrase still being said and will be
   *  replaced by the next call; `final` true is a phrase that is done and stays. */
  onText: (text: string, final: boolean) => void;
  lang?: string;
}): Dictation {
  const [supported] = useState(() => recognizerCtor() !== null);
  const [status, setStatus] = useState<DictationStatus>(supported ? "idle" : "unsupported");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognizer | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognizerCtor();
    if (!Ctor) { setStatus("unsupported"); return; }
    if (rec.current) return;
    let r: Recognizer;
    try { r = new Ctor(); } catch { setError(dictationErrorLine("")); setStatus("error"); return; }
    r.lang = lang;
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const item = e.results[i];
        if (!item) continue;
        const words = (item[0]?.transcript ?? "").trim();
        if (!words) continue;
        if (item.isFinal) onTextRef.current(words, true);
        else interim = interim ? interim + " " + words : words;
      }
      if (interim) onTextRef.current(interim, false);
    };
    r.onerror = (e) => {
      // "aborted" is our own stop, not a failure to report.
      if (e.error === "aborted") return;
      setError(dictationErrorLine(e.error));
      setStatus("error");
    };
    r.onend = () => {
      rec.current = null;
      setStatus((s) => (s === "error" ? s : "idle"));
    };
    rec.current = r;
    setError(null);
    setStatus("listening");
    try { r.start(); } catch { rec.current = null; setError(dictationErrorLine("")); setStatus("error"); }
  }, [lang]);

  // Leaving the screen ends the session; words that have nowhere to land are dropped.
  useEffect(() => () => { rec.current?.abort(); rec.current = null; }, []);

  return { status, error, supported, start, stop };
}

/** Appends spoken words to a draft held in React state. `held` remembers the
 *  draft as it was before the phrase being said, so each interim replaces the
 *  last rather than piling up; a final phrase lets it go, and the caller
 *  clears it (`held.current = null`) whenever the person types, so a phrase
 *  never lands on a stale base. */
export function spokenInto(held: MutableRefObject<string | null>, cur: string, words: string, final: boolean): string {
  const base = held.current ?? cur;
  held.current = final ? null : base;
  return joinSpoken(base, words);
}

/** "Call Marco" after "Dinner Thursday" reads "Dinner Thursday Call Marco": one space between, none at the start. */
export function joinSpoken(base: string, words: string): string {
  if (!base) return words;
  return /\s$/.test(base) ? base + words : base + " " + words;
}
