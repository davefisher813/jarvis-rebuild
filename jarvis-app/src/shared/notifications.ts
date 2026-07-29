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
