// VALUES CAN SAY NO TO THE AUTOMATION (UP-MIND-20, Email 5.12, Brain 1.7).
// Chosen option B: hard lines, matched deterministically, no AI call.
//
// "Never auto-archive anything from the school" is not a tone note. Values
// has been free text read into prompts (brain/docs/types.ts, ai/context.ts),
// which means it could shade how JARVIS writes and could not stop JARVIS
// doing. The three automatic paths (auto-clear noise, heads-down auto-reply,
// the day re-flow) consulted nothing but an AI Control level.
//
// A hard line is a STRUCTURED statement sitting alongside the prose, edited
// as chips on the Values page, and matched by string equality and domain
// suffix. Option (a) would have spent an AI call per automatic batch to ask
// a model whether an action conflicts with a paragraph; a rule that stops an
// automatic action has to be as certain as the action is, and a model's
// reading of prose is not.
//
// THE BAN THIS KEEPS: Values is never written by the app. Every hard line is
// typed by the user on their own page. Nothing here proposes one, infers one
// from behaviour, or edits the prose.
//
// GATE ORDER, from the decision: confidence first (UP-MIND-18), then Values.
// A low-confidence read never acts; a high-confidence read that crosses a
// hard line is HELD, and leaves a receipt saying which line held it.

export type HardLineKind = "never_file" | "always_ask" | "protect";

export interface HardLine {
  kind: HardLineKind;
  /** What it is about, in the user's own words: an address, a domain, a
   *  sender name, an area, or the name of something they protect. */
  match: string;
}

export const HARD_LINE_LABEL: Record<HardLineKind, string> = {
  never_file: "Never File",
  always_ask: "Always Ask",
  protect: "Protect",
};

// What each kind says it will do, on the chip that adds it. A label may only
// promise what the handler performs.
export const HARD_LINE_PROMISE: Record<HardLineKind, string> = {
  never_file: "Nothing from this is ever archived on its own",
  always_ask: "Nothing automatic happens here without you",
  protect: "This time is never moved for you",
};

export const MAX_HARD_LINES = 12;
const MAX_MATCH = 60;

export function cleanHardLines(raw: unknown): HardLine[] {
  if (!Array.isArray(raw)) return [];
  const out: HardLine[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "object" || v === null) continue;
    const { kind, match } = v as { kind?: unknown; match?: unknown };
    if (kind !== "never_file" && kind !== "always_ask" && kind !== "protect") continue;
    if (typeof match !== "string") continue;
    const m = match.trim().slice(0, MAX_MATCH);
    if (!m) continue;
    // NUL as the separator, written as an escape (laws/controlBytes.test.ts):
    // a kind cannot contain one, so "protect x" and "protect" + "x" cannot
    // collide the way they would with a space.
    const key = kind + "\u0000" + m.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, match: m });
    if (out.length >= MAX_HARD_LINES) break;
  }
  return out;
}

// What an automatic path is about to do, and to what.
export interface AutoAction {
  /** file: archive or move mail. reply: send on the user's behalf.
   *  reflow: move a block on the day. */
  action: "file" | "reply" | "reflow";
  /** The sender, when there is one. */
  fromEmail?: string;
  /** The sender's display name, when there is one. */
  fromName?: string;
  /** The area or category the thing belongs to. */
  category?: string;
  /** What the block is, for a re-flow. */
  blockTitle?: string;
}

// Matched by whole word, address, or domain suffix. Never a substring: "art"
// must not match "start", and a rule about "school" must not hold everything
// containing the letters s-c-h-o-o-l inside another word.
function hits(match: string, value: string | undefined): boolean {
  if (!value) return false;
  const m = match.trim().toLowerCase();
  const v = value.trim().toLowerCase();
  if (!m || !v) return false;
  if (v === m) return true;
  // An address or a domain: "@school.org" and "school.org" both hold
  // anything sent from that domain.
  if (m.includes(".") && (v.endsWith("@" + m.replace(/^@/, "")) || v.endsWith("." + m.replace(/^@/, "")))) return true;
  // A word in a name or a title.
  return new RegExp("\\b" + m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(v);
}

const APPLIES: Record<HardLineKind, AutoAction["action"][]> = {
  never_file: ["file"],
  always_ask: ["file", "reply", "reflow"],
  protect: ["reflow"],
};

/** The line that holds this action, or null when nothing does. Deterministic
 *  and free: no model, no request, no level. */
export function heldBy(lines: HardLine[], a: AutoAction): HardLine | null {
  for (const l of lines) {
    if (!APPLIES[l.kind].includes(a.action)) continue;
    if (hits(l.match, a.fromEmail) || hits(l.match, a.fromName)
      || hits(l.match, a.category) || hits(l.match, a.blockTitle)) return l;
  }
  return null;
}

/** The receipt. Silence when an automatic action is held is the same failure
 *  as silence when one fails: the user has to be able to see why the app did
 *  not do the thing it usually does. */
export function heldLine(l: HardLine): string {
  return `Held: your Values say ${l.match} is ${l.kind === "never_file" ? "never filed" : l.kind === "protect" ? "never moved" : "never automatic"}`;
}
