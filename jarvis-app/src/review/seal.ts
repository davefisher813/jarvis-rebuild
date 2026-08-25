import type { Store, ItemData } from "@core";
import type { EventInput } from "../events";
import type { WindowRow, WindowClient } from "../brain/window";
import { readWindow } from "../brain/window";
import { completionBand, taskDone, slipLeader } from "../brain/derive";
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
  // v2 (2026-08-25, the report's fields). Everything below is numbers and
  // ids, never text, and everything degrades to empty rather than lying.
  bandCount: number; // completions inside the band (0 when bandStart null)
  byHour: number[]; // 24 buckets of task completions
  doneByDay: Record<string, number>; // ISO day -> completions
  pushedByCategory: Record<string, number>;
  slip: { category: string; n: number } | null; // deriveSlipCategory's own gates
  // plan.picked joined to plan.outcome on entity_id: per pick position,
  // how many were picked and how many finished that same day.
  byPick: { n: number; picked: number; done: number }[];
  // plan.duration_corrected folded per category: total signed minutes and
  // how many corrections. Positive = ran longer than estimated.
  overrunByCategory: Record<string, { min: number; n: number }>;
  // suggestion.accepted / dismissed by kind.
  suggestions: Record<string, { acc: number; dis: number }>;
  strands: { created: number; corrected: number; deleted: number };
  remindersTicked: number;
  // email.deck_sent: sent count and how many went out as written (flag on
  // the row means EDITED before send).
  deck: { sent: number; asWritten: number };
  // The tasks that kept getting pushed: top entity ids by month push count,
  // 3 or more pushes, at most three of them. Ids only; the report resolves
  // titles against the live Store and silently drops what no longer exists.
  carried: { id: string; n: number }[];
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
  const doneByDay: Record<string, number> = {};
  const byHour = new Array<number>(24).fill(0);
  for (const r of done) {
    doneByDay[r.day] = (doneByDay[r.day] ?? 0) + 1;
    if (r.h >= 0 && r.h < 24) byHour[r.h] = (byHour[r.h] ?? 0) + 1;
    const c = r.category ?? "";
    if (!c) continue;
    byCategory[c] = (byCategory[c] ?? 0) + 1;
  }
  const pushedByCategory: Record<string, number> = {};
  const pushedByTask = new Map<string, number>();
  for (const r of inMonth) {
    if (r.type !== "task.pushed") continue;
    if (r.category) pushedByCategory[r.category] = (pushedByCategory[r.category] ?? 0) + 1;
    if (r.entity_id) pushedByTask.set(r.entity_id, (pushedByTask.get(r.entity_id) ?? 0) + 1);
  }
  const carried = [...pushedByTask.entries()]
    .filter(([, n]) => n >= 3)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([id, n]) => ({ id, n }));
  // Pick position -> same-day finish, joined on the task id. An outcome row
  // without a matching pick still counts under its own position when it
  // carries one (n rides both event types).
  const pickPos = new Map<string, number>();
  for (const r of inMonth) {
    if (r.type === "plan.picked" && r.entity_id && typeof r.n === "number") pickPos.set(r.entity_id + "|" + r.day, r.n);
  }
  const byPickMap = new Map<number, { picked: number; done: number }>();
  for (const r of inMonth) {
    if (r.type !== "plan.picked" || typeof r.n !== "number") continue;
    const b = byPickMap.get(r.n) ?? { picked: 0, done: 0 };
    b.picked++;
    byPickMap.set(r.n, b);
  }
  for (const r of inMonth) {
    if (r.type !== "plan.outcome" || typeof r.flag !== "boolean") continue;
    const joined = r.entity_id ? pickPos.get(r.entity_id + "|" + r.day) : undefined;
    const pos = joined ?? (typeof r.n === "number" ? r.n : null);
    if (pos == null) continue;
    const b = byPickMap.get(pos) ?? { picked: 0, done: 0 };
    if (r.flag) b.done++;
    byPickMap.set(pos, b);
  }
  const byPick = [...byPickMap.entries()].map(([n, v]) => ({ n, ...v })).sort((a, b) => a.n - b.n);
  const overrunByCategory: Record<string, { min: number; n: number }> = {};
  for (const r of inMonth) {
    if (r.type !== "plan.duration_corrected" || !r.category || typeof r.n !== "number") continue;
    const o = overrunByCategory[r.category] ?? { min: 0, n: 0 };
    o.min += r.n;
    o.n++;
    overrunByCategory[r.category] = o;
  }
  const suggestions: Record<string, { acc: number; dis: number }> = {};
  for (const r of inMonth) {
    if (r.type !== "suggestion.accepted" && r.type !== "suggestion.dismissed") continue;
    const k = r.kind ?? "other";
    const sgg = suggestions[k] ?? { acc: 0, dis: 0 };
    if (r.type === "suggestion.accepted") sgg.acc++;
    else sgg.dis++;
    suggestions[k] = sgg;
  }
  const deckRows = inMonth.filter((r) => r.type === "email.deck_sent");
  const entries = inp.goals.flatMap((g) => (g.data.saved ?? []).filter((s) => s.d.startsWith(month)));
  const band = completionBand(done);
  return {
    month,
    sealedAt: inp.sealedAt,
    done: done.length,
    pushed: inMonth.filter((r) => r.type === "task.pushed").length,
    daysIn: new Set(inMonth.filter((r) => r.type === "app.opened").map((r) => r.day)).size,
    byCategory,
    bandStart: band?.start ?? null,
    sessions: inp.workouts.filter((w) => w.data.date.startsWith(month)).length,
    deposits: entries.length,
    saved: entries.reduce((a, s) => a + s.amount, 0),
    goalsLive: liveGoals(inp.goals).length,
    goalsAchieved: inp.goals.filter((g) => g.data.state === "achieved").length,
    bandCount: band?.count ?? 0,
    byHour,
    doneByDay,
    pushedByCategory,
    slip: slipLeader(inMonth),
    byPick,
    overrunByCategory,
    suggestions,
    strands: {
      created: inMonth.filter((r) => r.type === "strand.created").length,
      corrected: inMonth.filter((r) => r.type === "strand.corrected").length,
      deleted: inMonth.filter((r) => r.type === "strand.deleted").length,
    },
    remindersTicked: inMonth.filter((r) => r.type === "reminder.ticked").length,
    deck: { sent: deckRows.length, asWritten: deckRows.filter((r) => r.flag === false).length },
    carried,
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
