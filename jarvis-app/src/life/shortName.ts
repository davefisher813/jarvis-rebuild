// THE SHORT NAME (Dave 2026-09-01, "Fewer Words" catalog: "I like the goal
// icon but there's too much verbiage after"). Goal titles are sentences:
// "Build a six-month runway", "Make apartment aesthetic". A task row wants a
// noun. Every goal has a short name: the one he typed on the goal sheet, or,
// until he does, the title with its leading verb and article dropped, cut to
// two words. The default is only a default; the field is the real fix, which
// is how Things and Todoist stay readable: the row shows a name chosen to be
// short. Derived at read time, so an improvement to the rule reaches every
// goal that never set its own.

const VERBS = new Set([
  "build", "make", "ship", "get", "create", "launch", "grow", "reach", "hit", "run",
  "finish", "complete", "start", "become", "save", "pay", "lose", "gain", "write", "learn",
  "find", "land", "close", "win", "improve", "plan", "open", "set", "go", "keep", "stay",
  "raise", "reduce", "cut", "double", "earn", "read", "buy", "sell", "move", "fix",
]);
const ARTICLES = new Set(["a", "an", "the", "my", "our", "your", "this", "that", "up", "to"]);

export const SHORT_MAX = 18;

/** The two-word default: leading verb and article dropped, first letter up. */
export function defaultShortName(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  let i = 0;
  if (words.length > 1 && VERBS.has(words[0]!.toLowerCase())) i = 1;
  while (i < words.length - 1 && ARTICLES.has(words[i]!.toLowerCase())) i += 1;
  const kept = words.slice(i, i + 2);
  const out = kept.join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** What a row prints after the goal mark. */
export function shortGoalName(g: { title: string; short?: string }): string {
  const own = g.short?.trim();
  return own ? own : defaultShortName(g.title);
}
