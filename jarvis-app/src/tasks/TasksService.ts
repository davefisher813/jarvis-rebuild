import type { Store, Item, ItemData } from "@core";
import type { EventInput } from "../events";
import { setCategories as setCategoriesOf } from "./categories";
import { ENTITY_TASK, type TaskData, type Recurrence, type BillInfo, type ReminderInfo, type TaskStep } from "../notes/types";
import { groupFor, todayISO, nextDue, type TaskGroup } from "./grouping";
import { nextStreak } from "./lifecycle";
import { recordCompletion } from "../shared/timeSense";
import { countEnactment } from "./automaticity";
import { isUsable, type IfThen } from "./ifThen";

export interface TaskItem {
  id: string;
  data: TaskData;
}

// Blank lines never survive a write (matches NotesService's checklist
// items: a step left empty on blur is gone before it ever round-trips).
function cleanSteps(steps: TaskStep[] | undefined): TaskStep[] {
  return (steps ?? []).filter((s) => s.text.trim().length > 0).map((s) => ({ text: s.text.trim(), done: s.done }));
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
    opts: { category?: string; extraCategories?: string[]; due?: string | null; fromNote?: string; fromThread?: string; recurrence?: Recurrence; projectId?: string; bill?: BillInfo; reminder?: ReminderInfo; source?: import("../shared/provenance").Source; plan?: IfThen; steps?: TaskStep[] } = {},
  ): Promise<string | null> {
    if (!text || !text.trim()) return null;
    const data: TaskData = { text: text.trim(), category: opts.category ?? "", done: false };
    // Only written when there genuinely are extras, so a single-category task
    // stores exactly what it always did.
    const extras = (opts.extraCategories ?? []).filter((c) => c && c !== data.category);
    if (extras.length) data.extraCategories = [...new Set(extras)];
    if (opts.due) data.due = opts.due;
    if (opts.fromNote) data.fromNote = opts.fromNote;
    // Pick 26: the thread this task came from, so its siblings can teach the
    // next one where it belongs.
    if (opts.fromThread) data.fromThread = opts.fromThread;
    if (opts.recurrence) data.recurrence = opts.recurrence;
    if (opts.projectId) data.projectId = opts.projectId;
    if (opts.bill) data.bill = opts.bill;
    if (opts.reminder) data.reminder = opts.reminder;
    if (opts.source) data.source = opts.source;
    if (opts.plan && isUsable(opts.plan)) data.plan = opts.plan;
    const steps = cleanSteps(opts.steps);
    if (steps.length) data.steps = steps;
    const id = await this.store.create(this.ownerId, ENTITY_TASK, data as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_TASK, entityId: id });
    return id;
  }

  // B1-3 (2026-09-04): the one function every Undo-after-delete site should
  // call. A snapshot of a deleted task carries its project, its checklist,
  // its if-then plan, its extra areas, its bill amount and where it came
  // from; Undo restoring only text/category/due/recurrence was silently
  // stripping every one of those, seven call sites deep, wherever the fix
  // had not happened to be copied by hand. One function, called everywhere,
  // is what keeps a new eighth site from reintroducing the same bug.
  async recreateFrom(t: TaskData): Promise<string | null> {
    return this.createTask(t.text, {
      category: t.category || undefined,
      extraCategories: t.extraCategories,
      due: t.due ?? null,
      recurrence: t.recurrence,
      projectId: t.projectId,
      bill: t.bill,
      reminder: t.reminder,
      plan: t.plan,
      steps: t.steps,
      fromNote: t.fromNote,
      fromThread: t.fromThread,
      source: t.source,
    });
  }

  async toggleDone(id: string): Promise<boolean> {
    const t = await this.getTask(id);
    if (!t) return false;
    if (!t.done && t.recurrence) {
      // completing a recurring task rolls it to the next occurrence instead of
      // finishing it, and advances the streak (pauses, never dies: lifecycle.ts)
      const streak = nextStreak(t, todayISO());
      await this.store.update(this.ownerId, id, {
        due: nextDue(t.due || todayISO(), t.recurrence),
        lastDone: streak.lastDone,
        runLen: streak.runLen,
        bestRun: streak.bestRun,
      });
    } else {
      // One-time bills stamp lastDone on completion: it is the "Paid Jul 28"
      // receipt that kills the did-I-already-pay loop (Money v1).
      const patch: ItemData = { done: !t.done };
      if (t.bill && !t.done) patch.lastDone = todayISO();
      await this.store.update(this.ownerId, id, patch);
    }
    // Time Sense (silent, Phase 1): every completion logs an hour-of-day sample
    // so Phase 2 launches with a real energy curve instead of self-report.
    if (!t.done) {
      recordCompletion(t.category ?? "", new Date(), id);
      // Semantic event for the durable log: completions are what the Brain's
      // completion-window and plan-vs-done derivations read.
      this.onEvent({ type: "task.completed", entityType: ENTITY_TASK, entityId: id, props: { category: t.category ?? "" } });
    }
    this.onEvent({ type: "entity.updated", entityType: ENTITY_TASK, entityId: id });
    return true;
  }

  /**
   * Money v1: edit a bill's facts directly. Deliberately NOT setDue: pushing a
   * bill's date from the edit sheet must not count a slip or emit task.pushed,
   * or bill edits would poison the Brain's slip-by-category derivation.
   */
  async updateBillTask(
    id: string,
    patch: { text?: string; due?: string | null; recurrence?: Recurrence | null; bill?: BillInfo },
  ): Promise<boolean> {
    const t = await this.getTask(id);
    if (!t || !t.bill) return false;
    const next: ItemData = {};
    if (patch.text?.trim()) next.text = patch.text.trim();
    if (patch.due !== undefined) next.due = patch.due;
    if (patch.recurrence !== undefined) next.recurrence = patch.recurrence;
    if (patch.bill) next.bill = patch.bill as unknown as ItemData;
    await this.store.update(this.ownerId, id, next);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_TASK, entityId: id });
    return true;
  }

  /**
   * Money v1: autopay bills whose date has passed roll themselves forward.
   * Nobody taps an autopay bill, so without this it would sit "overdue",
   * which reads as a lie. lastDone records the date the payment was
   * SCHEDULED (the old due); the copy layer says "Autopay scheduled", never
   * "paid". No slips, no task.pushed, no task.completed: nothing happened
   * that the app can honestly claim.
   */
  async rollAutopayBills(today: string = todayISO()): Promise<number> {
    const all = await this.listTasks();
    let rolled = 0;
    for (const t of all) {
      const d = t.data;
      if (!d.bill?.autopay || d.done || !d.recurrence || !d.due || d.due >= today) continue;
      const scheduledOn = d.due;
      let due = d.due;
      let guard = 0;
      while (due < today && guard++ < 400) due = nextDue(due, d.recurrence);
      await this.store.update(this.ownerId, t.id, { due, lastDone: scheduledOn });
      this.onEvent({ type: "entity.updated", entityType: ENTITY_TASK, entityId: t.id });
      rolled++;
    }
    return rolled;
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

  // --- Reminders (2026-08-19). A reminder is a task wearing reminder facts;
  // these are the only writes that touch them, so the shape stays honest.
  async createReminder(text: string, r: ReminderInfo, category = ""): Promise<string | null> {
    return this.createTask(text, { category, reminder: r });
  }

  private async patchReminder(id: string, patch: Partial<ReminderInfo>): Promise<boolean> {
    const t = await this.getTask(id);
    if (!t?.reminder) return false;
    const next: ReminderInfo = { ...t.reminder, ...patch };
    // undefined survives a spread, so strip cleared keys rather than storing
    // an explicit undefined the adapter would have to reason about.
    (Object.keys(next) as (keyof ReminderInfo)[]).forEach((k) => { if (next[k] === undefined) delete next[k]; });
    await this.store.update(this.ownerId, id, { reminder: next } as unknown as ItemData);
    return true;
  }

  // Ticking is a date write, never a boolean: done-ness is derived, so the
  // reminder resets itself at midnight with nothing scheduled to do it.
  // D1: a tick is also an ENACTMENT, counted once per day. Untick clears the
  // done date but NEVER decrements the count: what he did, he did, and a
  // count that can be walked backwards is a streak wearing a disguise.
  async tickReminder(id: string, today: string): Promise<boolean> {
    const t = await this.getTask(id);
    const prev = t?.reminder;
    const counted = countEnactment(prev?.doneCount, prev?.lastCounted, today);
    const ok = await this.patchReminder(id, { lastDone: today, doneCount: counted.doneCount, lastCounted: counted.lastCounted });
    // The one writer in this service that never called onEvent (audit
    // 2026-08-25). Its own durable type, NOT task.completed: the reminder
    // doctrine keeps ticks out of the day's numbers, and the log keeps the
    // same promise. An untick is a correction and stays local.
    if (ok) this.onEvent({ type: "reminder.ticked", entityType: ENTITY_TASK, entityId: id });
    return ok;
  }
  untickReminder(id: string): Promise<boolean> {
    return this.patchReminder(id, { lastDone: undefined });
  }
  snoozeReminder(id: string, to: string, today: string): Promise<boolean> {
    return this.patchReminder(id, { snoozedTo: to, snoozeDate: today });
  }
  editReminder(id: string, patch: Partial<ReminderInfo>): Promise<boolean> {
    return this.patchReminder(id, patch);
  }

  async setDue(id: string, due: string | null): Promise<boolean> {
    const t = await this.getTask(id);
    if (!t) return false;
    // Pushing a due date later counts as a slip (First Step watches for 3).
    const slipped = !!t.due && !!due && due > t.due;
    await this.store.update(this.ownerId, id, slipped ? { due, slips: (t.slips ?? 0) + 1 } : { due });
    // Semantic event: slips-by-category is a Brain launch derivation.
    if (slipped) this.onEvent({ type: "task.pushed", entityType: ENTITY_TASK, entityId: id, props: { category: t.category ?? "" } });
    this.onEvent({ type: "entity.updated", entityType: ENTITY_TASK, entityId: id });
    return true;
  }

  // Set Aside (lifecycle): clear the due date of long-overdue tasks so nothing
  // on screen is a shame wall. The old due survives in asideFrom for Undo.
  async setAside(ids: string[]): Promise<void> {
    for (const id of ids) {
      const t = await this.getTask(id);
      if (!t || t.done) continue;
      await this.store.update(this.ownerId, id, { due: null, asideFrom: t.due ?? null });
      this.onEvent({ type: "entity.updated", entityType: ENTITY_TASK, entityId: id });
    }
  }

  // Undo for Set Aside: restore the remembered due dates.
  async restoreAside(ids: string[]): Promise<void> {
    for (const id of ids) {
      const t = await this.getTask(id);
      if (!t || !t.asideFrom) continue;
      await this.store.update(this.ownerId, id, { due: t.asideFrom, asideFrom: null });
      this.onEvent({ type: "entity.updated", entityType: ENTITY_TASK, entityId: id });
    }
  }

  // Session 6: the goal -> project -> task chain. Progress is derived from this
  // link, so it must be settable and clearable.
  async setProject(id: string, projectId: string | null): Promise<boolean> {
    const t = await this.getTask(id);
    if (!t) return false;
    await this.store.update(this.ownerId, id, { projectId: projectId ?? null });
    this.onEvent({ type: "entity.updated", entityType: ENTITY_TASK, entityId: id });
    return true;
  }

  // A1: the if-then plan. Null clears it; an unusable one is never stored,
  // because a plan that will not work is worse than no plan (it feels like
  // one and carries no effect).
  async setPlan(id: string, plan: IfThen | null): Promise<boolean> {
    const t = await this.getTask(id);
    if (!t) return false;
    const next = plan && isUsable(plan) ? plan : null;
    await this.store.update(this.ownerId, id, { plan: next } as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_TASK, entityId: id });
    return true;
  }

  // STEPS: one writer for the whole ordered list, exactly like
  // setCategories -- the sheet edits them locally and this commits the
  // whole set on Save, never a partial write mid-edit. Display-only rollup;
  // it never touches the task's own `done`.
  async setSteps(id: string, steps: TaskStep[]): Promise<boolean> {
    const t = await this.getTask(id);
    if (!t) return false;
    const clean = cleanSteps(steps);
    await this.store.update(this.ownerId, id, { steps: clean.length ? clean : null } as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_TASK, entityId: id });
    return true;
  }

  async setCategory(id: string, category: string): Promise<boolean> {
    return this.setCategories(id, category ? [category] : []);
  }

  // MULTIPLE CATEGORIES (2026-08-21). One writer for the whole set: the
  // primary and the tags are two halves of one fact, and writing them
  // separately is how they drift. `extraCategories: undefined` is written
  // explicitly on the single-category case so dropping back to one really
  // clears the old tags instead of leaving them behind.
  async setCategories(id: string, list: string[]): Promise<boolean> {
    const t = await this.getTask(id);
    if (!t) return false;
    const { category, extraCategories } = setCategoriesOf(list);
    await this.store.update(this.ownerId, id, { category, extraCategories } as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_TASK, entityId: id });
    return true;
  }

  async deleteTask(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_TASK, entityId: id });
  }

  async listTasks(): Promise<TaskItem[]> {
    const items: Item[] = await this.store.listForUser(this.ownerId, ENTITY_TASK);
    return items.map((i) => ({ id: i.id, data: i.data as unknown as TaskData }));
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
