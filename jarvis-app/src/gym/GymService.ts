import type { Store, ItemData } from "@core";
import type { EventInput } from "../events";
import { ENTITY_PROGRAM, ENTITY_WORKOUT, type Program, type ProgramData, type Workout, type WorkoutData } from "./types";
import { migrateProgramData, migrateWorkoutData } from "./migrate";

// Programs and finished workouts. Set logs are CONTENT (item data), never
// event_log rows; the durable log records session completion only, so a year
// of training never bloats the behavioural log.
export class GymService {
  constructor(
    private store: Store,
    private ownerId: string,
    private onEvent: (e: EventInput) => void = () => {},
  ) {}

  /** MULTIPLE PROGRAMS & ARCHIVE (catalog §3.11). `includeArchived` is for
   *  the program switcher, which is the one screen that needs to show and
   *  un-archive them; everywhere else keeps seeing only live programs, same
   *  as before. */
  async listPrograms(includeArchived = false): Promise<Program[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_PROGRAM);
    return items
      .map((i) => ({ id: i.id, data: migrateProgramData(i.data) }))
      .filter((p) => includeArchived || !p.data.archived)
      .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0) || a.data.name.localeCompare(b.data.name));
  }

  async getProgram(id: string): Promise<Program | null> {
    const it = await this.store.read(this.ownerId, id);
    return it && it.entityType === ENTITY_PROGRAM ? { id: it.id, data: migrateProgramData(it.data) } : null;
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
    const items = await this.store.listForUser(this.ownerId, ENTITY_WORKOUT);
    return items
      .map((i) => ({ id: i.id, data: migrateWorkoutData(i.data) }))
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

  // Honest history (2026-08-09): a fat-fingered set used to poison PRs
  // forever because no delete existed. PRs and history are derived from the
  // workout list, so removing the bad session fixes every number downstream.
  async removeWorkout(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_WORKOUT, entityId: id });
  }

  // EDIT A FINISHED WORKOUT (catalog §3.7). A mistyped set used to be
  // permanent, and poisoned PR history the OTHER direction: a fat-fingered
  // 1350x5 becomes an unbeatable, demoralising "best" forever. PRs and the
  // receipt are both derived from the workout list at render time, so a
  // corrected set recomputes every number downstream for free -- there is no
  // separate "recompute PRs" step to remember.
  async updateWorkout(id: string, patch: Partial<WorkoutData>): Promise<boolean> {
    const it = await this.store.read(this.ownerId, id);
    if (!it || it.entityType !== ENTITY_WORKOUT) return false;
    const next = { ...migrateWorkoutData(it.data), ...patch };
    await this.store.update(this.ownerId, id, next as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_WORKOUT, entityId: id });
    return true;
  }
}
