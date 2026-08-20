// IMPLEMENTATION INTENTIONS (A1/A2/A3, Dave 2026-08-20, approved from the
// research file).
//
// "If [situation], then I will [behaviour]." Gollwitzer and Sheeran's
// meta-analysis puts this at d = 0.65 across 94 studies and more than 8,000
// people, replicated in a 2024 synthesis of 642 tests. It is the best-
// evidenced behaviour-change technique that exists, and it is one sentence.
//
// JARVIS had none of it. Every task was a WHAT with no WHEN-AND-WHERE.
//
// The research is specific about what makes it work, and each rule below is
// a finding, not a preference:
//
//   - THE CUE MUST BE DETECTABLE. A time, a place, an event, or the end of
//     another action. "When I get a chance" is not a cue and gets no effect.
//   - THE RESPONSE MUST BE SHORT AND OBSERVABLE. Five words or fewer. A plan
//     you cannot picture yourself doing is not a plan.
//   - CUE AND RESPONSE MUST BE CONTIGUOUS. The behaviour follows the cue
//     within seconds or minutes, not "later that day".
//   - ONE CUE, ONE PLAN. Competing plans on the same trigger cancel each
//     other out. This is the finding behind A3, and it is why the app
//     refuses a duplicate cue instead of quietly letting it happen.

export type CueKind = "time" | "place" | "after";

export interface Cue {
  kind: CueKind;
  // The detectable thing. "13:00" for time, free text for place and after.
  what: string;
}

export interface IfThen {
  cue: Cue;
  // The observable behaviour, five words or fewer.
  then: string;
}

export const RESPONSE_MAX_WORDS = 5;

export function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Vague-cue detector. These are the phrases that feel like a plan and carry
// no effect, because nothing in the world tells you the moment has arrived.
const VAGUE = /^(when i (get|have) (a )?(chance|time|moment)|later|sometime|soon|asap|at some point|when i can|eventually|today|tomorrow)$/i;

export function cueIsDetectable(cue: Cue): boolean {
  const w = cue.what.trim();
  if (!w) return false;
  if (cue.kind === "time") return /^([01]?\d|2[0-3]):[0-5]\d$/.test(w);
  return !VAGUE.test(w);
}

export function responseIsUsable(then: string): boolean {
  const t = then.trim();
  return t.length > 0 && words(t) <= RESPONSE_MAX_WORDS;
}

export function isUsable(p: IfThen): boolean {
  return cueIsDetectable(p.cue) && responseIsUsable(p.then);
}

// Why it will not work, in the user's terms, so the fix is obvious. Null when
// the plan is fine.
export function whyWeak(p: IfThen): string | null {
  if (!p.cue.what.trim()) return "Name when or where";
  if (!cueIsDetectable(p.cue)) {
    return p.cue.kind === "time" ? "Pick a real time" : "Too vague to notice";
  }
  if (!p.then.trim()) return "Name the first move";
  if (!responseIsUsable(p.then)) return `Shorter · ${RESPONSE_MAX_WORDS} words or fewer`;
  return null;
}

function h12(hhmm: string): string {
  const [h = "0", m = "00"] = hhmm.split(":");
  const hn = Number(h);
  const ap = hn >= 12 ? "PM" : "AM";
  const h12n = hn % 12 === 0 ? 12 : hn % 12;
  return `${h12n}:${m} ${ap}`;
}

// The if half, read back. Kept in the user's own grammar rather than a
// template with slots showing: the sentence has to sound like something a
// person would say to themselves, or it does not get rehearsed.
export function ifClause(cue: Cue): string {
  const w = cue.what.trim();
  if (cue.kind === "time") return `it's ${h12(w)}`;
  if (cue.kind === "place") return `I'm ${w}`;
  return `I've ${w}`;
}

export function sentence(p: IfThen): string {
  return `If ${ifClause(p.cue)}, then I'll ${p.then.trim()}`;
}

// The short form for a row, where the whole sentence would wrap three lines.
export function cueLine(p: IfThen): string {
  const w = p.cue.what.trim();
  if (p.cue.kind === "time") return h12(w);
  if (p.cue.kind === "place") return w;
  return "After " + w;
}

// A3: one cue, one plan. Two tasks hanging off "after lunch" is the documented
// way to destroy the effect, so a clash is reported rather than allowed.
// Matching is on the normalised cue text, since "After Lunch" and "after
// lunch " are the same trigger to a human and that is whose brain this is for.
export function cueKey(cue: Cue): string {
  return cue.kind + ":" + cue.what.trim().toLowerCase().replace(/\s+/g, " ");
}

export function findClash<T extends { id: string; plan?: IfThen }>(
  items: T[],
  cue: Cue,
  selfId?: string,
): T | null {
  const key = cueKey(cue);
  return items.find((t) => t.id !== selfId && t.plan && cueKey(t.plan.cue) === key) ?? null;
}

export function clashLine(taskText: string): string {
  return `"${taskText}" already starts there`;
}

// A2: Plan My Day already knows the time and the place. Committing a plan can
// write the if-then for free, which is the cheapest possible way to buy a
// d = 0.65 intervention. The response is seeded from the task's own words,
// trimmed to the word limit, and stays editable.
export function planFromBlock(taskText: string, startHHMM: string): IfThen {
  return { cue: { kind: "time", what: startHHMM }, then: shortenToResponse(taskText) };
}

const FILLER = /^(the|a|an|my|some|that|this|to|for|and|of|on|in)$/i;

// Trim a task title into an observable response. Drops leading filler and
// caps at the word limit; never invents a verb the user did not write, so a
// noun-only title stays a noun-only response rather than becoming a guess.
export function shortenToResponse(text: string): string {
  const raw = text.trim().split(/\s+/).filter(Boolean);
  while (raw.length > RESPONSE_MAX_WORDS && FILLER.test(raw[0] ?? "")) raw.shift();
  const kept = raw.slice(0, RESPONSE_MAX_WORDS).join(" ");
  return kept.charAt(0).toLowerCase() + kept.slice(1);
}
