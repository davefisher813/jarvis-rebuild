// UP-ATH-31 (2026-09-06, fork option A): APPLE HEALTH IN, the shape half.
//
// The Swift plugin under jarvis-app/native/ios/HealthKitPlugin.swift already
// reads workouts, steps and sleep, and healthDedupe.ts already decides which
// imported workouts survive a native session. Nothing turned any of it into
// records this app stores. This is that mapping, pure and tested now, so the
// only thing left for the native wiring session is calling it: the same
// staging pattern healthDedupe.ts itself follows.
//
// WHAT THIS REFUSES, and why each refusal is here rather than in a comment
// somewhere downstream:
//   Nothing is ever written back to HealthKit. There is no function here
//   that produces a HealthKit sample, and there is no write method on the
//   bridge to call with one.
//   Energy is not carried. HealthKit reports it and the Swift query no
//   longer asks for it (UP-ATH-31 took that read out of
//   native/ios/HealthKitPlugin.swift); nothing here reads it and nothing
//   here stores it. Health rail 3 bans the field at schema level, and BAN-3
//   is what removes the last declaration of it from the bridge type.
//   A metric log is only ever produced for a metric the user has actually
//   turned on. METRIC_PRESETS is a menu (D10-B); an import that enabled a
//   metric on the user's behalf would be the app deciding what someone
//   tracks about their own body, which is the whole thing that doctrine
//   refuses.
//   No score, no readiness, no sleep stages. Sleep arrives as asleep
//   minutes and lands as minutes; the stage breakdown HealthKit offers is
//   not read and not stored.

import type { HealthSleepNight, HealthStepsDay, HealthWorkoutRecord } from "./bridge";
import { healthProvenance } from "./healthDedupe";
import type { WorkoutData } from "../gym/types";
import type { MetricDef, MetricLogData } from "../gym/metrics";

// HKWorkoutActivityType names (the plugin lowercases them) to the words a
// person uses. Anything unmapped keeps its own name rather than being
// flattened to "Workout": a sport JARVIS has not heard of is still that
// sport, and inventing a friendlier label for it would be inventing a fact.
const ACTIVITY_LABEL: Record<string, string> = {
  running: "Run",
  walking: "Walk",
  cycling: "Ride",
  swimming: "Swim",
  rowing: "Row",
  elliptical: "Elliptical",
  stairClimbing: "Stairs",
  hiking: "Hike",
  yoga: "Yoga",
  traditionalStrengthTraining: "Lift",
  functionalStrengthTraining: "Lift",
  coreTraining: "Core",
  hiit: "Intervals",
  basketball: "Basketball",
  soccer: "Soccer",
  football: "Football",
  baseball: "Baseball",
  tennis: "Tennis",
  golf: "Golf",
  martialArts: "Martial Arts",
  other: "Workout",
};

export function activityLabel(activityType: string): string {
  return ACTIVITY_LABEL[activityType] ?? activityType;
}

function localDay(atMs: number): string {
  const d = new Date(atMs);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/**
 * One imported HealthKit workout as a JARVIS workout: a single done-kind
 * entry, because that is all an outside recorder can honestly say happened.
 * There were no sets and nobody knows what the weight was, so the record
 * carries the fact (this happened, this long) and claims nothing else.
 *
 * programId and dayId are empty on purpose: this session belongs to no
 * program and no program day, and pointing it at one would be a lie that
 * every day-keyed derivation in gym/ would then read as truth.
 */
export function workoutFromHealth(w: HealthWorkoutRecord, now: () => number = Date.now): WorkoutData {
  const label = activityLabel(w.activityType);
  return {
    programId: "",
    dayId: "",
    dayName: label,
    date: localDay(w.start),
    startedAt: w.start,
    endedAt: w.end,
    exercises: [{
      exerciseId: "apple-health-" + w.uid,
      name: label,
      kind: "done",
      sets: [{ id: "apple-health-" + w.uid + "-1", done: true }],
    }],
    source: healthProvenance(w, now),
  };
}

/** The uid an imported workout came from, or null for a hand-logged one.
 *  Idempotence keys on this: a re-sync recognises its own imports rather
 *  than writing a second copy of the same Tuesday run. */
export function importedUidOf(w: WorkoutData): string | null {
  return w.source?.type === "apple_health" ? w.source.ref ?? null : null;
}

/** The enabled, unhidden metric a preset key belongs to, or undefined. A
 *  hidden metric is off the strip, so an import has nowhere to land either. */
function enabledPreset(defs: MetricDef[], presetKey: string): MetricDef | undefined {
  return defs.find((d) => d.data.presetKey === presetKey && !d.data.hidden);
}

export const STEPS_PRESET_KEY = "steps";
export const SLEEP_PRESET_KEY = "sleep";

/**
 * Steps and sleep as metric logs, for the metrics the user turned on and
 * nothing else. Days already logged by hand are the caller's to exclude:
 * one log per metric per day is the store's rule, and a person's own typed
 * number outranks a watch's.
 *
 * Sleep lands in the Sleep preset's own unit (hours, one decimal), from
 * asleep minutes only. In-bed minutes are read by nothing here.
 */
export function metricLogsFromHealth(
  input: { steps?: HealthStepsDay[]; sleep?: HealthSleepNight[]; defs: MetricDef[] },
  now: number = Date.now(),
): MetricLogData[] {
  const out: MetricLogData[] = [];
  const stepsDef = enabledPreset(input.defs, STEPS_PRESET_KEY);
  if (stepsDef) {
    for (const d of input.steps ?? []) {
      if (d.steps <= 0) continue;
      out.push({ metricId: stepsDef.id, date: d.dayISO, value: Math.round(d.steps), at: now });
    }
  }
  const sleepDef = enabledPreset(input.defs, SLEEP_PRESET_KEY);
  if (sleepDef) {
    for (const n of input.sleep ?? []) {
      if (n.asleepMinutes <= 0) continue;
      out.push({ metricId: sleepDef.id, date: n.dayISO, value: Math.round(n.asleepMinutes / 6) / 10, at: now });
    }
  }
  return out;
}
