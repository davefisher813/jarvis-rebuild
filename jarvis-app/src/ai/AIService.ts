import { apiUrl } from "../shared/apiBase";
import { backendConfigured } from "../data/store";
import { aiCallAllowed, effectiveLevel, refusalMessage, type AIPinKey } from "./aiGate";
import { getAIControl } from "./levelStore";
import { wireSystem, type AISystem } from "./systemPrompt";
import { AIBudgetError, isBudgetCode } from "./aiBudget";
import { budgetBlocked, clearBudgetBlock, noteBudgetRefusal } from "./budgetBlock";

export type { AISystem } from "./systemPrompt";

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
  // UP-PLAT-02 (2026-09-06): `system` may now be split into the assembled
  // context and this feature's instructions, which is what lets the proxy
  // mark the context as cacheable (0.1x the input price on a read, five
  // minute TTL). wireSystem decides: split when the block is big enough to
  // cache, one plain string otherwise. A caller passing a string is
  // untouched. See ai/systemPrompt.ts.
  async complete(
    messages: AIMessage[],
    system?: string | AISystem,
    opts?: { tier?: "write"; kind?: string; background?: boolean; pin?: AIPinKey; schema?: Record<string, unknown> },
  ): Promise<string> {
    if (!this.available) throw new Error("AI is not configured in this build.");
    const level = effectiveLevel(getAIControl(), opts?.pin);
    const background = opts?.background ?? false;
    if (!aiCallAllowed(level, background)) throw new Error(refusalMessage(level, background));
    // A budget refusal is remembered. Anything the user did not just ask for
    // stops here, with the same error and no request, until the limit changes
    // or a call they DID ask for gets through. Without this a feature that
    // retries on failure spends its whole day knocking on a closed door.
    const blocked = budgetBlocked();
    if (background && blocked) throw blocked;
    const token = this.getToken?.();
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        // One id per logical call, so the server recognises a retried POST as
        // the same call and can never spend on it twice.
        requestId: newRequestId(),
        messages,
        system: wireSystem(system),
        ...(opts?.tier ? { tier: opts.tier } : {}),
        ...(opts?.kind ? { kind: opts.kind } : {}),
        // UP-PLAT-03 (2026-09-06): the pin rides to the server. The gate a
        // few lines up already refuses locally, but the proxy could only ever
        // see the MASTER level, so a stale client, a background job or a bug
        // could spend AI on a feature the user had pinned Off and the server
        // had no way to know. Sanitised against AI_PIN_KEYS on arrival.
        ...(opts?.pin ? { pin: opts.pin } : {}),
        ...(background ? { background: true } : {}),
        ...(opts?.schema ? { schema: opts.schema } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const refusal = parseBudgetRefusal(detail);
      if (refusal) {
        const err = new AIBudgetError(refusal);
        noteBudgetRefusal(err);
        throw err;
      }
      throw new Error(`AI request failed (${res.status}). ${detail}`.trim());
    }
    clearBudgetBlock();
    const data = (await res.json()) as { text?: string };
    return data.text ?? "";
  }
}

function newRequestId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

// The proxy answers a budget refusal as { error, code, limitMicrousd?,
// remainingMicrousd? }. Only a KNOWN code counts, so an unrelated 402 from
// somewhere else is never mistaken for one.
function parseBudgetRefusal(detail: string): { code: import("./aiBudget").BudgetErrorCode; limitMicrousd?: number; remainingMicrousd?: number } | null {
  try {
    const j = JSON.parse(detail) as { code?: unknown; limitMicrousd?: unknown; remainingMicrousd?: unknown };
    if (!isBudgetCode(j.code)) return null;
    return {
      code: j.code,
      ...(typeof j.limitMicrousd === "number" ? { limitMicrousd: j.limitMicrousd } : {}),
      ...(typeof j.remainingMicrousd === "number" ? { remainingMicrousd: j.remainingMicrousd } : {}),
    };
  } catch {
    return null;
  }
}
