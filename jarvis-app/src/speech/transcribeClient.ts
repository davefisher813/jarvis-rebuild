// The app's half of the speech call: POST the recording to /api/ai with the speech header, get the words back. Typed failures, so
// the hook can say what is actually wrong (the same rule as the chat's AI failures).
import { apiUrl } from "../shared/apiBase";
import { TRANSCRIBE_HEADER, baseType, transcribeLine, transcribeRetryable } from "./wire";

export class TranscribeError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string) {
    super(transcribeLine(code));
    this.name = "TranscribeError";
    this.code = code;
    this.retryable = transcribeRetryable(code);
  }
}

export interface TranscribeOpts {
  token: string | undefined;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  signal?: AbortSignal;
}

/** The words in one recording, trimmed; "" when nothing was heard. Throws TranscribeError. */
export async function transcribeAudio(clip: Blob, opts: TranscribeOpts): Promise<string> {
  if (!opts.token) throw new TranscribeError("TRANSCRIBE_AUTH");
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let res: Response;
  try {
    res = await doFetch(opts.endpoint ?? apiUrl("/api/ai"), {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.token}`, "content-type": baseType(clip.type) || "audio/webm", [TRANSCRIBE_HEADER]: "1" },
      body: clip,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new TranscribeError("TRANSCRIBE_BUSY");
  }
  if (res.ok) {
    const j = (await res.json().catch(() => ({}))) as { text?: unknown };
    return typeof j.text === "string" ? j.text.trim() : "";
  }
  let code = "";
  try { code = String(((await res.json()) as { code?: unknown }).code ?? ""); } catch { /* no body */ }
  if (!code) code = res.status === 401 ? "TRANSCRIBE_AUTH" : res.status === 413 ? "TRANSCRIBE_TOO_LARGE" : res.status === 429 ? "TRANSCRIBE_RATE" : "TRANSCRIBE_BUSY";
  // An AI Control refusal arrives with the gate's own code; voice reads it as Off.
  if (code.startsWith("AI_")) code = "TRANSCRIBE_OFF";
  throw new TranscribeError(code);
}
