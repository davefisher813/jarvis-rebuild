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

// The two daily check-in nudges, derived from the routine:
// - morning ONE-thing ask at the brief time (or 15 min after wake), matching
//   CheckIn's before-noon window
// - evening mood ask two hours before bed, never before 6 PM, matching
//   CheckIn's after-6 window; skipped entirely for schedules it cannot fit
export function buildCheckinNotifications(routine: RoutineData, briefTime?: string): CheckinNotification[] {
  const out: CheckinNotification[] = [];

  let morningMin: number;
  if (briefTime) {
    const p = briefTime.split(":");
    morningMin = Number(p[0] ?? 7) * 60 + Number(p[1] ?? 0);
  } else {
    morningMin = routine.wakeMin + 15;
  }
  if (morningMin < 12 * 60) {
    out.push({
      id: MORNING_ID,
      title: "What's your ONE thing today?",
      body: "Pick it and everything else is extra credit.",
      hour: Math.floor(morningMin / 60),
      minute: morningMin % 60,
    });
  }

  const eveningMin = Math.max(18 * 60, routine.sleepMin - 120);
  if (eveningMin < routine.sleepMin && eveningMin < 24 * 60) {
    out.push({
      id: EVENING_ID,
      title: "How did today feel?",
      body: "One tap. It helps me plan better days.",
      hour: Math.floor(eveningMin / 60),
      minute: eveningMin % 60,
    });
  }

  return out;
}

// Cancel-then-schedule so routine changes always win and nothing stacks.
// Native only; resolves quietly everywhere else. Never throws into the UI.
export async function ensureCheckinNotifications(routine: RoutineData, briefTime?: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== "granted") {
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== "granted") return;
    }
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
}

// The off switch (2026-08-09): the Notifications page gained a Daily
// check-ins toggle, and off has to actually cancel what is scheduled.
export async function cancelCheckinNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: MORNING_ID }, { id: EVENING_ID }] });
  } catch {
    /* notifications are a bonus, never a crash */
  }
}

// ---- Event reminders (2026-08-09) ----
// The time-blindness feature: "Standup in 15 minutes" on the lock screen.
// Same seam, same rules as the check-ins: native-only, permission-gated,
// cancel-then-schedule, and a bonus rather than a crash. Ids live in their
// own block so re-scheduling can never touch the check-in pair.

export const EVENT_REMINDER_BASE = 9100;
export const EVENT_REMINDER_CAP = 40; // two days of events is nowhere near this
export const EVENT_REMINDER_LEAD_MIN = 15;

export interface ReminderInput { date: string; start: string; title: string; location?: string }
export interface EventReminder { id: number; title: string; body: string; at: Date }

// Pure: which reminders exist for these events, from this moment. Only
// future fire-times survive (a reminder for something already started is
// noise). Sorted by fire time so ids are stable for a given day's shape.
export function buildEventReminders(
  events: ReminderInput[],
  nowMs: number,
  leadMin: number = EVENT_REMINDER_LEAD_MIN,
): EventReminder[] {
  const out: EventReminder[] = [];
  for (const e of events) {
    if (!e.title.trim() || !/^\d{2}:\d{2}$/.test(e.start)) continue;
    const at = new Date(`${e.date}T${e.start}:00`);
    at.setMinutes(at.getMinutes() - leadMin);
    if (at.getTime() <= nowMs) continue;
    out.push({
      id: 0, // assigned after sorting
      title: e.title.trim(),
      body: `Starts in ${leadMin} minutes${e.location?.trim() ? ` · ${e.location.trim()}` : ""}`,
      at,
    });
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out.slice(0, EVENT_REMINDER_CAP).map((r, i) => ({ ...r, id: EVENT_REMINDER_BASE + i }));
}

export async function ensureEventReminders(events: ReminderInput[], nowMs: number = Date.now()): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const perm = await LocalNotifications.checkPermissions();
    // Never prompt from here: the check-in flow owns the permission ask, so
    // the user is asked once, in context, not ambushed by a schedule refresh.
    if (perm.display !== "granted") return;
    await LocalNotifications.cancel({
      notifications: Array.from({ length: EVENT_REMINDER_CAP }, (_, i) => ({ id: EVENT_REMINDER_BASE + i })),
    });
    const specs = buildEventReminders(events, nowMs);
    if (specs.length === 0) return;
    await LocalNotifications.schedule({
      notifications: specs.map((s) => ({
        id: s.id,
        title: s.title,
        body: s.body,
        schedule: { at: s.at, allowWhileIdle: true },
      })),
    });
  } catch {
    /* notifications are a bonus, never a crash */
  }
}
