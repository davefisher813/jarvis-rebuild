import type { Store, ItemData } from "@core";
import { ENTITY_METRIC_DEF, ENTITY_METRIC_LOG, type MetricDef, type MetricDefData, type MetricLog, type MetricLogData } from "./metrics";

type Emit = (e: { type: "entity.created" | "entity.updated" | "entity.deleted"; entityType: string; entityId: string }) => void;

// D10-B store: two entity kinds, same shape as everything else in the gym
// module (Program/Workout) and in life (Goal) -- the store assigns ids, this
// class never invents one. No write door touches ItemData directly outside
// these three services, same rule GymService and GoalService already keep.
export class MetricsService {
  constructor(private store: Store, private ownerId: string, private onEvent: Emit = () => {}) {}

  async listDefs(): Promise<MetricDef[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_METRIC_DEF);
    return items.map((i) => ({ id: i.id, data: i.data as unknown as MetricDefData }))
      .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0) || a.data.name.localeCompare(b.data.name));
  }

  /** Turning a preset on and building a custom metric are the same write:
   *  both hand this a finished MetricDefData (see metrics.ts's
   *  newMetricDefData). */
  async createDef(data: MetricDefData): Promise<string | null> {
    if (!data.name.trim()) return null;
    const id = await this.store.create(this.ownerId, ENTITY_METRIC_DEF, { ...data, name: data.name.trim() } as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_METRIC_DEF, entityId: id });
    return id;
  }

  /** Rename, retype, or HIDE (never delete -- D10-B). */
  async updateDef(id: string, patch: Partial<MetricDefData>): Promise<boolean> {
    const defs = await this.listDefs();
    const d = defs.find((x) => x.id === id);
    if (!d) return false;
    const next = { ...d.data, ...patch };
    if (typeof next.name === "string") next.name = next.name.trim();
    await this.store.update(this.ownerId, id, next as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_METRIC_DEF, entityId: id });
    return true;
  }

  async listLogs(): Promise<MetricLog[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_METRIC_LOG);
    return items.map((i) => ({ id: i.id, data: i.data as unknown as MetricLogData }));
  }

  /** One tap on the daily strip, or a backfilled day. A metric+date pair is
   *  unique -- a second log on the same day REPLACES the first (the strip is
   *  a correction, not a running list of attempts), so this reads the
   *  existing log for that pair first rather than trusting a caller to know
   *  whether one already exists. */
  async logMetric(metricId: string, date: string, value: { value?: number; yes?: boolean }, now: number = Date.now()): Promise<string | null> {
    const existing = (await this.listLogs()).find((l) => l.data.metricId === metricId && l.data.date === date);
    const data: MetricLogData = { metricId, date, at: now, ...value };
    if (existing) {
      await this.store.update(this.ownerId, existing.id, data as unknown as ItemData);
      this.onEvent({ type: "entity.updated", entityType: ENTITY_METRIC_LOG, entityId: existing.id });
      return existing.id;
    }
    const id = await this.store.create(this.ownerId, ENTITY_METRIC_LOG, data as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_METRIC_LOG, entityId: id });
    return id;
  }

  /** Undo on every delete (HEALTH_PREVIEW_SPEC, Dave's adjustment #3): a
   *  mis-tapped log is removable, same as a set or a goal. */
  async removeLog(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_METRIC_LOG, entityId: id });
  }
}
