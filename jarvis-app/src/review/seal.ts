import type { Store, ItemData } from "@core";
import type { EventInput } from "../events";
import type { WindowRow, WindowClient } from "../brain/window";
import { readWindow } from "../brain/window";
import { completionBand, taskDone } from "../brain/derive";
import { liveGoals } from "../bigger/reach";
import type { Goal } from "../life/types";
import type { Workout } from "../gym/types";
import type { GymService } from "../gym/GymService";
import type { GoalService } from "../life/GoalService";
import { todayISO } from "../tasks/grouping";

// THE MONTHLY SEAL (insights groundwork, 2026-08-25). One small record per
// closed month, written silently at the boundary. The reason it exists:
// past state cannot be reconstructed in this app. The durable window is 30
// days, mood trims itself to 14, Time Sense caps at 1000 samples, routine
// keeps no history at all. Month over month must compare two sealed records,
// or it is comparing two reconstructions, and one of them is fiction.
//
// Nothing reads seals yet. That is the point: the record has to exist for a
// month before the first report can open with a real "vs last month".

export const ENTITY_MONTH_SEAL = "month_seal";

export interface MonthSealData {
  month: string; // "2026-08"
  sealedAt: number; // epoch ms of the write
  // What happened, from the durable log (task facts exclude kind workout).
  done: number;
  pushed: number;
  daysIn: number; // distinct local days with an app.opened row
  byCategory: Record<string, number>; // completions per category id
  bandStart: number | null; // dominant 3h completion band, null when thin
  // From the Store's own dated series.
  sessions: number; // gym workouts in the month
  deposits: number; // savings entries logged in the month
  saved: number; // their sum
  goalsLive: number;
  goalsAchieved: number;
}

export interface MonthSeal { id: string; data: MonthSealData }

/** "2026-08" of a local ISO day. */
export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

/** The month before the one holding `iso`. */
export function prevMonthKey(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export interface SealInputs {
  rows: WindowRow[]; // must cover the whole month being sealed (35-day read)
  workouts: Workout[];
  goals: Goal[];
  sealedAt: number;
}

/** Pure: fold one month's evidence into its seal record. */
export function computeSeal(month: string, inp: SealInputs): MonthSealData {
  const inMonth = inp.rows.filter((r) => r.day.startsWith(month));
  const done = taskDone(inMonth);
  const byCategory: Record<string, number> = {};
  for (const r of done) {
    const c = r.category ?? "";
    if (!c) continue;
    byCategory[c] = (byCategory[c] ?? 0) + 1;
  }
  const entries = inp.goals.flatMap((g) => (g.data.saved ?? []).filter((s) => s.d.startsWith(month)));
  return {
    month,
    sealedAt: inp.sealedAt,
    done: done.length,
    pushed: inMonth.filter((r) => r.type === "task.pushed").length,
    daysIn: new Set(inMonth.filter((r) => r.type === "app.opened").map((r) => r.day)).size,
    byCategory,
    bandStart: completionBand(done)?.start ?? null,
    sessions: inp.workouts.filter((w) => w.data.date.startsWith(month)).length,
    deposits: entries.length,
    saved: entries.reduce((a, s) => a + s.amount, 0),
    goalsLive: liveGoals(inp.goals).length,
    goalsAchieved: inp.goals.filter((g) => g.data.state === "achieved").length,
  };
}

/** A month with no evidence at all seals nothing: there is no month to
 *  remember, and a record of zeros would only make September's report read
 *  like a verdict on a month that happened outside the app. */
export function worthSealing(d: MonthSealData): boolean {
  return d.done + d.pushed + d.sessions + d.deposits + d.daysIn > 0;
}

export class SealService {
  constructor(
    private store: Store,
    private ownerId: string,
    private onEvent: (e: EventInput) => void = () => {},
  ) {}

  /** All seals, oldest month first. Two devices racing the same boundary can
   *  both write; the earliest write wins on read and the twin is ignored. */
  async list(): Promise<MonthSeal[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_MONTH_SEAL);
    const byMonth = new Map<string, MonthSeal>();
    const all = items
      .map((i) => ({ id: i.id, data: i.data as unknown as MonthSealData }))
      .sort((a, b) => a.data.sealedAt - b.data.sealedAt);
    for (const s of all) if (!byMonth.has(s.data.month)) byMonth.set(s.data.month, s);
    return [...byMonth.values()].sort((a, b) => a.data.month.localeCompare(b.data.month));
  }

  async findMonth(month: string): Promise<MonthSeal | null> {
    return (await this.list()).find((s) => s.data.month === month) ?? null;
  }

  async create(data: MonthSealData): Promise<string | null> {
    const id = await this.store.create(this.ownerId, ENTITY_MONTH_SEAL, data as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_MONTH_SEAL, entityId: id });
    return id;
  }
}

// One check per app open, and only the cheap half unless the boundary was
// actually crossed: the localStorage marker short-circuits everything after
// the first successful seal of a month, and the Store lookup catches the
// other-device case before any window read happens.
const MARK_KEY = "jarvis.seal.done.v1";

export async function sealPreviousMonthIfDue(
  svc: SealService,
  client: WindowClient | null,
  gym: GymService,
  goalsSvc: GoalService,
  today = todayISO(),
  now = Date.now(),
): Promise<string | null> {
  const prev = prevMonthKey(today);
  const mark = () => {
    try { localStorage.setItem(MARK_KEY, prev); } catch { /* best effort */ }
  };
  try {
    if (localStorage.getItem(MARK_KEY) === prev) return null;
  } catch { /* no storage: the Store check below still guards */ }
  if (await svc.findMonth(prev)) { mark(); return null; }
  const [rows, workouts, goals] = await Promise.all([
    readWindow(client, now, 35),
    gym.listWorkouts(),
    goalsSvc.list(),
  ]);
  const data = computeSeal(prev, { rows, workouts, goals, sealedAt: now });
  if (!worthSealing(data)) { mark(); return null; }
  const id = await svc.create(data);
  if (id) mark();
  return id;
}
