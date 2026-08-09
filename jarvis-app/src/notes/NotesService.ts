import type { Store, ItemData } from "@core";
import type { EventInput } from "../events";
import {
  ENTITY_NOTE,
  ENTITY_TASK,
  TEMPLATES,
  type Block,
  type ChecklistItem,
  type Connection,
  type NoteData,
  type TaskData,
  type TemplateKey,
} from "./types";

function genId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return prefix + "_" + crypto.randomUUID();
  }
  return prefix + "_" + Math.random().toString(36).slice(2);
}

// The real Notes feature, backed by the verified engine Store. One instance per
// signed-in user (ownerId fixed). Block and connection edits are read-modify-
// write on the note's data: read the note, change the array, write the field
// back. The engine's last-write-wins handles field-level conflicts. onEvent
// feeds the gaming event bus (no-op in tests).
export class NotesService {
  constructor(
    private store: Store,
    private ownerId: string,
    private onEvent: (e: EventInput) => void = () => {},
  ) {}

  private async getNote(id: string): Promise<NoteData | null> {
    const item = await this.store.read(this.ownerId, id);
    if (!item || item.entityType !== ENTITY_NOTE) return null;
    return item.data as unknown as NoteData;
  }

  async note(id: string): Promise<NoteData | null> {
    return this.getNote(id);
  }

  async createNote(title: string, category: string): Promise<string | null> {
    if (!title || !String(title).trim()) return null;
    const data: NoteData = { title, category, blocks: [], connections: [] };
    const id = await this.store.create(this.ownerId, ENTITY_NOTE, data as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_NOTE, entityId: id });
    return id;
  }

  async editTitle(id: string, title: string): Promise<void> {
    await this.store.update(this.ownerId, id, { title });
    this.onEvent({ type: "entity.updated", entityType: ENTITY_NOTE, entityId: id });
  }

  // A note's category is a real connection, not a label chosen once at
  // creation. Changing it is how a note moves between areas of your life.
  async setCategory(id: string, category: string): Promise<void> {
    if (!category) return;
    await this.store.update(this.ownerId, id, { category } as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_NOTE, entityId: id });
  }

  async addBlock(id: string, block: Omit<Block, "id">): Promise<string | null> {
    const note = await this.getNote(id);
    if (!note) return null;
    const b: Block = { id: genId("b"), ...block };
    const blocks = [...note.blocks, b];
    await this.store.update(this.ownerId, id, { blocks } as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_NOTE, entityId: id });
    return b.id;
  }

  // Canvas typing flow: pressing Enter continues the document, so new blocks
  // land right after the one being written, not at the end of the note.
  async insertBlockAfter(id: string, afterBlockId: string, block: Omit<Block, "id">): Promise<string | null> {
    const note = await this.getNote(id);
    if (!note) return null;
    const idx = note.blocks.findIndex((b) => b.id === afterBlockId);
    if (idx < 0) return this.addBlock(id, block);
    const b: Block = { id: genId("b"), ...block };
    const blocks = [...note.blocks.slice(0, idx + 1), b, ...note.blocks.slice(idx + 1)];
    await this.store.update(this.ownerId, id, { blocks } as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: ENTITY_NOTE, entityId: id });
    return b.id;
  }

  async addChecklist(id: string, items: string[]): Promise<string | null> {
    const checklistItems: ChecklistItem[] = items.map((t) => ({ text: t, done: false }));
    return this.addBlock(id, { type: "checklist", items: checklistItems });
  }

  async editBlock(id: string, blockId: string, patch: Partial<Block>): Promise<boolean> {
    const note = await this.getNote(id);
    if (!note) return false;
    const idx = note.blocks.findIndex((b) => b.id === blockId);
    if (idx < 0) return false;
    const blocks = note.blocks.slice();
    blocks[idx] = { ...blocks[idx]!, ...patch, id: blockId };
    await this.store.update(this.ownerId, id, { blocks } as unknown as ItemData);
    return true;
  }

  async moveBlock(id: string, from: number, to: number): Promise<boolean> {
    const note = await this.getNote(id);
    if (!note) return false;
    const blocks = note.blocks.slice();
    if (from < 0 || from >= blocks.length || to < 0 || to >= blocks.length) return false;
    const [moved] = blocks.splice(from, 1);
    blocks.splice(to, 0, moved!);
    await this.store.update(this.ownerId, id, { blocks } as unknown as ItemData);
    return true;
  }

  async deleteBlock(id: string, blockId: string): Promise<boolean> {
    const note = await this.getNote(id);
    if (!note) return false;
    const idx = note.blocks.findIndex((b) => b.id === blockId);
    if (idx < 0) return false;
    const blocks = note.blocks.slice();
    blocks.splice(idx, 1);
    await this.store.update(this.ownerId, id, { blocks } as unknown as ItemData);
    return true;
  }

  async applyTemplate(id: string, key: TemplateKey): Promise<boolean> {
    const note = await this.getNote(id);
    if (!note) return false;
    const template = TEMPLATES[key];
    if (!template) return false;
    const blocks: Block[] = template.map((b) => ({ id: genId("b"), ...JSON.parse(JSON.stringify(b)) }));
    await this.store.update(this.ownerId, id, { blocks } as unknown as ItemData);
    return true;
  }

  async addConnection(
    id: string,
    kind: string,
    label: string,
    category: string | null = null,
    targetId?: string,
  ): Promise<string | null> {
    const note = await this.getNote(id);
    if (!note) return null;
    const conn: Connection = { id: genId("c"), kind, label, category };
    if (targetId) conn.targetId = targetId;
    const connections = [...note.connections, conn];
    await this.store.update(this.ownerId, id, { connections } as unknown as ItemData);
    return conn.id;
  }

  async removeConnection(id: string, connId: string): Promise<boolean> {
    const note = await this.getNote(id);
    if (!note) return false;
    const idx = note.connections.findIndex((c) => c.id === connId);
    if (idx < 0) return false;
    const connections = note.connections.slice();
    connections.splice(idx, 1);
    await this.store.update(this.ownerId, id, { connections } as unknown as ItemData);
    return true;
  }

  // Each checklist item becomes a task item, linked one-way to the note and
  // inheriting the note's category. Tasks are independent items, so they
  // survive note deletion.
  //
  // Idempotent: items that already have a taskId are skipped (running it twice
  // no longer duplicates every task), blanks are skipped, and each created
  // task's id is stored back on the item so the two stay in sync.
  async tasksFromChecklist(id: string): Promise<string[]> {
    const note = await this.getNote(id);
    if (!note) return [];
    const made: string[] = [];
    for (const block of note.blocks) {
      if (block.type !== "checklist" || !block.items) continue;
      const items = this.normalizeItems(block.items);
      let changed = false;
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        if (!it.text.trim() || it.taskId) continue;
        const data: TaskData = { text: it.text, fromNote: id, category: note.category, done: it.done };
        const tid = await this.store.create(this.ownerId, ENTITY_TASK, data as unknown as ItemData);
        items[i] = { ...it, taskId: tid };
        changed = true;
        made.push(tid);
      }
      if (changed) await this.editBlock(id, block.id, { items });
    }
    return made;
  }

  // Pull linked-task completion states back into the note's checklist, so a
  // task checked off in Tasks shows checked here too. Writes only on drift.
  async reconcileChecklistTasks(id: string): Promise<void> {
    const note = await this.getNote(id);
    if (!note) return;
    const tasks = await this.listTasks();
    const doneById = new Map(tasks.map((t) => [t.id, !!(t.data as unknown as TaskData).done]));
    for (const block of note.blocks) {
      if (block.type !== "checklist" || !block.items) continue;
      const items = this.normalizeItems(block.items);
      let changed = false;
      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        if (!it.taskId || !doneById.has(it.taskId)) continue;
        const taskDone = doneById.get(it.taskId)!;
        if (it.done !== taskDone) { items[i] = { ...it, done: taskDone }; changed = true; }
      }
      if (changed) await this.editBlock(id, block.id, { items });
    }
  }

  private normalizeItems(items: Block["items"]): ChecklistItem[] {
    return (items ?? []).map((it) => (typeof it === "string" ? { text: it, done: false } : it));
  }

  async toggleChecklistItem(noteId: string, blockId: string, index: number): Promise<boolean> {
    const note = await this.getNote(noteId);
    if (!note) return false;
    const block = note.blocks.find((b) => b.id === blockId);
    if (!block || block.type !== "checklist") return false;
    const items = this.normalizeItems(block.items);
    if (index < 0 || index >= items.length) return false;
    const next = !items[index]!.done;
    items[index] = { ...items[index]!, done: next };
    const ok = await this.editBlock(noteId, blockId, { items });
    // Keep the linked task (if this item was promoted) in the same state.
    const taskId = items[index]!.taskId;
    if (ok && taskId) {
      try { await this.store.update(this.ownerId, taskId, { done: next } as unknown as ItemData); }
      catch { /* the task may have been deleted; the note toggle still stands */ }
    }
    return ok;
  }

  async setChecklistItemText(noteId: string, blockId: string, index: number, text: string): Promise<boolean> {
    const note = await this.getNote(noteId);
    if (!note) return false;
    const block = note.blocks.find((b) => b.id === blockId);
    if (!block || block.type !== "checklist") return false;
    const items = this.normalizeItems(block.items);
    if (index < 0 || index >= items.length) return false;
    items[index] = { ...items[index]!, text };
    return this.editBlock(noteId, blockId, { items });
  }

  // Append a blank checklist item (the editor focuses it for typing). Returns
  // the new item's index so the caller can focus it.
  async addChecklistItem(noteId: string, blockId: string): Promise<number | null> {
    const note = await this.getNote(noteId);
    if (!note) return null;
    const block = note.blocks.find((b) => b.id === blockId);
    if (!block || block.type !== "checklist") return null;
    const items = this.normalizeItems(block.items);
    items.push({ text: "", done: false });
    const ok = await this.editBlock(noteId, blockId, { items });
    return ok ? items.length - 1 : null;
  }

  // Remove a checklist item (used when an item is left blank on blur, so no
  // orphaned empty checkboxes remain).
  async deleteChecklistItem(noteId: string, blockId: string, index: number): Promise<boolean> {
    const note = await this.getNote(noteId);
    if (!note) return false;
    const block = note.blocks.find((b) => b.id === blockId);
    if (!block || block.type !== "checklist") return false;
    const items = this.normalizeItems(block.items);
    if (index < 0 || index >= items.length) return false;
    items.splice(index, 1);
    return this.editBlock(noteId, blockId, { items });
  }

  async deleteNote(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_NOTE, entityId: id });
  }

  // Recreate a just-deleted note whole: blocks, connections, everything. This
  // exists so note deletion can use the app's one convention for destructive
  // actions, delete-then-Undo-toast (tasks set it), instead of the
  // window.confirm dialog it had (audit 2026-08-07). The note gets a NEW id;
  // by the time Undo is tappable the old id is already gone from every list.
  async restoreNote(data: NoteData): Promise<string | null> {
    const id = await this.store.create(this.ownerId, ENTITY_NOTE, data as unknown as ItemData);
    this.onEvent({ type: "entity.created", entityType: ENTITY_NOTE, entityId: id });
    return id;
  }

  async listNotes() {
    const items = await this.store.listForUser(this.ownerId);
    return items.filter((i) => i.entityType === ENTITY_NOTE);
  }

  // Reverse lookup: every note whose connections point at the given entity id.
  // Returns light summaries so callers (project/task/person screens) can show a
  // "Linked Notes" section without loading full note bodies.
  async notesLinkedTo(targetId: string): Promise<{ id: string; title: string; category: string }[]> {
    if (!targetId) return [];
    const items = await this.store.listForUser(this.ownerId);
    const out: { id: string; title: string; category: string }[] = [];
    for (const it of items) {
      if (it.entityType !== ENTITY_NOTE) continue;
      const d = it.data as unknown as NoteData;
      if (Array.isArray(d.connections) && d.connections.some((c) => c.targetId === targetId)) {
        out.push({ id: it.id, title: d.title || "Untitled", category: d.category || "" });
      }
    }
    return out;
  }

  async listTasks() {
    const items = await this.store.listForUser(this.ownerId);
    return items.filter((i) => i.entityType === ENTITY_TASK);
  }

  // offline controls pass through to the engine store
  goOffline() {
    this.store.goOffline();
  }
  reconnect() {
    return this.store.reconnect();
  }
  queueLen() {
    return this.store.queueLen();
  }
}
