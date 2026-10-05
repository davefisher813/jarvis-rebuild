import type { CheckInEnergy, CheckInMood } from "./types";

// CHECK IN, THE WORDS (2026-09-14). The three energy words and the three mood
// words the screen offers, and the one line the check-in screen, the doctor
// report (health/doctorReport.ts) and the insights records (insights/records.ts)
// read back. Pure, so they agree. (Reworded 2026-10-05: health/log.ts and the
// logger tiles this named are gone.)
export const ENERGY_WORDS: { value: CheckInEnergy; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "okay", label: "Okay" },
  { value: "high", label: "High" },
];
export const MOOD_WORDS: { value: CheckInMood; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "neutral", label: "Neutral" },
  { value: "good", label: "Good" },
];

/** "Energy High, Mood Good", the note alone when that is all there is, or
 *  null for an empty check in. */
export function checkInLine(d: { energy?: CheckInEnergy; mood?: CheckInMood; note?: string }): string | null {
  const parts: string[] = [];
  const e = ENERGY_WORDS.find((w) => w.value === d.energy);
  const m = MOOD_WORDS.find((w) => w.value === d.mood);
  if (e) parts.push(`Energy ${e.label}`);
  if (m) parts.push(`Mood ${m.label}`);
  if (parts.length === 0) return d.note ?? null;
  return parts.join(", ");
}
