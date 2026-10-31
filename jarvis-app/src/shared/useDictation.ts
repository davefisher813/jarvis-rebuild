import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { useOptionalSession } from "../auth/AuthProvider";
import { backendConfigured } from "../data/store";
import { recordingSupported, startRecording, type Recording } from "../speech/recorder";
import { TranscribeError, transcribeAudio } from "../speech/transcribeClient";

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
// THE SPEECH BOX (2026-10-27, Dave's order). Where the page can record audio (MediaRecorder and a microphone) and the app has its
// backend, Speak RECORDS, and the recording goes to the server to be turned into words (speech/, api/_transcribe.ts). The browser's
// SpeechRecognition below is what is left for a page that cannot record, because it is not dependable in the installed iOS app.
// The contract is unchanged for every caller: the words arrive once, `final` true, into the editable draft, and this hook commits
// nothing. A recording has no interim words, so the person sees Listening, then Writing It Down, then the draft.
//
// The native path for the iOS build is @capacitor-community/speech-recognition,
// a pod install and a real build, so it is deferred the way the keyboard
// accessory note in CLAUDE.md is; nothing here depends on it, and the hook is
// the one place that path would be wired in.

export type DictationStatus = "unsupported" | "idle" | "listening" | "transcribing" | "error";

export interface Dictation {
  status: DictationStatus;
  /** What went wrong, in words for the screen, or null. */
  error: string | null;
  supported: boolean;
  start: () => void;
  stop: () => void;
  /** The live microphone while recording (null otherwise), for the waveform (2026-10-31). */
  stream: MediaStream | null;
  /** When the recording started (ms), for the timer. */
  startedAt: number | null;
  /** A clip that could not be turned into words is kept for one more try, so a blinked network never costs the sentence. */
  canRetry: boolean;
  retry: () => void;
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
  // NEVER ON AN IPHONE OR IN THE INSTALLED APP (Alfred's order, 2026-10-31: "in-page iOS speech recognition is unreliable and is
  // a settled mistake, do not use it"; the 2026-10-28 research: inside an installed web app it silently stops working). There
  // the voice is recorded and transcribed on the server, or the keyboard's own mic is pointed at; a desktop browser keeps it.
  if (recognizerBarred()) return null;
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** An iPhone or iPad, or the app opened from the home screen: the places the page's own recognizer cannot be trusted. */
export function recognizerBarred(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
  const standalone = (navigator as unknown as { standalone?: boolean }).standalone === true
    || (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
  return ios || standalone;
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

/** The browser's own error name for a refused microphone, as the recognizer's code, so one set of lines serves both paths. */
function micErrorCode(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "not-allowed";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "audio-capture";
  return "";
}

export function useDictation({ onText, lang = "en-US" }: {
  /** The words so far: `final` false is the phrase still being said and will be
   *  replaced by the next call; `final` true is a phrase that is done and stays. */
  onText: (text: string, final: boolean) => void;
  lang?: string;
}): Dictation {
  const session = useOptionalSession();
  const tokenRef = useRef<string | undefined>(session?.access_token);
  tokenRef.current = session?.access_token;
  const [canRecord] = useState(() => backendConfigured && recordingSupported());
  const [supported] = useState(() => canRecord || recognizerCtor() !== null);
  const [status, setStatus] = useState<DictationStatus>(supported ? "idle" : "unsupported");
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const kept = useRef<Blob | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const rec = useRef<Recognizer | null>(null);
  const clip = useRef<Recording | null>(null);
  const starting = useRef(false);
  const stopWanted = useRef(false); // a second tap that landed while the microphone was still being granted
  const working = useRef(false); // the clip is being turned into words: a new recording waits
  const gone = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const fail = useCallback((line: string) => { if (!gone.current) { setError(line); setStatus("error"); } }, []);

  // The recording path: stop the clip, send it, put the words in the draft. Leaving the screen drops the words.
  const send = useCallback(async (blob: Blob) => {
    working.current = true;
    setStatus("transcribing");
    setCanRetry(false);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const words = await transcribeAudio(blob, { token: tokenRef.current, signal: ctl.signal });
      if (gone.current) return;
      if (!words) { fail(dictationErrorLine("no-speech")); return; }
      kept.current = null;
      setError(null);
      setStatus("idle");
      onTextRef.current(words, true);
    } catch (e) {
      if (gone.current || (e instanceof DOMException && e.name === "AbortError")) return;
      // Keep the clip: a network that blinked or a server that was busy is not a reason to say the sentence again. A
      // missing key or a refused level is, so those are not offered again.
      const again = e instanceof TranscribeError ? e.retryable : true;
      kept.current = again ? blob : null;
      setCanRetry(again);
      fail(e instanceof TranscribeError ? e.message : dictationErrorLine(""));
    } finally {
      abort.current = null;
      working.current = false;
    }
  }, [fail]);

  const finishRecording = useCallback(async () => {
    const r = clip.current;
    if (!r) return;
    clip.current = null;
    setStream(null);
    setStartedAt(null);
    working.current = true;
    setStatus("transcribing");
    const blob = await r.stop();
    if (gone.current) { working.current = false; return; }
    if (!blob) { working.current = false; fail(dictationErrorLine("no-speech")); return; }
    await send(blob);
  }, [fail, send]);

  const retry = useCallback(() => {
    const b = kept.current;
    if (!b || working.current) return;
    void send(b);
  }, [send]);

  const stop = useCallback(() => {
    if (clip.current) { void finishRecording(); return; }
    if (starting.current) { stopWanted.current = true; return; }
    rec.current?.stop();
  }, [finishRecording]);

  const startRecorded = useCallback(() => {
    if (clip.current || starting.current || working.current) return;
    starting.current = true;
    stopWanted.current = false;
    setError(null);
    setStatus("listening");
    startRecording({ onAutoStop: () => { void finishRecording(); } }).then(
      (r) => {
        starting.current = false;
        if (gone.current) { r.cancel(); return; }
        clip.current = r;
        setStream(r.stream ?? null);
        setStartedAt(Date.now());
        if (stopWanted.current) { stopWanted.current = false; void finishRecording(); }
      },
      (e: unknown) => { starting.current = false; fail(dictationErrorLine(micErrorCode(e))); },
    );
  }, [fail, finishRecording]);

  const start = useCallback(() => {
    if (canRecord) { startRecorded(); return; }
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
  }, [lang, canRecord, startRecorded]);

  // Leaving the screen ends the session; words that have nowhere to land are dropped.
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      rec.current?.abort();
      rec.current = null;
      clip.current?.cancel();
      clip.current = null;
      abort.current?.abort();
    };
  }, []);

  return { status, error, supported, start, stop, stream, startedAt, canRetry, retry };
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
