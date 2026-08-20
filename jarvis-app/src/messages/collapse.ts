import type { ThreadRow } from "../connections/google/map";
import { capAfterNumber } from "../shared/casing";

// SIX FROM SUPABASE BECOME ONE ROW (N5, Dave 2026-08-20).
//
// A sender who writes six times a week about things you will never act on
// individually is not six decisions. It is one decision, repeated, and the
// list should say so.
//
// Laws:
//   - Only ever collapses NOISE. Anything that needs him keeps its own row,
//     however many of them there are: burying a real message inside a group
//     is the failure this whole tab is built against.
//   - The count is the whole point, so it is never hidden or rounded.
//   - Collapsing is presentation. Nothing is archived, filed or touched, and
//     expanding shows exactly the rows that were always there.

export const COLLAPSE_MIN = 3;

export interface Collapsed {
  key: string;        // sender email, lowercased
  from: string;       // display name
  rows: ThreadRow[];
}

export function collapseNoise(rows: ThreadRow[], min = COLLAPSE_MIN): { groups: Collapsed[]; loose: ThreadRow[] } {
  const by = new Map<string, ThreadRow[]>();
  for (const r of rows) {
    const k = (r.fromEmail || r.from || "").toLowerCase();
    if (!k) continue;
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  const groups: Collapsed[] = [];
  const loose: ThreadRow[] = [];
  for (const [key, list] of by) {
    if (list.length >= min) groups.push({ key, from: list[0]!.from, rows: list });
    else loose.push(...list);
  }
  // Biggest pile first: the group worth collapsing most is the one that has
  // taken over the list.
  groups.sort((a, b) => b.rows.length - a.rows.length);
  loose.sort((a, b) => b.dateMs - a.dateMs);
  return { groups, loose };
}

export function collapseLine(g: Collapsed): string {
  return capAfterNumber(`${g.rows.length} notices · Nothing needs you`);
}
