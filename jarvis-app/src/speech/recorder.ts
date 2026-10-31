// THE RECORDER (speech box, 2026-10-27). One recording at a time, from the microphone to a Blob. It knows nothing about words: the
// hook (shared/useDictation) sends the Blob to the server and puts what comes back in a draft.
import { MAX_RECORD_SECONDS } from "./wire";

export interface Recording {
  /** Stops and resolves with the clip (null if nothing was captured). Safe to call twice. */
  stop: () => Promise<Blob | null>;
  /** Stops and throws the clip away. */
  cancel: () => void;
  /** The live microphone, for a level meter beside the recording (the speech box's waveform, 2026-10-31). Ends with the clip. */
  stream: MediaStream;
}

/** What this page can record with, looked up at call time so a test can plant one. */
export function recordingSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const w = window as unknown as { MediaRecorder?: unknown };
  return typeof w.MediaRecorder === "function" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function";
}

/** The best type this recorder will write: Safari writes MP4/AAC, Chrome writes WebM/Opus. Empty lets the browser choose. */
export function pickMimeType(): string {
  const MR = (window as unknown as { MediaRecorder: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder;
  for (const t of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
    try { if (MR.isTypeSupported?.(t)) return t; } catch { /* try the next */ }
  }
  return "";
}

/** Asks for the microphone and starts recording. Rejects with the browser's own error name ("NotAllowedError", "NotFoundError"). */
export async function startRecording(opts: { maxSeconds?: number; onAutoStop?: () => void } = {}): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = pickMimeType();
  let rec: MediaRecorder;
  try {
    rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  const chunks: Blob[] = [];
  let finished: Promise<Blob | null> | null = null;
  let discarded = false;
  const release = () => stream.getTracks().forEach((t) => t.stop());
  rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  const done = new Promise<Blob | null>((resolve) => {
    rec.onstop = () => {
      release();
      if (timer) clearTimeout(timer);
      resolve(discarded || chunks.length === 0 ? null : new Blob(chunks, { type: rec.mimeType || mime || chunks[0]?.type || "audio/webm" }));
    };
    rec.onerror = () => { release(); resolve(null); };
  });
  const halt = () => { try { if (rec.state !== "inactive") rec.stop(); else release(); } catch { release(); } };
  const timer: ReturnType<typeof setTimeout> | null = setTimeout(() => { halt(); opts.onAutoStop?.(); }, (opts.maxSeconds ?? MAX_RECORD_SECONDS) * 1000);
  rec.start();
  return {
    stop: () => { finished ??= (halt(), done); return finished; },
    cancel: () => { discarded = true; halt(); },
    stream,
  };
}
