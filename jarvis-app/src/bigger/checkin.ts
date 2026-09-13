// THE CHECK-IN (C-37, Astra, 2026-09-12). A goal nothing can measure yet
// gets asked how it is going, in one of three words. The answer is an
// asked-rank strand linked to the goal (so the page can say the last one
// back) and a goal.checkin event. It is a self-report and stays one: never
// written to GoalData.state, never read as health.
export type CheckinWord = "ahead" | "on_track" | "behind";

export const CHECKIN_LABEL: Record<CheckinWord, string> = { ahead: "Ahead", on_track: "On Track", behind: "Behind" };

/** The strand's text: "{goal title}: {word} as of {date}". */
export function checkinText(title: string, word: CheckinWord, today: string): string {
  return `${title.trim()}: ${CHECKIN_LABEL[word]} as of ${today}`;
}

const RX = /:\s*(Ahead|On Track|Behind)\s+as of\s+(\d{4}-\d{2}-\d{2})\s*$/;

/** The word and the day back out of a check-in strand's text, or null. */
export function readCheckin(text: string): { word: CheckinWord; on: string } | null {
  const m = text.match(RX);
  if (!m) return null;
  const word = (Object.keys(CHECKIN_LABEL) as CheckinWord[]).find((w) => CHECKIN_LABEL[w] === m[1]);
  return word ? { word, on: m[2]! } : null;
}
