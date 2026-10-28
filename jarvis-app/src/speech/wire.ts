// THE SPEECH BOX, THE SHARED HALF (the Logging Standard, speech box path b; Dave, 2026-10-16 and the order of 2026-10-27).
//
// The app records audio and the server turns it into words. Browser speech recognition inside the installed iOS app is not
// dependable, so it is not the build: a recording is. One header on POST /api/ai (no new route file, the function budget law) marks
// the call, and the body is the audio itself. What comes back is TEXT, and text is all it ever is: the words land in an editable
// draft and the person's own tap files them. Nothing on this path saves, sends or logs anything.
//
// This file is read by both sides (api/_transcribe.ts and the app), so it holds only constants and words.

export const TRANSCRIBE_HEADER = "x-jarvis-transcribe";

/** Longest recording, in seconds. The recorder stops itself here; the server's byte cap is the second fence. */
export const MAX_RECORD_SECONDS = 90;
/** The server refuses more audio than this (bytes). 90 seconds of phone audio is well under it. */
export const MAX_AUDIO_BYTES = 3_000_000;

export type TranscribeCode =
  | "TRANSCRIBE_NOT_CONFIGURED"
  | "TRANSCRIBE_TOO_LARGE"
  | "TRANSCRIBE_BAD_AUDIO"
  | "TRANSCRIBE_BUSY"
  | "TRANSCRIBE_REJECTED"
  | "TRANSCRIBE_RATE"
  | "TRANSCRIBE_OFF"
  | "TRANSCRIBE_AUTH";

/** The audio types the server will take, by the type the recorder reports (parameters such as codecs are ignored). */
export const AUDIO_TYPES: Readonly<Record<string, string>> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "m4a",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

/** "audio/webm;codecs=opus" -> "audio/webm". */
export function baseType(contentType: string | null | undefined): string {
  return (contentType ?? "").split(";")[0]!.trim().toLowerCase();
}

/** The file extension for a type the server accepts, or null. */
export function audioExtension(contentType: string | null | undefined): string | null {
  return AUDIO_TYPES[baseType(contentType)] ?? null;
}

// The line a person reads when the recording path fails: cause, then what to do, two short Title Case fragments (shortCopy law).
const LINES: Record<TranscribeCode, string> = {
  TRANSCRIBE_NOT_CONFIGURED: "Voice Isn't Set Up Yet · Use the Keyboard Mic",
  TRANSCRIBE_TOO_LARGE: "That Was Too Long · Try a Shorter Clip",
  TRANSCRIBE_BAD_AUDIO: "That Didn't Record · Try Again",
  TRANSCRIBE_BUSY: "Voice Is Busy · Try Again",
  TRANSCRIBE_REJECTED: "Voice Couldn't Read That · Use the Keyboard Mic",
  TRANSCRIBE_RATE: "Too Many Recordings · Try Again Shortly",
  TRANSCRIBE_OFF: "AI Is Off · Use the Keyboard Mic",
  TRANSCRIBE_AUTH: "Sign In Again · Then Try Voice",
};

export function transcribeLine(code: string): string {
  return (LINES as Record<string, string>)[code] ?? "Voice Stopped · Try Again";
}

/** Would a second try, a moment later, plausibly work? Only then is a retry offered. */
export function transcribeRetryable(code: string): boolean {
  return code === "TRANSCRIBE_BUSY" || code === "TRANSCRIBE_BAD_AUDIO" || code === "TRANSCRIBE_RATE";
}
