import { readWindow, type WindowClient } from "../brain/window";

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

// S4-Q28 (2026-09-04): this used to read only the device's own local event
// log, so a duration committed on one phone taught the planner nothing on a
// second. The window (brain/window.ts) already carries plan.duration_committed
// rows pulled from the server, and readWindow falls back to this same local
// log with no client (demo mode, offline first paint), so this replaces the
// old local-only reader rather than adding a second source to keep in sync
// with it.
export async function readCommittedDurationsWindowed(client: WindowClient | null, nowMs: number): Promise<CommittedDuration[]> {
  const rows = await readWindow(client, nowMs);
  return rows
    .filter((r) => r.type === "plan.duration_committed")
    .map((r) => ({
      category: r.category ?? "",
      minutes: r.n ?? 0,
      // The window carries a local day and hour, not a millisecond
      // timestamp (see WindowRow) -- plenty of precision for a thirty-day,
      // three-sample decision, and the same precision every other
      // window-fed derivation in the Brain already works with.
      ts: new Date(`${r.day}T${String(r.h).padStart(2, "0")}:00:00`).getTime(),
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
