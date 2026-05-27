import type { Store, Item, ItemData } from "@core";
import type { EventInput } from "../events";
import { ENTITY_TASK, type TaskData, type Recurrence } from "../notes/types";
import { groupFor, todayISO, nextDue, type TaskGroup } from "./grouping";

export interface TaskItem {
  id: string;
  data: TaskData;
}
export interface GroupedTasks {
  today: TaskItem[];
  upcoming: TaskItem[];
  done: TaskItem[];
}

// The real Tasks feature, backed by the verified engine Store. Each task is a
// Store item of entity type "task". Tasks created from a note checklist are the
// same item type (NotesService.tasksFromChecklist writes them), so they appear
// here automatically. onEvent feeds the gaming event bus (no-op in tests).
export class TasksService {
  constructor(
    private store: Store,
    private ownerId: string,
    private onEvent: (e: EventInput) => void = () => {},
  ) {}

  private async getTask(id: string): Promise<TaskData | null> {
    const item = await this.store.read(this.ownerId, id);
    if (!item || item.entityType !== ENTITY_TASK) return null;
    return item.data as unknown as TaskData;
  }

  async task(id: string): Promise<TaskData | null> {
    return this.getTask(id);
  }

  async createTask(
    text: string,
    opts: { category?: string; due?: string | null; fromNote?: string; recurrence?: Recurrence } = {},
  ): Promise<string | null> {
    if (!text || !text.trim()) return null;
    const data: TaskData = { text: text.trim(), category: opts.category ?? "", done: false };
    if (opts.due) data.due = opts.due;
    if (opts.fromNote) data.fromNote = opts.fromNote;
    if (opts.recurrence) data.recurrence = opts.recurrence;
    const id = await this.store.create(this.ownerId, ENTITY_TASK, data as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_TASK, entityId: id });
    return id;
  }

  async toggleDone(id: string): Promise<boolean> {
    const t = await this.getTask(id);
    if (!t) return false;
    if (!t.done && t.recurrence) {
      // completing a recurring task rolls it to the next occurrence instead of finishing it
      await this.store.update(this.ownerId, id, { due: nextDue(t.due || todayISO(), t.recurrence) });
    } else {
      await this.store.update(this.ownerId, id, { done: !t.done });
    }
    this.onEvent({ type: "entity.updated", entityType: ENTITY_TASK, entityId: id });
    return true;
  }

  async setRecurrence(id: string, recurrence: Recurrence | null): Promise<boolean> {
    const t = await this.getTask(id);
    if (!t) return false;
    await this.store.update(this.ownerId, id, { recurrence: recurrence ?? null });
    this.onEvent({ type: "entity.updated", entityType: ENTITY_TASK, entityId: id });
    return true;
  }

  async editText(id: string, text: string): Promise<boolean> {
    if (!text || !text.trim()) return false;
    const t = await this.getTask(id);
    if (!t) return false;
    await this.store.update(this.ownerId, id, { text: text.trim() });
    this.onEvent({ type: "entity.updated", entityType: ENTITY_TASK, entityId: id });
    return true;
  }

  async setDue(id: string, due: string | null): Promise<boolean> {
    const t = await this.getTask(id);
    if (!t) return false;
    await this.store.update(this.ownerId, id, { due });
    this.onEvent({ type: "entity.updated", entityType: ENTITY_TASK, entityId: id });
    return true;
  }

  async setCategory(id: string, category: string): Promise<boolean> {
    const t = await this.getTask(id);
    if (!t) return false;
    await this.store.update(this.ownerId, id, { category });
    this.onEvent({ type: "entity.updated", entityType: ENTITY_TASK, entityId: id });
    return true;
  }

  async deleteTask(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_TASK, entityId: id });
  }

  async listTasks(): Promise<TaskItem[]> {
    const items: Item[] = await this.store.listForUser(this.ownerId);
    return items
      .filter((i) => i.entityType === ENTITY_TASK)
      .map((i) => ({ id: i.id, data: i.data as unknown as TaskData }));
  }

  // Tasks split into Today / Upcoming / Done and sorted soonest-first within
  // each (no-date tasks sort last in Upcoming). "today" defaults to the real
  // current date; tests pass a fixed value for repeatability.
  async grouped(today: string = todayISO()): Promise<GroupedTasks> {
    const all = await this.listTasks();
    const g: GroupedTasks = { today: [], upcoming: [], done: [] };
    for (const t of all) {
      const which: TaskGroup = groupFor(t.data, today);
      g[which].push(t);
    }
    const dueKey = (t: TaskItem) => t.data.due ?? "9999-99-99";
    g.today.sort((a, b) => dueKey(a).localeCompare(dueKey(b)));
    g.upcoming.sort((a, b) => dueKey(a).localeCompare(dueKey(b)));
    return g;
  }

  goOffline(): void {
    this.store.goOffline();
  }
  reconnect(): Promise<void> {
    return this.store.reconnect();
  }
  queueLen(): number {
    return this.store.queueLen();
  }
}
