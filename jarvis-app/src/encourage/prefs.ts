import { readMirror, SETTING_FEEDBACK } from "../data/SettingsService";

// FEEDBACK STYLE: what the app does, and does not do, when a step gets done
// (ADHD Reward Design Brief, Dave-approved 2026-10-04).
//
// This is a motivation-and-feedback system, not a reward system. The brief's
// finding is that nothing proves an animation motivates anyone, so the
// defaults are small and honest: a checkmark, one short pulse, one plain
// sentence saying what is now true. Everything louder is a choice, and every
// choice is independent of the others (expressive visuals with no sound is a
// valid setting, and so is a quiet screen with full encouragement).
//
// Laws held by laws/feedback.test.ts:
//   - There is no score, no level, no leaderboard and no mystery reward here.
//   - There is no counter that resets to zero and nothing that decays.
//   - The plain confirmation of a changed state is never switched off by any
//     setting. Celebration can be Off; saying what happened cannot be.
//   - The defaults below are the Gentle defaults from the brief.

export type Celebration = "off" | "gentle" | "expressive";
export type MotionPref = "system" | "reduced";
export type Encouragement = "factual" | "warm" | "minimal";

export interface FeedbackPrefs {
  celebration: Celebration;
  motion: MotionPref;
  /** A short quiet tone on a completion. Off until chosen. */
  sound: boolean;
  /** The phone's tap on a completion. Off until chosen. */
  haptics: boolean;
  encouragement: Encouragement;
  /** Private is the only value in v1: nothing about a task leaves the
   *  account unless a later release adds an explicit, per-person share. */
  accountability: "private";
}

export const DEFAULT_FEEDBACK: FeedbackPrefs = {
  celebration: "gentle",
  motion: "system",
  sound: false,
  haptics: false,
  encouragement: "factual",
  accountability: "private",
};

const CELEBRATIONS: readonly Celebration[] = ["off", "gentle", "expressive"];
const MOTIONS: readonly MotionPref[] = ["system", "reduced"];
const ENCOURAGEMENTS: readonly Encouragement[] = ["factual", "warm", "minimal"];

/** Whatever was stored, made into a complete and valid set. A value from a
 *  newer or older build that this one does not know falls back to the
 *  default for that one setting, never to a loud one. */
export function sanitizeFeedback(raw: unknown): FeedbackPrefs {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  return {
    celebration: pick(r.celebration, CELEBRATIONS, DEFAULT_FEEDBACK.celebration),
    motion: pick(r.motion, MOTIONS, DEFAULT_FEEDBACK.motion),
    sound: r.sound === true,
    haptics: r.haptics === true,
    encouragement: pick(r.encouragement, ENCOURAGEMENTS, DEFAULT_FEEDBACK.encouragement),
    accountability: "private",
  };
}

// The set the running app is using, kept where a non-React caller (the phone
// tap, the tone) can read it without a hook. The provider writes it; before
// the provider mounts, and in tests with no provider, the account's mirror
// and then the defaults answer.
let live: FeedbackPrefs | null = null;
export function setLiveFeedback(p: FeedbackPrefs | null): void { live = p; }

export function readFeedback(): FeedbackPrefs {
  if (live) return live;
  return sanitizeFeedback(readMirror<unknown>(SETTING_FEEDBACK)?.value);
}

// QUIET TODAY: a switch that turns the decorative feedback off until
// midnight and changes nothing else. Reminders are untouched, progress stays
// visible, and the plain confirmation still appears. It lives on the device
// as the local date it was set for, so tomorrow it is simply not set and no
// one has to remember to turn it back on.
export const QUIET_KEY = "jarvis.quiettoday.v1";

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function isQuietToday(today: string): boolean {
  const s = storage();
  if (!s) return false;
  try { return s.getItem(QUIET_KEY) === today; } catch { return false; }
}

export function setQuietToday(on: boolean, today: string): void {
  const s = storage();
  if (!s) return;
  try {
    if (on) s.setItem(QUIET_KEY, today); else s.removeItem(QUIET_KEY);
  } catch { /* quieting is best effort */ }
}

/** What each channel actually does right now, after the settings, the phone's
 *  own reduced-motion request and Quiet Today are all applied. */
export interface Effective {
  celebrate: Celebration;
  /** The single local pulse on the thing just completed. */
  pulse: boolean;
  /** The small radiating dots, expressive only. */
  burst: boolean;
  sound: boolean;
  haptic: boolean;
  /** Spatial motion removed everywhere the feedback system owns. */
  reduced: boolean;
}

export function effectiveFeedback(p: FeedbackPrefs, o: { systemReduced: boolean; quiet: boolean }): Effective {
  // Quiet Today behaves exactly like Celebration Off with sound and touch
  // off as well. It never touches the words.
  const celebrate: Celebration = o.quiet ? "off" : p.celebration;
  const reduced = p.motion === "reduced" || o.systemReduced;
  return {
    celebrate,
    pulse: celebrate !== "off" && !reduced,
    burst: celebrate === "expressive" && !reduced,
    sound: !o.quiet && p.sound,
    haptic: !o.quiet && p.haptics,
    reduced,
  };
}

export function systemPrefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
