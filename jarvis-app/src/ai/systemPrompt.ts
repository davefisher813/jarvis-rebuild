// PROMPT CACHING (UP-PLAT-02, 2026-09-06). Pure, so the proxy can import it
// the same way it imports aiGate, structured and tokenLog: no fetch, no DOM,
// no app state.
//
// Every AI call ships the same assembled context block ahead of a few hundred
// characters of feature-specific instruction. ai/context.ts is 16 KB of
// assembler, and until now every call paid full input price for its output.
// Anthropic bills a cache READ at 0.1x the input price with a five-minute
// TTL, so a mail sort, a pre-generation pass, a plan and a chat turn inside
// one five-minute window pay for that block once instead of four times.
// See https://platform.claude.com/docs/en/build-with-claude/prompt-caching.
//
// TWO RULES SHAPE EVERYTHING HERE:
//
//  1. THE CONTEXT GOES FIRST. A cache breakpoint caches the prefix BEFORE it,
//     so an instruction ahead of the block would give every feature a
//     different prefix and nothing would ever hit. Splitting the prompt into
//     { context, instructions } is the whole point: the shared half in front,
//     marked, and the feature's own words behind it, unmarked.
//
//  2. A SMALL BLOCK IS NOT MARKED. Sonnet-class models will not cache below
//     1,024 tokens (the mark is ignored), and a cache WRITE costs 1.25x the
//     input price, so marking a block that will never be read back is pure
//     loss. A brand new account with three tasks has a tiny context; it sends
//     one plain string exactly as it did before this file existed.
//
// This changes cost, not behaviour: the same words reach the model either
// way, and the deterministic-first rule above every AI call is untouched.

export interface AISystem {
  /** The assembled user context. Identical across features, so it caches. */
  context: string;
  /** This feature's own instructions. Never cached: they differ every time. */
  instructions: string;
}

// Four characters to the token is the usual English rule of thumb, so this is
// a deliberate margin over the 1,024-token floor rather than a tight fit:
// under-marking costs nothing, over-marking costs 1.25x for nothing.
export const CACHEABLE_MIN_CHARS = 4400;

export function isAISystem(v: unknown): v is AISystem {
  if (!v || typeof v !== "object") return false;
  const o = v as { context?: unknown; instructions?: unknown };
  return typeof o.context === "string" && typeof o.instructions === "string";
}

/** The one string form, context first, for everything too small to cache. */
export function flattenSystem(s: AISystem): string {
  return [s.context, s.instructions].map((p) => p.trim()).filter(Boolean).join("\n");
}

/**
 * What the client actually puts on the wire. The split shape only when the
 * context is worth caching; a plain string otherwise, which is byte for byte
 * what the proxy has always received.
 */
export function wireSystem(system: string | AISystem | undefined): string | AISystem | undefined {
  if (system === undefined || typeof system === "string") return system;
  return system.context.length >= CACHEABLE_MIN_CHARS ? system : flattenSystem(system);
}

export interface SystemTextBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

/**
 * The proxy half: what to spread into the upstream body. Returns null when
 * there is no system prompt at all, so the caller adds nothing, exactly as it
 * did when the only accepted shape was a string.
 *
 * Hostile-client safe: anything that is not a string or a well-formed
 * { context, instructions } pair is dropped rather than forwarded.
 */
export function systemPayload(system: unknown): { system: string | SystemTextBlock[] } | null {
  if (typeof system === "string") return system ? { system } : null;
  if (!isAISystem(system)) return null;
  const context = system.context;
  const instructions = system.instructions;
  // A split shape whose context turned out empty is just an instruction
  // string: marking an empty block would spend a cache write on nothing.
  if (!context.trim()) return instructions.trim() ? { system: instructions } : null;
  const blocks: SystemTextBlock[] = [{ type: "text", text: context, cache_control: { type: "ephemeral" } }];
  if (instructions.trim()) blocks.push({ type: "text", text: instructions });
  return { system: blocks };
}
