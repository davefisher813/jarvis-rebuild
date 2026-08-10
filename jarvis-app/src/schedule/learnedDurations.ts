import { eventLog } from "../events";

// Learned plan lengths (2026-08-09). Every committed plan block logs its
// category and minutes (plan.duration_committed). This turns that history
// into per-category defaults so the duration stepper starts where the user
// actually lands instead of at a flat 30, and the stepper becomes something
// you confirm rather than operate.
//
// Same evidence discipline as every other learning in this app: at least
// three samples inside the window or silence, the median so one outlier
// afternoon cannot skew a category, snapped to the stepper's own step so the
// prefill never shows a number the controls cannot reproduce.

const WINDOW_MS = 30 * 86400000;
const MIN_SAMPLES = 3;
const STEP = 15;
const MIN_MIN = 15;
const MAX_MIN = 180;

export interface CommittedDuration { category: string; minutes: number; ts: number }

export function readCommittedDurations(): CommittedDuration[] {
  return eventLog
    .all()
    .filter((e) => e.type === "plan.duration_committed")
    .map((e) => ({
      category: typeof e.props?.category === "string" ? e.props.category : "",
      minutes: typeof e.props?.n === "number" ? e.props.n : 0,
      ts: e.ts,
    }))
    .filter((c) => c.category !== "" && c.minutes > 0);
}

export function learnedDurations(samples: CommittedDuration[], nowMs: number): Record<string, number> {
  const byCat = new Map<string, number[]>();
  for (const s of samples) {
    if (nowMs - s.ts > WINDOW_MS) continue;
    const list = byCat.get(s.category) ?? [];
    list.push(s.minutes);
    byCat.set(s.category, list);
  }
  const out: Record<string, number> = {};
  for (const [cat, mins] of byCat) {
    if (mins.length < MIN_SAMPLES) continue;
    const sorted = [...mins].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)]!;
    const snapped = Math.round(mid / STEP) * STEP;
    out[cat] = Math.max(MIN_MIN, Math.min(MAX_MIN, snapped));
  }
  return out;
}
