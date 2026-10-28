// THE SPEECH BOX, THE SERVER HALF (speech box path b; order of 2026-10-27).
//
// Reached only as a branch of POST /api/ai (header x-jarvis-transcribe), so the function budget law holds: no new route file. The
// caller is already authenticated and past the admin switch when this runs. The body is one recording; the answer is { text }.
//
// What this does and does not do:
//   - it turns audio into words and returns the words. It never writes anything, files anything or sends anything: the app puts the
//     words in an editable draft and the person's own tap is the only way out (Logging Standard rule 10).
//   - the audio is read, sent to the speech provider and dropped. It is not stored and not logged; only a count is kept (the same
//     ai_try_consume counter as every other AI call, kind "speech").
//   - the provider is any OpenAI-compatible transcription endpoint. Nothing is configured until TRANSCRIBE_API_KEY is set, and until
//     then the answer is TRANSCRIBE_NOT_CONFIGURED, which the app says in words, so a missing key is never a dead mic.
import { aiCallAllowed, effectiveLevel, refusalCode, refusalMessage, DEFAULT_AI_LEVEL, type AIControlState } from "../src/ai/aiGate";
import { MAX_AUDIO_BYTES, audioExtension, baseType, transcribeLine, transcribeRetryable, type TranscribeCode } from "../src/speech/wire";

const DEFAULT_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_MODEL = "gpt-4o-mini-transcribe";

export interface TranscribeCaller {
  supaUrl: string;
  supaAnon: string;
  token: string;
  userId: string;
}

const STATUS: Record<TranscribeCode, number> = {
  TRANSCRIBE_NOT_CONFIGURED: 503,
  TRANSCRIBE_TOO_LARGE: 413,
  TRANSCRIBE_BAD_AUDIO: 400,
  TRANSCRIBE_BUSY: 503,
  TRANSCRIBE_REJECTED: 502,
  TRANSCRIBE_RATE: 429,
  TRANSCRIBE_OFF: 403,
  TRANSCRIBE_AUTH: 401,
};

function refuse(code: TranscribeCode): Response {
  return new Response(JSON.stringify({ error: transcribeLine(code), code, retryable: transcribeRetryable(code) }), {
    status: STATUS[code],
    headers: { "content-type": "application/json" },
  });
}

/** A vendor status, as the code the app understands: a busy or rate-limited vendor can be asked again, anything else cannot. */
export function vendorCode(status: number): TranscribeCode {
  if (status === 429 || status >= 500) return "TRANSCRIBE_BUSY";
  return "TRANSCRIBE_REJECTED";
}

export async function transcribeRequest(req: Request, who: TranscribeCaller): Promise<Response> {
  const key = process.env.TRANSCRIBE_API_KEY;
  if (!key) return refuse("TRANSCRIBE_NOT_CONFIGURED");

  const type = baseType(req.headers.get("content-type"));
  const ext = audioExtension(type);
  if (!ext) return refuse("TRANSCRIBE_BAD_AUDIO");
  const maxBytes = Math.min(MAX_AUDIO_BYTES, parseInt(process.env.TRANSCRIBE_MAX_BYTES || String(MAX_AUDIO_BYTES), 10) || MAX_AUDIO_BYTES);
  const declared = parseInt(req.headers.get("content-length") || "0", 10);
  if (declared > maxBytes) return refuse("TRANSCRIBE_TOO_LARGE");

  // AI Control still rules: AI turned Off turns the server-side voice off with it (the keyboard's own mic is the phone's, not ours).
  let level = DEFAULT_AI_LEVEL;
  try {
    const pr = await fetch(`${who.supaUrl}/rest/v1/item?entity_type=eq.profile&select=data&order=updated_at.desc&limit=1`, {
      headers: { apikey: who.supaAnon, Authorization: `Bearer ${who.token}` },
    });
    if (pr.ok) {
      const rows = (await pr.json()) as { data?: { ai?: AIControlState } }[];
      level = effectiveLevel(rows[0]?.data?.ai);
    }
  } catch { /* the default level applies, as in the AI proxy */ }
  if (!aiCallAllowed(level, false)) {
    return new Response(JSON.stringify({ error: refusalMessage(level, false), code: refusalCode(level, false) }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  // The same counter every AI call is held to. Voice that cannot be counted does not run, like the AI proxy itself.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    if (process.env.AI_REQUIRE_LIMITS !== "0") return refuse("TRANSCRIBE_BUSY");
  } else {
    const rpc = await fetch(`${who.supaUrl}/rest/v1/rpc/ai_try_consume`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        p_user: who.userId,
        p_user_cap: parseInt(process.env.AI_RATE_PER_HOUR || "120", 10),
        p_global_cap: parseInt(process.env.AI_GLOBAL_PER_DAY || "2000", 10),
        p_kind: "speech",
      }),
    });
    if (rpc.ok) {
      const verdict = (await rpc.json()) as { allowed?: boolean; reason?: string };
      if (!verdict.allowed) return refuse(verdict.reason === "user" ? "TRANSCRIBE_RATE" : "TRANSCRIBE_BUSY");
    }
  }

  const audio = await req.arrayBuffer();
  if (audio.byteLength === 0) return refuse("TRANSCRIBE_BAD_AUDIO");
  if (audio.byteLength > maxBytes) return refuse("TRANSCRIBE_TOO_LARGE");

  const form = new FormData();
  form.append("file", new Blob([audio], { type }), `speech.${ext}`);
  form.append("model", process.env.TRANSCRIBE_MODEL || DEFAULT_MODEL);
  form.append("response_format", "json");
  const lang = process.env.TRANSCRIBE_LANGUAGE || "en";
  if (lang !== "auto") form.append("language", lang);

  let up: Response;
  try {
    up = await fetch(process.env.TRANSCRIBE_URL || DEFAULT_URL, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  } catch {
    return refuse("TRANSCRIBE_BUSY");
  }
  if (!up.ok) return refuse(vendorCode(up.status));
  let text = "";
  try {
    const j = (await up.json()) as { text?: unknown };
    text = typeof j.text === "string" ? j.text.trim() : "";
  } catch {
    return refuse("TRANSCRIBE_BUSY");
  }
  // Silence comes back as an empty string, which is an answer ("Nothing Heard"), not a failure. The audio is not kept.
  return new Response(JSON.stringify({ text }), { status: 200, headers: { "content-type": "application/json" } });
}
