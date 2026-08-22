import type { EventItem } from "../schedule/types";
import type { RoutineData, ProtectedBlock } from "../routine/types";
import { daysSummary } from "../routine/types";

// The routine that builds itself (2026-08-09). Dave: "it should know your
// routine life." The honest version of that is not a longer intake form, it
// is noticing. If the same event keeps landing at the same time of day, that
// IS routine, whether or not anyone declared it. This observes exactly that
// and offers one tap, through the same JARVIS Noticed row every other
// observation uses. Same discipline as patterns.ts: deterministic, evidence
// gated, at most one offer, dismissible, and never a silent write.

const WINDOW_DAYS = 28;
const MIN_OCCURRENCES = 3;
const SPREAD_MAX_MIN = 45; // start times must cluster this tightly
const DEFAULT_DUR = 60;

export interface RoutineCandidate {
  id: string;    // dismiss-memory key, stable per title
  text: string;  // the JARVIS Noticed line
  block: ProtectedBlock; // ready to append to routineData.protectedBlocks
}

const toMin = (hhmm: string): number => {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
};

function min12h(min: number): string {
  let h = Math.floor(min / 60);
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  const m = min % 60;
  return m === 0 ? `${h} ${ap}` : `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

export function routineBlockCandidate(
  events: EventItem[],
  routine: RoutineData,
  nowMs: number,
): RoutineCandidate | null {
  const cutoff = new Date(nowMs - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const today = new Date(nowMs).toISOString().slice(0, 10);

  // One-off events only: a recurring event is already structure the user
  // declared, and planned task blocks are the planner talking to itself.
  const byTitle = new Map<string, EventItem[]>();
  for (const e of events) {
    if (e.data.recurrence && e.data.recurrence !== "none") continue;
    if (e.data.sourceTaskId) continue;
    if (e.data.date < cutoff || e.data.date > today) continue;
    const key = e.data.title.trim().toLowerCase();
    if (!key) continue;
    const list = byTitle.get(key) ?? [];
    list.push(e);
    byTitle.set(key, list);
  }

  // Strongest evidence first, name as tiebreak, so the offer is deterministic.
  const groups = [...byTitle.entries()]
    .filter(([, evs]) => evs.length >= MIN_OCCURRENCES)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  for (const [, evs] of groups) {
    const starts = evs.map((e) => toMin(e.data.start));
    if (Math.max(...starts) - Math.min(...starts) > SPREAD_MAX_MIN) continue;

    const startMin = Math.round(median(starts) / 15) * 15;
    const durs = evs.map((e) => (e.data.end ? toMin(e.data.end) - toMin(e.data.start) : DEFAULT_DUR)).filter((d) => d > 0);
    const endMin = Math.min(24 * 60 - 1, startMin + (durs.length ? Math.round(median(durs) / 15) * 15 || 15 : DEFAULT_DUR));
    const days = [...new Set(evs.map((e) => new Date(e.data.date + "T00:00:00").getDay()))].sort((a, b) => a - b);
    const title = evs[0]!.data.title.trim();

    // Already covered: a block overlapping this time on any of these days
    // (or one with the same name) means there is nothing to offer.
    const covered = (routine.protectedBlocks ?? []).some((b) =>
      b.label.trim().toLowerCase() === title.toLowerCase() ||
      (b.days.some((d) => days.includes(d)) && startMin < b.endMin && b.startMin < endMin));
    if (covered) continue;

    const location = evs.map((e) => e.data.location?.trim()).find((l) => !!l);
    return {
      id: "routine-" + title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40),
      text: `${title} · Around ${min12h(startMin)} ${daysSummary(days)} · ${evs.length} times this month`,
      block: {
        id: "pb_learned_" + Math.abs(startMin * 7 + days.length) + "_" + title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20),
        label: title, startMin, endMin, days,
        kind: "other",
        ...(location ? { location } : {}),
      },
    };
  }
  return null;
}
