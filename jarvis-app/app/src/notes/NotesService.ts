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

  async addBlock(id: string, block: Omit<Block, "id">): Promise<string | null> {
    const note = await this.getNote(id);
    if (!note) return null;
    const b: Block = { id: genId("b"), ...block };
    const blocks = [...note.blocks, b];
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
  ): Promise<string | null> {
    const note = await this.getNote(id);
    if (!note) return null;
    const conn: Connection = { id: genId("c"), kind, label, category };
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
  async tasksFromChecklist(id: string): Promise<string[]> {
    const note = await this.getNote(id);
    if (!note) return [];
    const made: string[] = [];
    for (const block of note.blocks) {
      if (block.type !== "checklist" || !block.items) continue;
      for (const raw of block.items) {
        const text = typeof raw === "string" ? raw : raw.text;
        const data: TaskData = { text, fromNote: id, category: note.category, done: false };
        const tid = await this.store.create(this.ownerId, ENTITY_TASK, data as unknown as ItemData);
        made.push(tid);
      }
    }
    return made;
  }

  async deleteNote(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: ENTITY_NOTE, entityId: id });
  }

  async listNotes() {
    const items = await this.store.listForUser(this.ownerId);
    return items.filter((i) => i.entityType === ENTITY_NOTE);
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
