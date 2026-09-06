import type { MailWindow } from "./batching";
import { MAX_WINDOWS } from "./batching";

// MAIL ARRIVES THREE TIMES A DAY, AND THE PHONE SAYS WHO WROTE
// (UP-MIND-14, Email E1 and 5.5, chosen option: the local digest).
//
// The randomized trial this rests on found two things, and the second is the
// one people get wrong: batching mail about three times a day raised the
// sense of control, AND turning notifications off backfired. Silence is not
// calm, it is uncertainty, and uncertainty is what makes people graze the
// inbox all day. So the digest exists, at the window starts, and it says
// WHO wrote rather than how many are unread.
//
// TWO DIFFERENT THINGS, DELIBERATELY SEPARATED. The curtain (batching.ts) is
// CHOSEN: off by default, turned on inside its editor, because a way of
// working has to be picked. The digest is the opposite: it is the app
// telling you what arrived, it uses the same window times because those are
// the rhythm the user set, and it runs whether or not the curtain is drawn.
// The 2026-08-22 rebuild law ("off by default, chosen inside the editor")
// governs the curtain and only the curtain; conflating the two is what the
// upgrade record flagged, and the copy keeps them apart.
//
// What this never does:
//   - a count of unread, ever. peekLine's whole design is people and names.
//   - fire in the night. Quiet hours are a floor and a ceiling, not a
//     setting, because a 3 AM digest is the thing that gets notifications
//     turned off for good.
//   - claim to be current when it is not. The body says what time the app
//     last actually looked.

export const MAIL_DIGEST_BASE = 9500;
// One per window, and the window editor already caps at MAX_WINDOWS.
export const MAIL_DIGEST_CAP = MAX_WINDOWS;

// Nothing before 7 AM, nothing after 10 PM. Not a preference: a digest that
// wakes someone is a digest that gets the whole feature disabled.
export const QUIET_START_MIN = 7 * 60;
export const QUIET_END_MIN = 22 * 60;

export interface DigestSpec {
  id: number;
  title: string;
  body: string;
  hour: number;
  minute: number;
}

function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

/** When the app last actually looked. Said out loud because the digest is
 *  built from a snapshot, and a snapshot from three hours ago that reads as
 *  live is the app lying about what it knows. */
export function asOfLine(snapTs: number): string {
  if (!snapTs) return "JARVIS hasn't checked yet";
  const d = new Date(snapTs);
  return "As of " + hhmm(d.getHours() * 60 + d.getMinutes());
}

/** One notification per window, from the last snapshot's peek line. The peek
 *  is passed in rather than derived here, so the digest and the Door say the
 *  same sentence about the same inbox. */
export function buildMailDigests(
  windows: MailWindow[],
  peek: string,
  snapTs: number,
): DigestSpec[] {
  const out: DigestSpec[] = [];
  const sorted = [...windows].sort((a, b) => a.startMin - b.startMin).slice(0, MAIL_DIGEST_CAP);
  sorted.forEach((w, i) => {
    if (w.startMin < QUIET_START_MIN || w.startMin > QUIET_END_MIN) return;
    out.push({
      id: MAIL_DIGEST_BASE + i,
      title: peek,
      body: asOfLine(snapTs),
      hour: Math.floor(w.startMin / 60),
      minute: w.startMin % 60,
    });
  });
  return out;
}

// How long before a window the pump should go and look, so the digest that
// fires at the window start is about mail that arrived this morning rather
// than at breakfast yesterday.
export const REFRESH_LEAD_MIN = 10;

/** True when now sits inside the lead-in before any window start. */
export function inRefreshLead(windows: MailWindow[], nowMin: number): boolean {
  return windows.some((w) => nowMin >= w.startMin - REFRESH_LEAD_MIN && nowMin < w.startMin);
}
