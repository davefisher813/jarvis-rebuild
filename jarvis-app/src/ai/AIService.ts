import { apiUrl } from "../shared/apiBase";
import { backendConfigured } from "../data/store";
import { aiCallAllowed, effectiveLevel, refusalCode, refusalMessage, isRefusalCode, AIUnavailableError, ADMIN_AI_CODE, ADMIN_AI_MESSAGE, type AIPinKey } from "./aiGate";
import { getAIControl, isAdminAiBlocked, setAdminAiBlocked } from "./levelStore";
import { wireSystem, type AISystem } from "./systemPrompt";
import { AIBudgetError, isBudgetCode } from "./aiBudget";
import { budgetBlocked, clearBudgetBlock, noteBudgetRefusal } from "./budgetBlock";
import { parseProviderRefusal } from "./providerFailure";
import { clearProviderBlock, noteProviderFailure, providerBlocked } from "./providerBlock";
import type { ToolName } from "../chat/tools/registry";
import type { ToolCall } from "../chat/tools/wire";

export type { AISystem } from "./systemPrompt";

export interface AIMessage {
  role: "user" | "assistant";
  content: string | AIBlock[];
}

// Content blocks for vision requests: text plus at most one base64 image (the
// proxy enforces the same shape server-side).
//
// A tool turn (chat/tools) adds the two blocks a tool call is made of: the model's own tool_use, and the tool_result the dispatcher answers
// it with. The proxy judges both (chat/tools/wire.ts) and only on a request that names the tool.
export type AIBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

/** What one step of a tool turn comes back with: the model's words, the calls it asked for, and why it stopped. */
export interface AITurn {
  text: string;
  toolCalls: ToolCall[];
  stop: string | null;
}

// The proxy's reply envelope. { text } for every ordinary call; a tool turn adds the calls and the stop reason.
interface WireReply {
  text?: string;
  toolCalls?: unknown;
  stop?: unknown;
}

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
    opts?: { tier?: "write"; kind?: string; background?: boolean; pin?: AIPinKey; schema?: Record<string, unknown>; signal?: AbortSignal },
  ): Promise<string> {
    return (await this.send(messages, system, opts)).text ?? "";
  }

  // ONE STEP OF A TOOL TURN (chat box order, 2026-10-24). The same gate, the same budget and the same failure words as complete(), with the
  // names of the tools the model may ask for (never their definitions: the proxy holds those, chat/tools/registry.ts). It returns what the
  // model said and the calls it asked for; running them is the dispatcher's job, never this client's, and the next step carries their
  // results back. A call is re-checked here against the same shape the proxy checked, so a malformed one never reaches the dispatcher.
  async completeTurn(
    messages: AIMessage[],
    system: string | AISystem | undefined,
    opts: { tools: readonly ToolName[]; kind?: string; pin?: AIPinKey; signal?: AbortSignal },
  ): Promise<AITurn> {
    const r = await this.send(messages, system, opts);
    return { text: r.text ?? "", toolCalls: sanitizeCalls(r.toolCalls), stop: typeof r.stop === "string" ? r.stop : null };
  }

  private async send(
    messages: AIMessage[],
    system?: string | AISystem,
    opts?: { tier?: "write"; kind?: string; background?: boolean; pin?: AIPinKey; schema?: Record<string, unknown>; signal?: AbortSignal; tools?: readonly ToolName[] },
  ): Promise<WireReply> {
    // Every "AI is not available" below is a typed error (aiGate.AIUnavailableError) carrying the same sentence it always did, so a
    // caller that wants to tell "you turned AI off" from "the provider is down" reads a code instead of English.
    if (!this.available) throw new AIUnavailableError("AI_NOT_CONFIGURED", "AI is not configured in this build.");
    // The admin switch is checked first and says its own reason: a user whose
    // AI was turned off for them should not be told to look in Settings.
    if (isAdminAiBlocked()) throw new AIUnavailableError(ADMIN_AI_CODE, ADMIN_AI_MESSAGE);
    const level = effectiveLevel(getAIControl(), opts?.pin);
    const background = opts?.background ?? false;
    if (!aiCallAllowed(level, background)) throw new AIUnavailableError(refusalCode(level, background), refusalMessage(level, background));
    // A budget refusal is remembered. Anything the user did not just ask for
    // stops here, with the same error and no request, until the limit changes
    // or a call they DID ask for gets through. Without this a feature that
    // retries on failure spends its whole day knocking on a closed door.
    const blocked = budgetBlocked();
    if (background && blocked) throw blocked;
    // The same for a provider that cannot serve (out of credit, usage limit, key refused): see providerBlock for why it also lapses.
    const down = providerBlocked();
    if (background && down) throw down;
    const token = this.getToken?.();
    const res = await this.fetchImpl(this.endpoint, {
      // A caller that must never wait forever (a read the person is staring at) passes a signal; absent, nothing changes.
      ...(opts?.signal ? { signal: opts.signal } : {}),
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
        ...(opts?.tools ? { tools: opts.tools } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // The proxy is the authority on the admin switch. A refusal with its code
      // means this session was still offering AI to an account that has had it
      // turned off (the app had not asked yet, or the admin just flipped it):
      // remember it so the rest of the session stops trying, and say why.
      if (res.status === 403 && adminRefusal(detail)) {
        setAdminAiBlocked(true);
        throw new AIUnavailableError(ADMIN_AI_CODE, ADMIN_AI_MESSAGE);
      }
      // The proxy read the stored profile and said no: this client's copy of the level was out of date (changed on another device).
      const gate = res.status === 403 ? parseGateRefusal(detail) : null;
      if (gate) throw gate;
      const refusal = parseBudgetRefusal(detail);
      if (refusal) {
        const err = new AIBudgetError(refusal);
        noteBudgetRefusal(err);
        throw err;
      }
      // The provider refused, and the proxy has already read WHY from its body (api/ai.ts, providerFailure).
      const provider = parseProviderRefusal(detail);
      if (provider) {
        noteProviderFailure(provider);
        throw provider;
      }
      throw new Error(`AI request failed (${res.status}). ${detail}`.trim());
    }
    clearBudgetBlock();
    clearProviderBlock();
    return (await res.json()) as WireReply;
  }
}

// The calls in a proxy reply, kept only if each is shaped as the proxy sends them. The proxy already dropped anything else; this is the
// second look, so the dispatcher only ever sees { id, name, input } with a plain-object input.
function sanitizeCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolCall[] = [];
  for (const c of raw) {
    const o = c as { id?: unknown; name?: unknown; input?: unknown } | null;
    if (!o || typeof o.id !== "string" || typeof o.name !== "string" || typeof o.input !== "object" || o.input === null || Array.isArray(o.input)) continue;
    out.push({ id: o.id, name: o.name as ToolName, input: o.input as Record<string, unknown> });
  }
  return out;
}

function adminRefusal(detail: string): boolean {
  try { return (JSON.parse(detail) as { code?: unknown }).code === ADMIN_AI_CODE; } catch { return false; }
}

// The level's own refusal, as the proxy sends it: { error, code }. Only a known code with its sentence counts.
function parseGateRefusal(detail: string): AIUnavailableError | null {
  try {
    const j = JSON.parse(detail) as { code?: unknown; error?: unknown };
    return isRefusalCode(j.code) && typeof j.error === "string" && j.error ? new AIUnavailableError(j.code, j.error) : null;
  } catch {
    return null;
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
