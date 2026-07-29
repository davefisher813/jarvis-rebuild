// Mood-sized days. The evening check-in records how a day felt (fire / meh /
// under). After an underwater day, the next day's plan is deliberately lighter:
// fewer blocks, more slack between them, and a kind word about why. This is
// never punitive and never guilt: an underwater day is information, not a
// failure. Phase 2.

export interface DaySizing {
  light: boolean;
  maxBlocks: number | null; // null = no cap
  extraSlackMin: number;    // added to the planner's buffer between blocks
  note: string | null;      // gentle acknowledgment shown before planning
}

export const FULL_DAY: DaySizing = { light: false, maxBlocks: null, extraSlackMin: 0, note: null };

// Size today from yesterday's felt weight. Only an underwater day changes
// anything: a "fire" or "meh" day, or no answer at all, plans as normal.
export function daySizing(prevMood?: string): DaySizing {
  if (prevMood === "under") {
    return {
      light: true,
      maxBlocks: 4,
      extraSlackMin: 10,
      note: "Yesterday ran heavy, so today is a lighter one on purpose: fewer blocks, more room to breathe.",
    };
  }
  return FULL_DAY;
}
