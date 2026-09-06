// Chat's command layer (addendum item 23). Deterministic, BEFORE any AI
// call. A command resolves against real rows under the Uncertainty Protocol:
// one match acts (receipt + undo at the call site); several matches return
// a BOUNDED CHOOSER of real rows (the tap is both answer and action); zero
// matches is an honest refusal stating nothing was changed. Chat can draft
// but never send; nothing here touches mail.

export type ChatCommand =
  | { kind: "complete"; query: string }
  | { kind: "reschedule"; query: string; when: "today" | "tomorrow" }
  | { kind: "deleteTask"; query: string }
  // UP-MIND-22 (2026-09-05, A23 "can draft but never send"): "draft a note to
  // Sarah saying I'll send the roster Friday". The fastest route from a
  // thought to a sent message, and it still needs the tap: this command
  // writes words and opens a composer, and nothing on this path sends.
  | { kind: "draft"; medium: "email" | "text"; query: string; about: string };

export function parseCommand(raw: string): ChatCommand | null {
  const t = raw.trim().toLowerCase().replace(/[.!]+$/, "");

  const done = t.match(/^(complete|finish|mark done|done with|check off)\s+(.+)$/);
  if (done) return { kind: "complete", query: done[2]! };

  const move = t.match(/^(move|push|bump)\s+(.+?)\s+to\s+(today|tomorrow)$/);
  if (move) return { kind: "reschedule", query: move[2]!, when: move[3] as "today" | "tomorrow" };

  const del = t.match(/^(delete|remove)\s+(?:the\s+)?task\s+(.+)$/);
  if (del) return { kind: "deleteTask", query: del[2]! };

  // "draft an email to Sarah about the roster" / "write a text to Marco
  // saying I'll be late". The medium decides where it opens: email goes to
  // the composer, a text goes to the message sheet. A bare "message" is a
  // text, which is what people mean by it on a phone.
  //
  // Read off the RAW string, not the lowercased one, because `about` is the
  // user's own words and goes into a draft over their name.
  const draft = raw.trim().replace(/[.!]+$/, "").match(
    /^(?:draft|write)\s+(?:an?\s+)?(email|text|message|note)\s+to\s+(.+?)(?:\s+(?:about|saying|re)\s+(.+))?$/i,
  );
  if (draft) {
    const medium = /^email$/i.test(draft[1]!) ? "email" : "text";
    return { kind: "draft", medium, query: draft[2]!.trim(), about: (draft[3] ?? "").trim() };
  }

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
