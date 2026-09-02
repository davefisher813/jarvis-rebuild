// WHAT THE EMAIL IS ACTUALLY ASKING FOR (Dave 2026-08-25: "if it's something
// that AI can act on it should have the option. Example would be it's an
// appointment reminder and it adds it to the Jarvis schedule").
//
// The triage pass already reads every new thread. It was throwing away the
// most useful thing it found: an appointment reminder KNOWS the date and the
// time, a bill KNOWS the amount and the due date, and the card was offering
// "Reply" to both of them. Reading it costs nothing extra, because it rides
// the pass that was already going to run.
//
// Three laws, and the first one is the whole feature:
//
//   1. NEVER INVENT. Every field here is copied out of the email or the
//      action does not exist. A fabricated appointment is worse than no
//      appointment, because the schedule is the one surface Dave trusts
//      without checking. This is why an unreadable date kills the action
//      instead of defaulting to today.
//
//   2. DEGRADE, NEVER UPGRADE. An appointment with a date but no time is not
//      an event, because putting it at 9am would be inventing the 9am. It
//      becomes a reminder on that day, which is exactly as much as the email
//      supports. The action always falls to the strongest thing that is true.
//
//   3. A KIND WE DO NOT KNOW IS NOT AN ACTION. Every newsletter on earth
//      mentions a date. Requiring a recognised kind is what keeps this from
//      putting a button on all of them.

// What the model returned, unvalidated and untrusted.
export interface ActProposal {
  kind?: unknown;
  title?: unknown;
  date?: unknown;
  start?: unknown;
  durationMin?: unknown;
  amount?: unknown;
}

// What the card can actually do, once the proposal survived reading.
export type ActVerb = "schedule" | "bill" | "remind";

export interface MailAct {
  verb: ActVerb;
  title: string;
  date: string;            // YYYY-MM-DD
  start?: string;          // HH:MM, present only when verb is "schedule"
  durationMin?: number;    // present only when verb is "schedule"
  amount?: number;         // present only when verb is "bill"
}

export const ACT_TITLE_MAX = 60;
// A default DURATION is not an invented fact the way a default time is: the
// email said when it starts, and every calendar on earth assumes an hour when
// nobody says otherwise. The time itself is never defaulted.
export const DEFAULT_MIN = 60;
const MIN_LEN = 15;
const MAX_LEN = 480;
// Money is the field most likely to come back as a currency string, a range,
// or a phone number the model mistook for a total. A ceiling is cheap.
const AMOUNT_MAX = 1_000_000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// A real day on the calendar, not just four digits and two dashes. The
// round-trip is what rejects 2026-02-31, which JavaScript would otherwise
// happily read as March 3rd.
export function realDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + "T12:00:00");
  if (Number.isNaN(d.getTime())) return false;
  const back = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return back === s;
}

const dayDiff = (a: string, b: string): number =>
  Math.round((new Date(a + "T12:00:00").getTime() - new Date(b + "T12:00:00").getTime()) / 86400e3);

// Yesterday is allowed by one day because a nightly mail read at 7am is
// talking about a date that turned over while it sat in the inbox. Beyond
// that, a past date means the model resolved something wrong, and 400 days
// out means it resolved a year it made up.
const PAST_GRACE = 1;
const FUTURE_MAX = 400;

const KINDS: Record<string, "event" | "bill" | "delivery"> = {
  appointment: "event", event: "event", meeting: "event", call: "event",
  flight: "event", travel: "event", reservation: "event", class: "event",
  bill: "bill", invoice: "bill", payment: "bill", renewal: "bill", subscription: "bill",
  delivery: "delivery", package: "delivery", shipment: "delivery", order: "delivery",
};

const toMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number): string =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// The end of a scheduled block. Clamped to the same day: an appointment at
// 11:40pm becomes a twenty-minute block rather than one that ends tomorrow,
// because an event that crosses midnight breaks every day view in the app.
export function endOfAct(start: string, minutes: number): string {
  return hhmm(Math.min(toMin(start) + minutes, 23 * 60 + 59));
}

/**
 * Read a proposal into an action, or into nothing.
 *
 * `nowMin` is optional and only matters for today: an appointment whose time
 * has already passed is not something to add to today's schedule, and there is
 * no honest way to move it, so the action goes away rather than degrading to a
 * reminder for a moment that is gone.
 */
export function readAct(p: ActProposal | null | undefined, todayISO: string, nowMin?: number): MailAct | null {
  if (!p || typeof p !== "object") return null;

  const kindRaw = typeof p.kind === "string" ? p.kind.trim().toLowerCase() : "";
  const kind = KINDS[kindRaw];
  if (!kind) return null;                                   // law 3

  const title = typeof p.title === "string" ? p.title.trim().slice(0, ACT_TITLE_MAX) : "";
  if (!title) return null;

  const date = typeof p.date === "string" ? p.date.trim() : "";
  if (!realDate(date)) return null;                         // law 1
  const off = dayDiff(date, todayISO);
  if (off < -PAST_GRACE || off > FUTURE_MAX) return null;

  const start = typeof p.start === "string" && TIME_RE.test(p.start.trim()) ? p.start.trim() : undefined;
  const amountRaw = typeof p.amount === "number" ? p.amount : Number.NaN;
  const amount = Number.isFinite(amountRaw) && amountRaw > 0 && amountRaw <= AMOUNT_MAX
    ? Math.round(amountRaw * 100) / 100
    : undefined;

  if (kind === "event" && start) {
    // Today only, and only ahead of the clock.
    if (off === 0 && typeof nowMin === "number" && toMin(start) < nowMin) return null;
    const raw = typeof p.durationMin === "number" && Number.isFinite(p.durationMin) ? p.durationMin : DEFAULT_MIN;
    return { verb: "schedule", title, date, start, durationMin: Math.min(MAX_LEN, Math.max(MIN_LEN, Math.round(raw))) };
  }
  if (kind === "bill" && amount !== undefined) {
    return { verb: "bill", title, date, amount };
  }
  // law 2: everything else that carried a real date is a reminder for that
  // day. An appointment with no time, a bill with no amount, a package.
  return { verb: "remind", title, date };
}

// The button. Each one names the surface it writes to, because "Add It" on a
// card that could mean three different things is the shape of button this app
// spent a month removing.
//
// "remind" says Add Task and not "Remind Me", under the standing law that a
// label may only promise what the handler performs. A reminder in this app is
// a thing that pings daily and resets at midnight; a package arriving on
// Wednesday is a one-off with a date on it, which is a task. Calling it a
// reminder would have been the nicer word for the wrong object.
//
// SHORT, BECAUSE THE PILL EATS THE TITLE. "Add to Schedule" measured 145px of
// a 358px card and left the title 127px, the narrowest on the page: "Dental
// Cleaning" wrapped onto two lines to make room for the button telling him
// what the button did. Same failure as "Pick Something" three days ago, which
// took 139px and cost its title a third of its width. "Schedule It" is the
// app's own vocabulary anyway, next to Draft It and Finish It, and "Add Bill"
// is exactly parallel to the "Add Task" on the card above it.
export function actLabel(a: MailAct): string {
  return a.verb === "schedule" ? "Schedule" : a.verb === "bill" ? "Add Bill" : "Add Task";
}
