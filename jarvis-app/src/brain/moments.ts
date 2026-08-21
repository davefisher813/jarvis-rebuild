import type { WindowRow } from "./window";
import type { Strand, DerivationKey } from "./strands/types";
import { deriveAll, type Derived } from "./derive";

// Being-known moments (Brain Layer 2). A moment is a derivation the user has
// not answered yet, dressed for the Noticed row. The rules that keep it a
// hit instead of a nag:
//
// - One per derivation, EVER, while its strand lives: an accepted fact never
//   re-surfaces, and a derivation with a live strand refreshes evidence
//   quietly instead of speaking again.
// - The nod test is operational: a derivation whose accepted strands get
//   corrected or deleted above NOD_RATE (with enough votes to mean it) stops
//   surfacing entirely. Killed by its own accuracy record, not by opinion.
// - Dismissal is handled by the existing pattern-dismiss memory in
//   TodaySuggestions (works on any observation id, unmodified).
// - Mood, routine, and planning observations outrank these; that priority
//   lives at the surfacing site, not here.

export const NOD_RATE = 0.2;
export const NOD_MIN_VOTES = 5;

export interface CorrectionStats {
  accepted: number;
  corrected: number;
  deleted: number;
}

// Reads the strand lifecycle events out of the same window the derivations
// use. kind carries the derivation key (closed vocabulary, regex-gated at
// the sink).
export function correctionStats(rows: WindowRow[]): Map<string, CorrectionStats> {
  const out = new Map<string, CorrectionStats>();
  const get = (k: string) => {
    const s = out.get(k) ?? { accepted: 0, corrected: 0, deleted: 0 };
    out.set(k, s);
    return s;
  };
  for (const r of rows) {
    if (!r.kind) continue;
    if (r.type === "strand.created") get(r.kind).accepted++;
    else if (r.type === "strand.corrected") get(r.kind).corrected++;
    else if (r.type === "strand.deleted") get(r.kind).deleted++;
  }
  return out;
}

// True when this derivation has talked itself out of the room.
export function derivationMuted(stats: CorrectionStats | undefined): boolean {
  if (!stats) return false;
  const wrong = stats.corrected + stats.deleted;
  const votes = stats.accepted + stats.deleted; // an edit and its create are one strand
  if (votes < NOD_MIN_VOTES) return false;
  return wrong / votes > NOD_RATE;
}

// The moments worth offering right now, in derivation order. The caller
// surfaces the first non-dismissed one; the rest wait their turn on later
// days. Every filter here is a reason to stay silent, which is the design.
export function brainMoments(rows: WindowRow[], strands: Strand[]): Derived[] {
  const stats = correctionStats(rows);
  const taken = new Set<DerivationKey>(
    strands.map((s) => s.data.derivation).filter((d): d is DerivationKey => !!d),
  );
  return deriveAll(rows)
    .filter((d) => !taken.has(d.derivation))
    .filter((d) => !derivationMuted(stats.get(d.derivation)));
}
