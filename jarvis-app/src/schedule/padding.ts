// PAD THE GUESS (B3, approved 2026-08-20).
//
// ADHD reliably underestimates how long things take. JARVIS already handles
// the honest half of this: once a category has three real commits behind it,
// the stepper starts at the MEDIAN of what he actually chose, which is a
// measurement and needs no padding.
//
// The gap is everything before that. A brand-new category gets a flat
// default, and a flat default is exactly where the underestimate lives.
//
// So: unlearned estimates come pre-padded, the padding is VISIBLE, and it
// retires the moment real data replaces it. The rule that keeps this honest
// is that the app never presents a pad as a measurement.
//
// SCHED-F-17 (2026-09-05): STATE OF PLAY, so this header stops reading as if
// it shipped. B3 is built and tested here and NOT WIRED: no screen calls
// estimateFor. The planner's unlearned fallback is a flat default
// (useTaskEstimate.ts's DEFAULT_TASK_MINUTES, and Bigger Picture's `?? 45`),
// so nothing is padded and nothing is therefore shown without its
// disclosure. padNote and learnedNote are KEPT for that reason rather than
// deleted as dead: they are the visible half the law above requires, and
// whoever wires estimateFor has to render padNote in the same change or the
// pad becomes a measurement. Wiring it is a feature decision, not a cleanup:
// it moves every unlearned estimate in the planner by half.
//
// The 50% figure is clinical convention rather than a trial result, and is
// described that way in the UI copy rather than dressed up as science.

export const PAD_FACTOR = 1.5;
// Snap to the same quarter hour everything else in the planner uses, so a
// padded number never looks like a suspiciously precise 37.
const STEP = 15;

export function padMinutes(flat: number, factor = PAD_FACTOR): number {
  return Math.max(STEP, Math.round((flat * factor) / STEP) * STEP);
}

export interface Estimate {
  minutes: number;
  // True when this came from his own history. False means it is padded and
  // the UI must say so.
  learned: boolean;
}

// The one place an estimate is decided. Learned beats padded, always.
export function estimateFor(
  category: string,
  learned: Record<string, number>,
  flatDefault: number,
  // The lengths the UI can actually show as a lit chip. A padded number that
  // lands between two chips leaves the row looking unset, so the pad snaps
  // to the nearest real choice rather than inventing a 75 nobody can tap.
  choices?: number[],
): Estimate {
  const known = learned[category];
  if (typeof known === "number" && known > 0) return { minutes: known, learned: true };
  const padded = padMinutes(flatDefault);
  if (!choices || choices.length === 0) return { minutes: padded, learned: false };
  const nearest = [...choices].sort((a, b) => Math.abs(a - padded) - Math.abs(b - padded))[0]!;
  return { minutes: nearest, learned: false };
}

// Shown next to a padded number so it is never mistaken for a measurement.
export function padNote(e: Estimate): string | null {
  return e.learned ? null : "Padded · No history yet";
}

export function learnedNote(e: Estimate): string | null {
  return e.learned ? "Your usual" : null;
}
