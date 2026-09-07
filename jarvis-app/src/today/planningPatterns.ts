import { eventLog } from "../events";
import { catName } from "../shared/categories";
import type { PatternObservation } from "./patterns";

// Brain Personalization Phase 2 (2026-08-06). A sibling to patternObservation
// (mood check-ins), not a replacement: same discipline, real repeated
// evidence or nothing, surfaced through the exact same "Remember This"
// pipeline (isPatternDismissed / dismissPattern / appendHabit already handle
// any observation id, this one included).
//
// Signal: every time Plan My Day's "Estimate with AI" result differs from
// what actually got committed, PlanDaySheet emits a plan.duration_corrected
// event (category + signed minutes, positive = ran longer than the AI
// thought). Nothing here writes to the Brain on its own; a category only
// becomes an observation, and an observation only becomes a habit, on an
// explicit tap.

export interface DurationCorrection { category: string; deltaMin: number; ts: number }

const WINDOW_MS = 30 * 86400000; // 30 days, same window Time Sense uses
// Exported 2026-09-06 for brain/readiness.ts, which reports this detector's
// gate on What JARVIS Knows beside the seven in brain/derive.ts. Same rule
// as the gates there: one definition, read by the enforcer and by the row
// that explains it, so the two cannot say different numbers.
export const MIN_COUNT = 3; // matches patternObservation's streak/weekday bars
export const MIN_AVG_ABS_MIN = 10; // a 5-minute nudge isn't worth mentioning

// Reads the local event log for recent duration-correction signals. Pure
// reshaping of the durable log into the domain shape planningPatternObservation
// consumes, kept separate so the observation function itself stays a pure,
// fully testable unit with no I/O of its own.
export function readDurationCorrections(): DurationCorrection[] {
  return eventLog
    .all()
    .filter((e): e is typeof e & { props: { category: string; n: number } } =>
      e.type === "plan.duration_corrected" &&
      typeof e.props?.category === "string" &&
      typeof e.props?.n === "number",
    )
    .map((e) => ({ category: e.props.category, deltaMin: e.props.n, ts: e.ts }));
}

// The category this observation would be about, or null. Requires at least
// MIN_COUNT corrections in the last 30 days, every one of them running the
// same direction (all longer, or all shorter), averaging at least
// MIN_AVG_ABS_MIN minutes. Anything less is noise, not a pattern.
//
// Split out of planningPatternObservation 2026-09-06, the same way slipLeader
// was split out of deriveSlipCategory (brain/derive.ts:143): once the copy
// resolves a name, "nothing to say" and "an area JARVIS can no longer name"
// are two different silences, and brain/readiness.ts has to tell them apart
// without re-implementing this gate.
export function durationLeader(corrections: DurationCorrection[], nowMs: number): { category: string; deltas: number[] } | null {
  const cutoff = nowMs - WINDOW_MS;
  const recent = corrections.filter((c) => c.ts >= cutoff && c.category.trim() !== "");
  if (recent.length === 0) return null;

  const byCategory = new Map<string, number[]>();
  for (const c of recent) {
    const list = byCategory.get(c.category) ?? [];
    list.push(c.deltaMin);
    byCategory.set(c.category, list);
  }

  // Deterministic: the category with the most evidence wins if more than one
  // qualifies. Ties break alphabetically so the result never flickers between
  // runs on the same data.
  let best: { category: string; deltas: number[] } | null = null;
  for (const [category, deltas] of byCategory) {
    if (deltas.length < MIN_COUNT) continue;
    const allLonger = deltas.every((d) => d > 0);
    const allShorter = deltas.every((d) => d < 0);
    if (!allLonger && !allShorter) continue;
    const avg = deltas.reduce((s, d) => s + Math.abs(d), 0) / deltas.length;
    if (avg < MIN_AVG_ABS_MIN) continue;
    if (!best || deltas.length > best.deltas.length ||
        (deltas.length === best.deltas.length && category < best.category)) {
      best = { category, deltas };
    }
  }
  return best;
}

// The one observation worth making right now, or null.
export function planningPatternObservation(corrections: DurationCorrection[], nowMs: number): PatternObservation | null {
  const best = durationLeader(corrections, nowMs);
  if (!best) return null;

  // BRAIN-F-05's other half (2026-09-06). plan.duration_corrected is emitted
  // with t.category (PlanDaySheet.tsx:484), which is the category ID, and this
  // copy printed the id: the card read "3fa85f64-5717-4562-b3fc-2c963f66afa6
  // tasks run 25 min long", and accepting it wrote a strand carrying that uuid
  // into every AI prompt from then on. Same resolution the slip derivation
  // already uses (brain/derive.ts:164): the user's own name through the
  // runtime registry, so a rename shows immediately, and a category that no
  // longer exists gets no observation at all, because a sentence about an area
  // nobody can see is not a fact anyone can check.
  const name = catName(best.category);
  if (!name) return null;
  const avg = Math.round(best.deltas.reduce((s, d) => s + Math.abs(d), 0) / best.deltas.length / 5) * 5;
  const longer = best.deltas[0]! > 0;
  // Keyed on the ID, never the name. This is the dedupe key the accept path
  // matches on (TodaySuggestions.tsx:369) and the dismiss memory remembers, so
  // renaming an area must not make the same observation look new and re-offer
  // a fact Dave has already answered.
  const id = `plan-dur-${longer ? "long" : "short"}-${best.category}`;
  const text = longer
    ? `${name} tasks run ${avg} min long`
    : `${name} tasks finish ${avg} min early`;
  return { id, text };
}
