import type { Store, ItemData } from "@core";
import type { EventInput } from "../events";
import { ENTITY_PROGRAM, ENTITY_WORKOUT, type Program, type ProgramData, type Workout, type WorkoutData } from "./types";

// Programs and finished workouts. Set logs are CONTENT (item data), never
// event_log rows; the durable log records session completion only, so a year
// of training never bloats the behavioural log.
export class GymService {
  constructor(
    private store: Store,
    private ownerId: string,
    private onEvent: (e: EventInput) => void = () => {},
  ) {}

  async listPrograms(): Promise<Program[]> {
    const items = await this.store.listForUser(this.ownerId);
    return items
      .filter((i) => i.entityType === ENTITY_PROGRAM)
      .map((i) => ({ id: i.id, data: i.data as unknown as ProgramData }))
      .filter((p) => !p.data.archived)
      .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0) || a.data.name.localeCompare(b.data.name));
  }

  async getProgram(id: string): Promise<Program | null> {
    const it = await this.store.read(this.ownerId, id);
    return it && it.entityType === ENTITY_PROGRAM ? { id: it.id, data: it.data as unknown as ProgramData } : null;
  }

  async createProgram(data: ProgramData): Promise<string | null> {
    if (!data.name.trim()) return null;
    const id = await this.store.create(this.ownerId, ENTITY_PROGRAM, { ...data, name: data.name.trim() } as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_PROGRAM, entityId: id });
    return id;
  }

  async updateProgram(id: string, patch: Partial<ProgramData>): Promise<boolean> {
    const p = await this.getProgram(id);
    if (!p) return false;
    const next = { ...p.data, ...patch };
    if (typeof next.name === "string") next.name = next.name.trim();
    await this.store.update(this.ownerId, id, next as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_PROGRAM, entityId: id });
    return true;
  }

  async removeProgram(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_PROGRAM, entityId: id });
  }

  async listWorkouts(): Promise<Workout[]> {
    const items = await this.store.listForUser(this.ownerId);
    return items
      .filter((i) => i.entityType === ENTITY_WORKOUT)
      .map((i) => ({ id: i.id, data: i.data as unknown as WorkoutData }))
      .sort((a, b) => a.data.date.localeCompare(b.data.date));
  }

  /** Persist a finished session. Called by the pending-queue flush, so a
   *  failure here must throw or return null rather than silently swallow. */
  async saveWorkout(data: WorkoutData): Promise<string | null> {
    const id = await this.store.create(this.ownerId, ENTITY_WORKOUT, data as unknown as ItemData);
    if (id) {
      this.onEvent({ type: "entity.created", entityType: ENTITY_WORKOUT, entityId: id });
      // The durable log gets the FACT of a session, never its contents.
      this.onEvent({ type: "task.completed", entityType: ENTITY_WORKOUT, entityId: id, props: { kind: "workout" } });
    }
    return id;
  }
}
