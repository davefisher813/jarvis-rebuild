import { apiUrl } from "../shared/apiBase";
import { backendConfigured } from "../data/store";
import { aiCallAllowed, effectiveLevel, refusalMessage, type AIPinKey } from "./aiGate";
import { getAIControl } from "./levelStore";

export interface AIMessage {
  role: "user" | "assistant";
  content: string | AIBlock[];
}

// Content blocks for vision requests: text plus at most one base64 image (the
// proxy enforces the same shape server-side).
export type AIBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

// One user message carrying a photo and an instruction, in the exact shape
// the proxy and Anthropic expect. Pure; tested.
export function buildVisionMessage(text: string, imageBase64: string, mediaType = "image/jpeg"): AIMessage {
  return {
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
      { type: "text", text },
    ],
  };
}

interface AIServiceOpts {
  endpoint?: string;
  available?: boolean;
  fetchImpl?: typeof fetch;
  getToken?: () => string | undefined;
}

// Client for the AI layer. It never holds the Anthropic key; it POSTs to the
// server function (/api/ai), which is the only thing that talks to Anthropic.
// "available" is false in the in-memory / no-backend build, so the UI can hide AI.
export class AIService {
  private endpoint: string;
  private fetchImpl: typeof fetch;
  private getToken?: () => string | undefined;
  readonly available: boolean;

  constructor(opts: AIServiceOpts = {}) {
    this.endpoint = opts.endpoint ?? apiUrl("/api/ai");
    this.fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.getToken = opts.getToken;
    this.available = opts.available ?? backendConfigured;
  }

  // tier "write": words that go out in the user's voice route to the stronger
  // model server-side (AI_MODEL_WRITE). Everything else stays on the default.
  //
  // schema (item 12): a JSON schema makes the proxy force a tool call, so the
  // returned text is guaranteed-valid JSON matching it. Callers keep their
  // tolerant parsers; the schema removes the reason those parsers ever fired
  // their fallbacks.
  //
  // AI Control (addendum items 18-21): every call declares what it is.
  // kind: a short slug for What Ran ("triage", "capture", "plan", ...).
  // background: true for anything the user did not just ask for (pre-generation).
  // pin: the per-feature pin this call rides under, when one exists.
  // The gate runs here first (so the UI can explain a refusal without a
  // round trip) and again authoritatively in the proxy against the stored
  // profile, so a client bug can never spend AI the user turned off.
  async complete(
    messages: AIMessage[],
    system?: string,
    opts?: { tier?: "write"; kind?: string; background?: boolean; pin?: AIPinKey; schema?: Record<string, unknown> },
  ): Promise<string> {
    if (!this.available) throw new Error("AI is not configured in this build.");
    const level = effectiveLevel(getAIControl(), opts?.pin);
    const background = opts?.background ?? false;
    if (!aiCallAllowed(level, background)) throw new Error(refusalMessage(level, background));
    const token = this.getToken?.();
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        messages,
        system,
        ...(opts?.tier ? { tier: opts.tier } : {}),
        ...(opts?.kind ? { kind: opts.kind } : {}),
        ...(background ? { background: true } : {}),
        ...(opts?.schema ? { schema: opts.schema } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`AI request failed (${res.status}). ${detail}`.trim());
    }
    const data = (await res.json()) as { text?: string };
    return data.text ?? "";
  }
}
