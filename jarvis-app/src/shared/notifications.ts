// Single notifications seam, mirroring haptics.ts: call sites use semantic
// methods and never touch the platform API. NATIVE (Capacitor iOS): daily
// local notifications via @capacitor/local-notifications, no server and no
// APNs needed. WEB: a clean no-op, so the PWA never asks for permission it
// will not use well.
//
// These exist to serve the check-in thesis: for ADHD brains initiation is the
// hard part, so the app starts the conversation. Two gentle nudges a day, both
// deep-linking into questions that already exist on Today. Never more, never
// guilt.
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { RoutineData } from "../routine/types";
import { LADDER, ladderBody, type Rung } from "../schedule/countdown";
import { addDays } from "../schedule/calendar";
import type { ReminderInfo } from "../notes/types";
import { runsOn, effectiveTime, isDone } from "../tasks/reminders";

export interface CheckinNotification {
  id: number;
  title: string;
  body: string;
  hour: number;
  minute: number;
}

// Stable ids so re-scheduling replaces instead of stacking.
export const MORNING_ID = 9001;
export const EVENING_ID = 9002;
// UP-ATH-03 (2026-09-06): the rest timer's own reserved id, in the same low
// block as the check-ins and clear of both spans below (9100+ and 9300+), so
// arming a rest can never cancel an event rung or a task reminder.
export const REST_OVER_ID = 9003;

// ---- THE BUDGET (SHARED-F-05, 2026-09-05) ----
//
// iOS keeps at most 64 PENDING local notifications per app
// (UNUserNotificationCenter's documented limit) and silently drops the rest
// by fire time. The three blocks below were sized for the app's own id
// ranges instead: 120 event rungs plus 60 task reminders plus the two
// check-ins is 182, so on a two-day stretch with sixteen timed events
// (4 rungs each = 64) tomorrow's later events and the evening's task
// reminders never fired and nothing in the app knew.
//
// So the whole app's notification spend is ONE arithmetic, here, and every
// scheduler takes its share from it. Anything that wants more has to argue
// with the other two in this block rather than quietly overrunning the OS.
export const IOS_PENDING_LIMIT = 64;
// Two repeating daily nudges (morning and evening), always scheduled first.
export const CHECKIN_BUDGET = 2;
// Task reminders (SHARED-F-08 expands these to a week, soonest first).
export const TASK_REMINDER_CAP = 18;
// UP-ATH-03 (2026-09-06): one seat for the rest timer, and it argues for it
// here rather than quietly overrunning the OS, which is what this block is
// for. Exactly one is ever pending: a rest is a single deadline the athlete
// is standing in front of, and the next set's rest replaces it. The seat
// comes out of the event ladder, because this block's own reasoning already
// says the outermost rung of one event is the cheapest thing to lose.
export const REST_BUDGET = 1;
// Whatever is left is the event ladder's.
export const EVENT_REMINDER_CAP = IOS_PENDING_LIMIT - CHECKIN_BUDGET - TASK_REMINDER_CAP - REST_BUDGET;

// The id ranges EARLIER BUILDS scheduled into. A phone upgrading from the
// 120/60 caps still has those ids pending, and a cancel pass that only
// covered the new, smaller caps would leave the overflow buzzing forever for
// events that no longer exist. Cancel across the old span, schedule inside
// the budget, and route a tap on either.
export const EVENT_REMINDER_SPAN = 120;
export const TASK_REMINDER_SPAN = 60;

// The two daily check-in nudges, derived from the routine:
// - morning ONE-thing ask at the brief time (or 15 min after wake), matching
//   CheckIn's before-noon window
// - evening mood ask two hours before bed, never before 6 PM, matching
//   CheckIn's after-6 window; skipped entirely for schedules it cannot fit
export function buildCheckinNotifications(routine: RoutineData, briefTime?: string): CheckinNotification[] {
  const out: CheckinNotification[] = [];

  // SHARED-F-24 (2026-09-05): a brief time of "12:30" (a late shift) or a
  // brief the app could not parse both fell through the old `morningMin <
  // 12 * 60` gate, and the morning nudge simply never came, with nothing on
  // the Routine or Notifications page saying why. Two answers, both here:
  // an unreadable brief falls back to the wake-based time rather than
  // producing NaN, and a time that lands at or after noon is CLAMPED to the
  // last minute this question still makes sense in, rather than dropped. The
  // ask exists either way now, which also makes the check-in pair a fixed
  // two in the notification budget (SHARED-F-05).
  const MORNING_LATEST = 11 * 60 + 45;
  const parsed = briefTime ? briefTime.split(":") : null;
  const fromBrief = parsed ? Number(parsed[0]) * 60 + Number(parsed[1] ?? 0) : NaN;
  const wakeBased = routine.wakeMin + 15;
  const morningMin = Math.min(
    Number.isFinite(fromBrief) ? fromBrief : wakeBased,
    MORNING_LATEST,
  );
  // A routine with an unreadable wake time and no brief is the one case left
  // with nothing to schedule from; a NaN hour would be a silent no-op inside
  // iOS anyway.
  if (Number.isFinite(morningMin)) {
    out.push({
      id: MORNING_ID,
      // S1-04 (2026-09-04): the old copy asked "What's your ONE thing
      // today?", a question Today stopped having an answer field for on
      // 2026-07-30 (see today/CheckIn.tsx) -- Up Next took over answering
      // it. Retitled to something the tap now actually lands on.
      title: "Ready to start the day?",
      body: "Up Next has your first move",
      hour: Math.floor(morningMin / 60),
      minute: morningMin % 60,
    });
  }

  // Overnight-safe (2026-08-10): a bedtime at or before the wake time (1 AM)
  // means bed is tomorrow on the clock, so read it as sleepMin + 24h. The old
  // math turned "bed at 1 AM" into a negative offset and the eveningMin <
  // sleepMin guard silently dropped the evening check-in for every night owl.
  const sleepAdj = routine.sleepMin <= routine.wakeMin ? routine.sleepMin + 24 * 60 : routine.sleepMin;
  const eveningMin = Math.max(18 * 60, sleepAdj - 120);
  if (eveningMin < sleepAdj && eveningMin < 24 * 60) {
    out.push({
      id: EVENING_ID,
      title: "How did today feel?",
      body: "One tap · Better plans",
      hour: Math.floor(eveningMin / 60),
      minute: eveningMin % 60,
    });
  }

  return out;
}

// S1-03 (2026-09-04): "The events switch cannot work on its own." The ask
// used to live only inside ensureCheckinNotifications below, gated on the
// Daily check-ins switch specifically, so turning that switch off while
// leaving Today's events on permanently blocked the event ladder with no
// explanation: nothing else ever asked. Notifications.tsx now owns the ask,
// on the page, the first time any of its four switches goes on. Safe to call
// more than once: iOS answers a repeat request with whatever was already
// decided rather than re-prompting, so this and the automatic check-in call
// below can never fight over showing the dialog twice.
export async function requestNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === "granted") return true;
    const req = await LocalNotifications.requestPermissions();
    return req.display === "granted";
  } catch {
    return false;
  }
}

// SHARED-F-02 (2026-09-05): what the OS actually says, for the one page whose
// copy makes a promise about it. requestNotificationPermission above answers
// a boolean, which cannot tell "not asked yet" from "asked and refused", and
// its only UI caller discarded even that. Four states, because the honest
// footer differs for each: "unsupported" is the web, where this seam is a
// deliberate no-op.
export type NotifyPermission = "granted" | "denied" | "prompt" | "unsupported";

export async function notificationPermissionState(): Promise<NotifyPermission> {
  if (!Capacitor.isNativePlatform()) return "unsupported";
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === "granted") return "granted";
    return perm.display === "denied" ? "denied" : "prompt";
  } catch {
    return "unsupported";
  }
}

// ---- ONE AT A TIME (SHARED-F-06, 2026-09-05) ----
//
// Every scheduler below is cancel-then-schedule: two awaited bridge calls
// with nothing holding the door between them. Today's effects re-run several
// times per reload (their deps land one setState at a time), so run A could
// cancel, run B could cancel, A could schedule the OLD six rungs and B the
// new four: A's extra ids survive and the phone buzzes for an event that no
// longer exists. Each block gets its own queue, and a newer call supersedes
// an older one still waiting, because the newest state is the only one worth
// writing to the OS.
type Job = () => Promise<void>;

export function serializeLatest(): (job: Job) => Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  let latest: Job | null = null;
  return (job: Job) => {
    latest = job;
    chain = chain.then(async () => {
      // Superseded while it waited: the run that replaced it writes the same
      // ids from fresher state, so doing this one first is pure churn.
      if (latest !== job) return;
      latest = null;
      await job();
    }).catch(() => { /* a scheduler never throws into the UI */ });
    return chain;
  };
}

const checkinQueue = serializeLatest();
const eventQueue = serializeLatest();
const taskQueue = serializeLatest();
const restQueue = serializeLatest();

// ---- Rest over (UP-ATH-03, 2026-09-06) ----
//
// "The timer is silent and only counts while the screen is on." GYM-F-01
// gave the countdown a wall clock and the same three-note cue plus success
// haptic the conditioning clock plays, which covers a phone that is awake.
// A phone face-down in a gym bag is not awake: WKWebView suspends the JS
// timer, so nothing in the app can fire at zero. Only the OS can, which is
// what this is.
//
// One pending at a time, by construction: a single reserved id, cancelled
// before it is scheduled, and cancelled again when the rest is dismissed or
// the timer leaves the screen. Same rules as every other scheduler here:
// native-only, permission-gated, never prompts, never throws into the UI.
export async function scheduleRestOver(at: number, body: string, nowMs: number = Date.now()): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  return restQueue(async () => {
    try {
      await LocalNotifications.cancel({ notifications: [{ id: REST_OVER_ID }] });
      // A rest that is already over has nothing to announce: the athlete
      // either watched it end or is reading it now.
      if (at <= nowMs) return;
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== "granted") return;
      await LocalNotifications.schedule({
        notifications: [{ id: REST_OVER_ID, title: "Rest over", body, schedule: { at: new Date(at), allowWhileIdle: true } }],
      });
    } catch {
      /* notifications are a bonus, never a crash */
    }
  });
}

export async function cancelRestOver(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  return restQueue(async () => {
    try {
      await LocalNotifications.cancel({ notifications: [{ id: REST_OVER_ID }] });
    } catch {
      /* notifications are a bonus, never a crash */
    }
  });
}

// ---- BUTTONS ON THE BANNER (UP-PLAT-01, 2026-09-06) ----
//
// The whole initiation thesis at the top of this file is that the app starts
// the conversation. A buzz you can only answer by unlocking, finding JARVIS,
// finding the tab and finding the row is not the app starting anything: it
// is a reminder to go and do the work of acting on a reminder. Two buttons on
// the lock screen close that gap.
//
// No Swift and no enrollment: @capacitor/local-notifications registers
// UNNotificationCategory action types itself, and reports which button was
// hit as `actionId` on the same localNotificationActionPerformed event the
// plain tap already comes through. native/ios/NotificationActions.swift and
// notificationActionsBridge were the pre-Capacitor plan for this and are
// deleted in the same commit.
//
// Done and Tomorrow are background actions (foreground defaults to false), so
// tapping either answers the buzz without the app coming to the front. Open
// is a foreground action because opening the event is the entire point of it.
export const TASK_ACTION_TYPE = "jarvis-task";
export const EVENT_ACTION_TYPE = "jarvis-event";
export const ACTION_DONE = "done";
export const ACTION_TOMORROW = "tomorrow";
export const ACTION_OPEN = "open";

// Registered once per launch. Memoised on the promise rather than a boolean
// so the schedulers below can await it, and reset on failure so a transient
// error is retried rather than leaving every later banner button-less.
let actionTypes: Promise<void> | null = null;

export function registerNotificationActions(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  if (!actionTypes) {
    actionTypes = Promise.resolve()
      .then(() => LocalNotifications.registerActionTypes({
        types: [
          {
            id: TASK_ACTION_TYPE,
            actions: [
              { id: ACTION_DONE, title: "Done" },
              { id: ACTION_TOMORROW, title: "Tomorrow" },
            ],
          },
          {
            id: EVENT_ACTION_TYPE,
            actions: [{ id: ACTION_OPEN, title: "Open", foreground: true }],
          },
        ],
      }))
      .then(() => { /* registered for this launch */ })
      .catch(() => { actionTypes = null; });
  }
  return actionTypes;
}

// Cancel-then-schedule so routine changes always win and nothing stacks.
// Native only; resolves quietly everywhere else. Never throws into the UI.
//
// SHARED-F-07 (2026-09-05): CHECK-ONLY, like the other two schedulers. This
// one used to REQUEST the permission, and Today calls it on mount with
// checkins defaulting to true, so a fresh install landed on Today and iOS
// asked "JARVIS Would Like to Send You Notifications" before the user had
// seen a single screen explaining why. A denial there is permanent (iOS
// never re-prompts) and it costs App Store review too. The ask belongs where
// it is in context and can be repeated: onboarding's morning-brief step,
// right after he chooses when to be nudged, and the Notifications page's own
// switches (S1-03). Scheduling never asks.
export async function ensureCheckinNotifications(routine: RoutineData, briefTime?: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  return checkinQueue(async () => {
    try {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== "granted") return;
      await LocalNotifications.cancel({ notifications: [{ id: MORNING_ID }, { id: EVENING_ID }] });
      const specs = buildCheckinNotifications(routine, briefTime);
      if (specs.length === 0) return;
      await LocalNotifications.schedule({
        notifications: specs.map((s) => ({
          id: s.id,
          title: s.title,
          body: s.body,
          schedule: { on: { hour: s.hour, minute: s.minute }, allowWhileIdle: true },
        })),
      });
    } catch {
      /* notifications are a bonus, never a crash */
    }
  });
}

// The off switch (2026-08-09): the Notifications page gained a Daily
// check-ins toggle, and off has to actually cancel what is scheduled.
// Through the same queue as the scheduler: an off tap that overtook a
// pending reschedule would cancel first and be re-scheduled a moment later.
export async function cancelCheckinNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  return checkinQueue(async () => {
      try {
        await LocalNotifications.cancel({ notifications: [{ id: MORNING_ID }, { id: EVENING_ID }] });
      } catch {
        /* notifications are a bonus, never a crash */
      }
  });
}

// ---- Event reminders (2026-08-09) ----
// The time-blindness feature: "Standup in 15 minutes" on the lock screen.
// Same seam, same rules as the check-ins: native-only, permission-gated,
// cancel-then-schedule, and a bonus rather than a crash. Ids live in their
// own block so re-scheduling can never touch the check-in pair.

export const EVENT_REMINDER_BASE = 9100;
// SHARED-F-20 (2026-09-05): EVENT_REMINDER_LEAD_MIN went. It was a single
// fifteen-minute lead that predates the ladder, and nothing has read it since
// LADDER in schedule/countdown.ts replaced it with four rungs.

// S6-Q36: the first move named on this event's source task, when it has
// one (see schedule/attachments.ts's firstMoveOf). Optional, additive: an
// event with none falls back to the ladder's generic closing copy.
// UP-CORE-07 (2026-09-05): leaveMin is the whole lead (travel plus buffer)
// for an event that has to be travelled to. It buys ONE more rung, at the
// leave time, which is the only alert in this app that says stand up now.
//
// UP-PLAT-01 (2026-09-06): `eventId` rides along so the banner can carry it
// in `extra` and a tap opens THAT event rather than the Schedule tab. It is
// optional because the builder is pure and its tests construct inputs by
// hand; a rung without one still routes to the tab, exactly as before.
export interface ReminderInput { id?: string; date: string; start: string; end?: string; title: string; location?: string; firstMove?: string; leaveMin?: number }
export interface EventReminder { id: number; title: string; body: string; at: Date; eventId?: string }

// Pure: which reminders exist for these events, from this moment. Only
// future fire-times survive (a reminder for something already started is
// noise). Sorted by fire time so ids are stable for a given day's shape.
export function buildEventReminders(
  events: ReminderInput[],
  nowMs: number,
  // B1 (2026-08-20): a LADDER, not a ping. One alert fifteen minutes out is a
  // single moment you can be mid-something and miss; 60/30/15/5 builds the
  // event into something real before it lands. Rungs whose lead has already
  // passed are skipped, never stacked, so a thing happening in twenty minutes
  // never claims to be an hour away.
  ladder: readonly number[] = LADDER,
): EventReminder[] {
  const out: (EventReminder & { lead: number; leave?: boolean })[] = [];
  for (const e of events) {
    if (!e.title.trim() || !/^\d{2}:\d{2}$/.test(e.start)) continue;
    const startMs = new Date(`${e.date}T${e.start}:00`).getTime();
    if (!Number.isFinite(startMs)) continue;
    const minutesUntil = (startMs - nowMs) / 60000;
    // S1-05 (2026-09-04): countdown.ts's own law says the ladder's upper
    // rungs are off by default on short events ("a fifteen-minute reminder
    // does not need an hour of warning"), but this builder had no end time
    // to know an event's length at all -- every event got the full four
    // rungs regardless of how long it actually ran. A rung longer than the
    // event itself is dropped; an event with no end time (duration unknown)
    // keeps every rung, exactly as it did before this fix.
    const endMs = e.end && /^\d{2}:\d{2}$/.test(e.end) ? new Date(`${e.date}T${e.end}:00`).getTime() : NaN;
    const durationMin = Number.isFinite(endMs) && endMs > startMs ? (endMs - startMs) / 60000 : null;
    // UP-CORE-07: the leave rung, when this event has a travel time. It is
    // an INSTRUCTION, the same voice the ladder's closing rung uses, and it
    // is the one rung this app would keep if it could only keep one: a
    // person who is told at 3:20 to leave for a 3:40 practice is on time,
    // and no other alert in the ladder can say that.
    const leaveLead = Number.isFinite(e.leaveMin) && (e.leaveMin ?? 0) > 0 ? Math.round(e.leaveMin!) : null;
    if (leaveLead !== null && leaveLead < minutesUntil) {
      const at = new Date(startMs - leaveLead * 60000);
      if (at.getTime() > nowMs) {
        out.push({
          id: 0,
          title: e.title.trim(),
          body: e.location ? `Leave now for ${e.location}` : "Leave now",
          at,
          lead: leaveLead,
          leave: true,
          // UP-PLAT-01: the leave rung carries the id too. It is the one
          // alert that says stand up now, so a tap on it has more reason
          // than any other rung to open that exact event.
          eventId: e.id,
        });
      }
    }
    for (const lead of ladder) {
      if (lead >= minutesUntil) continue; // already past this rung
      if (durationMin !== null && lead > durationMin) continue; // longer than the event itself
      // A ladder rung landing on the same minute as the leave alert would
      // buzz twice for one moment, and the leave one is the one that says
      // what to do.
      if (leaveLead !== null && lead === leaveLead) continue;
      const at = new Date(startMs - lead * 60000);
      if (at.getTime() <= nowMs) continue;
      out.push({
        id: 0, // assigned after sorting
        title: e.title.trim(),
        body: ladderBody(lead as Rung, e.location, e.firstMove),
        at,
        lead,
        eventId: e.id,
      });
    }
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  // SHARED-F-05 (2026-09-05): over budget, the OUTERMOST rungs go first, not
  // whole events. Losing the hour's warning on a busy day costs the least;
  // losing an event entirely means one thing on the calendar goes unannounced
  // while another has four alerts. Every event keeps its 15 and 5 minute
  // rungs until the day is so full that even those do not fit, and only then
  // does the slice below drop the latest-firing ones.
  // UP-CORE-07: the leave rung is never one of the ones dropped for budget.
  // It is matched on its flag, not its lead, so a 30 minute drive does not
  // get swept up with the ladder's 30 minute rung.
  let kept = out;
  for (const rung of [60, 30]) {
    if (kept.length <= EVENT_REMINDER_CAP) break;
    kept = kept.filter((r) => r.leave || r.lead !== rung);
  }
  return kept.slice(0, EVENT_REMINDER_CAP).map((r, i) => ({ id: EVENT_REMINDER_BASE + i, title: r.title, body: r.body, at: r.at, eventId: r.eventId }));
}

export async function ensureEventReminders(events: ReminderInput[], nowMs: number = Date.now()): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  return eventQueue(async () => {
    try {
      const perm = await LocalNotifications.checkPermissions();
      // Never prompt from here: the check-in flow owns the permission ask, so
      // the user is asked once, in context, not ambushed by a schedule refresh.
      if (perm.display !== "granted") return;
      await LocalNotifications.cancel({
        // The old span, not the budget: an upgraded phone still holds ids an
        // earlier build scheduled (see EVENT_REMINDER_SPAN).
        notifications: Array.from({ length: EVENT_REMINDER_SPAN }, (_, i) => ({ id: EVENT_REMINDER_BASE + i })),
      });
      const specs = buildEventReminders(events, nowMs);
      if (specs.length === 0) return;
      // UP-PLAT-01: awaited, so the category exists before the first banner
      // that names it does. A failed registration costs the buttons, never
      // the notification.
      await registerNotificationActions();
      await LocalNotifications.schedule({
        notifications: specs.map((s) => ({
          id: s.id,
          title: s.title,
          body: s.body,
          schedule: { at: s.at, allowWhileIdle: true },
          actionTypeId: EVENT_ACTION_TYPE,
          extra: s.eventId ? { eventId: s.eventId } : undefined,
        })),
      });
    } catch {
      /* notifications are a bonus, never a crash */
    }
  });
}

// ---- Task reminders (S1-01, 2026-09-04) ----
// "Set 'Meds, 9:00 PM, every day' and nothing ever buzzes." The scheduler
// above only ever took calendar events; a reminder is a task wearing
// reminder facts (notes/types.ts) and reached none of it. Same seam, same
// rules: native-only, permission-gated (never prompts from here; the
// check-in flow owns that ask), cancel-then-schedule, a bonus rather than a
// crash. Its own id block, so rescheduling here can never touch check-ins
// or event reminders.
//
// Dated notifications, not one repeating daily one: a repeating
// on:{hour,minute} fires every day regardless of `days` and cannot carry a
// snooze. Expanding into concrete Date instances is the only shape that can
// honor both, and it is the shape event reminders already schedule in.

export const TASK_REMINDER_BASE = 9300;

export interface TaskReminderInput { id: string; text: string; reminder: ReminderInfo }
// UP-PLAT-01 (2026-09-06): `taskId` is the task the banner is about, which
// the builder had in hand all along and dropped. Done and Tomorrow on the
// lock screen need it, and so does a plain tap that opens the task itself
// rather than the tab it lives on.
export interface TaskReminderNotification { id: number; title: string; body: string; at: Date; taskId: string }

// TODAY-F-10 (2026-09-05): "If You Miss It: Ask Again in 15m" is the DEFAULT
// on every reminder (ReminderSheet's onMiss), and nothing ever asked again.
// The phone buzzed once at 9:00 and that was the whole behaviour, unless he
// opened JARVIS, scrolled to Your Move and tapped the button himself. B4 put
// the setting on screen; the scheduler was never taught it. A nagging
// reminder gets a second fire time fifteen minutes later, and ticking it
// clears both: the reschedule this file already runs on every change cancels
// the block and rebuilds it, and a done reminder builds nothing (isDone).
export const NAG_AFTER_MIN = 15;

// TODAY-F-15 / SHARED-F-08 (2026-09-05): A WEEK, NOT TWO DAYS.
//
// The builder expanded today and tomorrow only, and TodayFlow's effect was
// the only thing that ever refreshed it, so a reminder was armed for at most
// 48 hours from the last visit to Today. "Meds, 9 PM, every day" fired Friday
// and Saturday; a weekend away, or two days lived in the Tasks tab, and
// Sunday and Monday were silent with no warning. The one feature whose whole
// purpose is to work when the user is not in the app depended on the user
// being in the app every second day. Seven days of expansion covers a normal
// gap, the budget (SHARED-F-05) keeps the soonest ones and drops the rest,
// and AppShell re-arms on every foreground so the window keeps sliding.
export const REMINDER_DAYS_AHEAD = 7;

// Pure: the real fire times for every reminder over the days ahead, honoring
// its days (reminders.ts runsOn), its snooze (effectiveTime, which only
// applies on the day it was set), and its last-done (isDone: a reminder
// already ticked for a date does not ping again for it). Only future
// fire-times survive, same rule as buildEventReminders.
export function buildTaskReminderNotifications(
  reminders: TaskReminderInput[],
  today: string,
  nowMs: number,
  daysAhead: number = REMINDER_DAYS_AHEAD,
): TaskReminderNotification[] {
  const dates: string[] = [];
  // Stepped as calendar days (addDays uses setDate), never by adding a day's
  // worth of milliseconds, so the clocks-change days keep their real dates.
  for (let i = 0; i < Math.max(1, daysAhead); i++) dates.push(i === 0 ? today : addDays(today, i));
  const out: { title: string; body: string; at: Date; taskId: string }[] = [];
  for (const r of reminders) {
    if (!r.text.trim()) continue;
    for (const date of dates) {
      if (!runsOn(r.reminder, date) || isDone(r.reminder, date)) continue;
      // A snooze set today only ever applies to today's ping (effectiveTime
      // enforces that itself); tomorrow's occurrence always uses the real time.
      const time = date === today ? effectiveTime(r.reminder, today) : r.reminder.time;
      const at = new Date(`${date}T${time}:00`);
      if (!Number.isFinite(at.getTime())) continue;
      if (at.getTime() > nowMs) out.push({ title: r.text.trim(), body: "Reminder", at, taskId: r.id });
      // "Let it go" means exactly that, here as everywhere else (see
      // reminders.ts): it fires once and never chases. Everything else nags,
      // because that is what the setting he was given says by default.
      //
      // Judged on its own fire time, not the ping's: a reschedule that runs
      // in the ten minutes AFTER the reminder buzzed (Today reloads
      // constantly) would otherwise drop the follow-up as part of an
      // occurrence already past, which is the one moment it exists for.
      if (r.reminder.onMiss !== "let_go") {
        const again = new Date(at.getTime() + NAG_AFTER_MIN * 60_000);
        if (again.getTime() > nowMs) out.push({ title: r.text.trim(), body: "Asking again", at: again, taskId: r.id });
      }
    }
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out.slice(0, TASK_REMINDER_CAP).map((x, i) => ({ ...x, id: TASK_REMINDER_BASE + i }));
}

export async function ensureTaskReminders(
  reminders: TaskReminderInput[],
  today: string,
  nowMs: number = Date.now(),
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  return taskQueue(async () => {
    try {
      const perm = await LocalNotifications.checkPermissions();
      // Never prompt from here, same rule as event reminders: the check-in
      // flow owns the permission ask, in context, once.
      if (perm.display !== "granted") return;
      await LocalNotifications.cancel({
        notifications: Array.from({ length: TASK_REMINDER_SPAN }, (_, i) => ({ id: TASK_REMINDER_BASE + i })),
      });
      const specs = buildTaskReminderNotifications(reminders, today, nowMs);
      if (specs.length === 0) return;
      await registerNotificationActions();
      await LocalNotifications.schedule({
        notifications: specs.map((s) => ({
          id: s.id,
          title: s.title,
          body: s.body,
          schedule: { at: s.at, allowWhileIdle: true },
          actionTypeId: TASK_ACTION_TYPE,
          extra: { taskId: s.taskId },
        })),
      });
    } catch {
      /* notifications are a bonus, never a crash */
    }
  });
}

// ---- Tap routing (S1-04, 2026-09-04) ----
// "A notification tap lands nowhere." No LocalNotifications.addListener
// existed anywhere in the app: a tap just opened JARVIS wherever it was last
// left, cold. Every notification id above lives in its own numbered block on
// purpose (check-ins, event reminders, task reminders); this reads that
// block back to say which screen the tap is about, and AppShell (the one
// place that owns tab navigation and outlives every screen) is the single
// subscriber that turns that into a real destination.

export type NotificationKind = "morning" | "evening" | "event" | "reminder" | null;

export function kindOfNotification(id: number): NotificationKind {
  if (id === MORNING_ID) return "morning";
  if (id === EVENING_ID) return "evening";
  // The spans, so a tap on a notification an earlier build scheduled still
  // lands on the right screen instead of nowhere.
  if (id >= EVENT_REMINDER_BASE && id < EVENT_REMINDER_BASE + EVENT_REMINDER_SPAN) return "event";
  if (id >= TASK_REMINDER_BASE && id < TASK_REMINDER_BASE + TASK_REMINDER_SPAN) return "reminder";
  return null;
}

// UP-PLAT-01 (2026-09-06): what the user did, not just which block it was
// in. `actionId` is Capacitor's own id for the button; the plain body tap
// reports "tap" and a swipe-away reports "dismiss". `taskId`/`eventId` come
// out of the notification's `extra`, which the two schedulers above now fill,
// so the handler can open the exact item instead of guessing at a tab.
export interface NotificationTap {
  kind: NotificationKind;
  id: number;
  actionId: string;
  taskId?: string;
  eventId?: string;
}

// The plain body tap. Capacitor's constant, restated here so the routing
// side never has to know the string.
export const ACTION_TAP = "tap";

function extraOf(extra: unknown, key: "taskId" | "eventId"): string | undefined {
  if (!extra || typeof extra !== "object") return undefined;
  const v = (extra as Record<string, unknown>)[key];
  return typeof v === "string" && v ? v : undefined;
}

// Native-only; a clean no-op (and no-op unsubscribe) everywhere else, same
// contract as every other function in this file. Fire-and-forget listener
// registration: Capacitor resolves addListener with a handle whose remove()
// is itself async, which the returned cleanup awaits without surfacing.
export function onNotificationTap(handler: (tap: NotificationTap) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};
  const sub = LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    const id = action.notification.id;
    const extra = action.notification.extra;
    handler({
      kind: kindOfNotification(id),
      id,
      actionId: action.actionId,
      taskId: extraOf(extra, "taskId"),
      eventId: extraOf(extra, "eventId"),
    });
  });
  return () => { void sub.then((h) => h.remove()); };
}
