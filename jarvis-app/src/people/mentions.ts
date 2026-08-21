// WHO A PIECE OF WORK IS ABOUT (B1, audit 2026-08-21).
//
// The person card was a business card: a name, a phone, a couple of
// attributes. Everything the app actually knew that involved this person --
// the task called "Call Ridgeline about the field", the meeting on Thursday
// -- lived one tab away with no thread connecting them.
//
// The matcher is deliberately narrow, for the same reason the goal-project
// matcher is: a wrong link here attaches someone else's work to a person's
// name, and a wrong link is worse than no link. It only speaks when the
// user's own words make it obvious.
//
// Rules:
//   - The FULL name always counts.
//   - A first name counts only when it cannot be mistaken for an ordinary
//     word. "Mark" appears in "Mark done"; "Will" appears in "Will need to";
//     "Rob" appears in "Rob the fund". Those names need their surname.
//   - Whole words only, case-insensitive. "Nadia" does not match "Nadias" is
//     wrong (possessives are real), so a trailing 's or s is allowed.

// First names that are also ordinary English words. Not a spelling list: a
// name only lands here if it plausibly shows up in a to-do written by
// someone who was not thinking about that person at all.
const AMBIGUOUS = new Set([
  "mark", "will", "rob", "bill", "grace", "hope", "faith", "art", "chase",
  "dawn", "drew", "frank", "gene", "jack", "june", "may", "pat", "rich",
  "rusty", "sunny", "van", "wade", "hunter", "summer", "sky", "star", "ray",
  "don", "guy", "max", "olive", "page", "reed", "rose", "sue", "wing",
]);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The patterns that mean "this text is about this person". Empty when the
// name gives us nothing safe to match on.
export function namePatterns(fullName: string): RegExp[] {
  const name = (fullName ?? "").trim();
  if (name.length < 3) return [];
  const out: RegExp[] = [];
  const whole = (w: string) => new RegExp(`\\b${esc(w)}(?:'s|s)?\\b`, "i");
  out.push(whole(name));
  const parts = name.split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  // A single-word name IS the full name; there is no surname to fall back on,
  // so the ambiguity rule has to apply to it directly.
  if (parts.length === 1) {
    if (first.length < 3 || AMBIGUOUS.has(first.toLowerCase())) return [];
    return out;
  }
  if (first.length >= 3 && !AMBIGUOUS.has(first.toLowerCase())) out.push(whole(first));
  return out;
}

export function mentions(text: string, fullName: string): boolean {
  const t = text ?? "";
  if (!t.trim()) return false;
  return namePatterns(fullName).some((re) => re.test(t));
}

export interface MentionItem {
  id: string;
  kind: "task" | "event";
  title: string;
  sub?: string;
  done?: boolean;
}

// Open work and upcoming time involving this person. Done tasks and past
// events are left out: this is what is STILL between you, not a history.
export function openWith(
  person: { name: string },
  tasks: { id: string; text: string; done?: boolean; due?: string | null }[],
  events: { id: string; title: string; date: string; start?: string; location?: string }[],
  today: string,
  max = 6,
): MentionItem[] {
  const pats = namePatterns(person.name);
  if (pats.length === 0) return [];
  const hit = (s: string) => pats.some((re) => re.test(s));
  const out: MentionItem[] = [];
  for (const t of tasks) {
    if (t.done) continue;
    if (!hit(t.text)) continue;
    out.push({ id: t.id, kind: "task", title: t.text, sub: t.due ?? undefined });
  }
  for (const e of events) {
    if (e.date < today) continue;
    if (!hit(e.title) && !hit(e.location ?? "")) continue;
    out.push({ id: e.id, kind: "event", title: e.title, sub: e.date });
  }
  return out.slice(0, max);
}
