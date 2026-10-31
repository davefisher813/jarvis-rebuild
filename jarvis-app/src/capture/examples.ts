// WHAT TO SAY (the speech box, 2026-10-31; the 2026-10-28 research, section 3: "the problem is published, named, and
// measured"). Two helps, both from the same sentences:
//
//  1. The bar's rotating example, re-ordered by the screen he is standing on, so the first thing he reads is the kind of
//     thing that screen is for. A hint order, never a filing rule: a set said on Schedule is still a set.
//  2. "What Can I Say?", grouped by what each sentence makes, which never fades.
//
// Every sentence here must file as its group says through the real capture path; capture/examples.test.ts runs each one.

export type SayKind = "event" | "reminder" | "task" | "set" | "question" | "money" | "fact" | "decision" | "note";

export interface SayGroup {
  kind: SayKind;
  title: string;
  /** One short line on how to say it so it files right, in the app's voice. */
  tip: string;
  /** The bar's version: short enough to fit the pill at the largest text size without losing a character. */
  bar: string;
  examples: string[];
}

export const SAY_GROUPS: SayGroup[] = [
  { kind: "event", bar: "Dinner at 7 PM", title: "Event", tip: "Say the Day and the Time", examples: ["Dinner with Sam Tomorrow at 7 PM", "Lunch with Henry Friday at Noon"] },
  { kind: "reminder", bar: "Remind Me at 9", title: "Reminder", tip: "Start with Remind Me", examples: ["Remind Me to Call the Dentist Tomorrow at 9 AM", "Remind Me to Take My Vitamins Every Day at 8 AM"] },
  { kind: "task", bar: "Call Marco", title: "Task", tip: "Say What to Do", examples: ["Call Marco About the Field", "Send Rob the Deck by Friday"] },
  { kind: "set", bar: "Bench 225 for 8", title: "Workout Set", tip: "Say the Lift, the Weight and the Reps", examples: ["Log Bench Press 225 for 8", "3 Sets of 10 Kettlebell Swings at 53 Pounds"] },
  { kind: "question", bar: "What's on Today?", title: "Question", tip: "Questions Are Answered, Not Saved", examples: ["What's on My Schedule Tomorrow?", "When Is My Call with Shane?"] },
  { kind: "money", bar: "Spent $42 on Gas", title: "Money", tip: "Say What You Spent and Where", examples: ["Spent 42 Dollars on Gas", "Paid $18 at Chipotle"] },
  { kind: "fact", bar: "Remember That", title: "Fact", tip: "Start with Remember", examples: ["Remember Marco's Kid Plays Shortstop"] },
  { kind: "decision", bar: "We Decided", title: "Decision", tip: "Say What You Decided", examples: ["We're Going with the First Floor for the Event"] },
  { kind: "note", bar: "Note to Self", title: "Note", tip: "Start with Note to Self", examples: ["Note to Self the Gate Code Is 4419"] },
];

const BY_KIND = Object.fromEntries(SAY_GROUPS.map((g) => [g.kind, g])) as Record<SayKind, SayGroup>;

// Which kinds lead on which screen. Anything not named falls back to the general order.
const SCREEN_ORDER: Record<string, SayKind[]> = {
  today: ["reminder", "event", "question", "task", "set"],
  schedule: ["event", "reminder", "question"],
  life: ["task", "reminder", "set", "event"],
  money: ["money", "question", "reminder"],
  notes: ["note", "fact", "task"],
  brain: ["fact", "decision", "question"],
  messages: ["task", "reminder", "question"],
  notifications: ["reminder", "task", "event"],
  more: ["task", "event", "question", "money"],
};
const GENERAL: SayKind[] = ["event", "reminder", "set", "question", "task", "money"];

/** The bar's examples for this screen, first one first. Short enough for the bar: one example per kind. */
export function examplesFor(screen: string): string[] {
  const order = SCREEN_ORDER[screen] ?? GENERAL;
  return order.map((k) => BY_KIND[k].examples[0]!);
}

/** The bar's short lines for this screen, first one first. */
export function barLinesFor(screen: string): string[] {
  const order = SCREEN_ORDER[screen] ?? GENERAL;
  return order.map((k) => BY_KIND[k].bar);
}

/** The three suggestion chips an empty capture sheet shows, for this screen. */
export function chipsFor(screen: string): string[] {
  return examplesFor(screen).slice(0, 3);
}

// THE TEACHING FADES, THE HELP STAYS (research section 3, item 5). The bar rotates for the first twenty captures, then settles on
// the one example for the screen; What Can I Say? never goes.
export const ROTATE_FOR = 20;
const COUNT_KEY = "jarvis.capture.count.v1";
const store = (): Storage | null => { try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; } };
export function captureCount(): number {
  try { return Number(store()?.getItem(COUNT_KEY) ?? 0) || 0; } catch { return 0; }
}
export function countCapture(): void {
  try { store()?.setItem(COUNT_KEY, String(captureCount() + 1)); } catch { /* private mode: it keeps rotating, which is harmless */ }
}
