// Chat's command layer (addendum item 23). Deterministic, BEFORE any AI
// call. A command resolves against real rows under the Uncertainty Protocol:
// one match acts (receipt + undo at the call site); several matches return
// a BOUNDED CHOOSER of real rows (the tap is both answer and action); zero
// matches is an honest refusal stating nothing was changed. Chat can draft
// but never send; nothing here touches mail.

export type ChatCommand =
  | { kind: "complete"; query: string }
  | { kind: "reschedule"; query: string; when: "today" | "tomorrow" }
  | { kind: "deleteTask"; query: string };

export function parseCommand(raw: string): ChatCommand | null {
  const t = raw.trim().toLowerCase().replace(/[.!]+$/, "");

  const done = t.match(/^(complete|finish|mark done|done with|check off)\s+(.+)$/);
  if (done) return { kind: "complete", query: done[2]! };

  const move = t.match(/^(move|push|bump)\s+(.+?)\s+to\s+(today|tomorrow)$/);
  if (move) return { kind: "reschedule", query: move[2]!, when: move[3] as "today" | "tomorrow" };

  const del = t.match(/^(delete|remove)\s+(?:the\s+)?task\s+(.+)$/);
  if (del) return { kind: "deleteTask", query: del[2]! };

  return null;
}

export interface CommandTarget {
  id: string;
  text: string;
}

export type Resolution =
  | { kind: "one"; target: CommandTarget }
  | { kind: "choose"; options: CommandTarget[] }
  | { kind: "none" };

// Word-overlap match with a floor, capped chooser (a bounded chooser of six
// is a question; a chooser of forty is a wall).
export const CHOOSER_CAP = 4;

export function resolveTarget(open: CommandTarget[], query: string): Resolution {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return { kind: "none" };
  const hits = open.filter((t) => {
    const x = t.text.toLowerCase();
    return words.every((w) => x.includes(w));
  });
  if (hits.length === 1) return { kind: "one", target: hits[0]! };
  if (hits.length === 0) return { kind: "none" };
  return { kind: "choose", options: hits.slice(0, CHOOSER_CAP) };
}
