// Brain Manual v1 (Phase 1) -- the filing intake's screen-facing write path.
//
// One service for every in-flow filing button (note "File as…", "Save My
// Voice", "Log the Decision", "Who Is This?", the + menu). It writes
// brain_memory rows to the universal `item` table through the same Store
// every other service uses -- offline queueing, realtime sync and RLS come
// along -- and emits the standard entity events.
//
// The pure core lives in filing.ts (countWords, voiceGuard) and
// filingIntake.ts (fileMemory, undoFiling, oldestVoiceSample,
// showFilingConfirm): this class owns the store access and the event
// emission, and delegates the decisions to them, so the two never drift.
//
// Filing is a memory write the user initiated by tapping, never an AI
// action: it goes straight through, at every AI Control level, with no
// approval card and no aiGate (flow-doc §6).

import type { Store, ItemData, Item } from "@core";
import type { EventInput } from "../events";
import {
  BRAIN_MEMORY_ENTITY,
  PERSON_ENTITY,
  type BrainMemoryCategory,
  type BrainMemoryData,
  type BrainMemoryRow,
  type BrainMemorySource,
  type PersonTriageData,
} from "./brainMemory";
import { countWords, voiceGuard, type VoiceGuardResult } from "./filing";
import { oldestVoiceSample, undoFiling } from "./filingIntake";

export type { BrainMemoryRow };
export type { VoiceGuardResult };

/** One row's state in app words: Active, Reversed, Archived. */
export function decisionStateLabel(row: BrainMemoryRow): string {
  const status = row.data.status ?? "active";
  return status === "active" ? "Active" : status === "reversed" ? "Reversed" : "Archived";
}

// The Store's Item carries no wall-clock timestamps -- serverTime (epoch
// ms, monotonic) is the ordering signal, so the row's ISO stamps are
// derived from it.
function toRow(item: Item): BrainMemoryRow {
  const stamp = new Date(item.serverTime).toISOString();
  return { id: item.id, data: item.data as unknown as BrainMemoryData, created_at: stamp, updated_at: stamp };
}

export class BrainMemoryService {
  constructor(
    private store: Store,
    private ownerId: string,
    private onEvent: (e: EventInput) => void = () => {},
  ) {}

  // File a brain-memory row. Filing empty text is rejected client-side
  // (flow-doc §6): null means "nothing was written", never a thrown error
  // the caller has to translate. `id` is for Undo restores only -- a
  // replaced voice sample comes back under its old id so anything holding
  // that id still opens it (the TasksService.createTask precedent).
  async file(data: BrainMemoryData, id?: string): Promise<string | null> {
    if (!data.text || !data.text.trim()) return null;
    const clean: BrainMemoryData = { ...data, text: data.text.trim(), pinned: data.pinned ?? false };
    const newId = await this.store.create(this.ownerId, BRAIN_MEMORY_ENTITY, clean as unknown as ItemData, id);
    this.onEvent({ type: "entity.created", entityType: BRAIN_MEMORY_ENTITY, entityId: newId });
    return newId;
  }

  // Undo a filing: the row goes away. Per the toast law (SHARED-F-03) this
  // deletes the exact row the filing created, never a toggle.
  async unfile(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType: BRAIN_MEMORY_ENTITY, entityId: id });
  }

  async listByCategory(category: BrainMemoryCategory): Promise<BrainMemoryRow[]> {
    const items = await this.store.listForUser(this.ownerId, BRAIN_MEMORY_ENTITY);
    return items
      .filter((i) => (i.data as unknown as BrainMemoryData | undefined)?.category === category)
      .map((i) => toRow(i))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // Voice samples, newest first. The cap lives on the count, not the list.
  async voiceSamples(): Promise<BrainMemoryRow[]> {
    return this.listByCategory("voice");
  }

  // The §4.4 guardrails, answered by filing.ts's pure voiceGuard against
  // the current samples: "ok", "too-short" (offer "save anyway"), or
  // "duplicate" (skip with a notice, never file twice).
  async voiceCheck(text: string): Promise<VoiceGuardResult> {
    const samples = await this.voiceSamples();
    return voiceGuard(text, samples.map((s) => s.data.text));
  }

  // File a voice sample with the cap guard: at VOICE_SAMPLE_CAP the oldest
  // sample is replaced (oldestVoiceSample, filingIntake), and its snapshot
  // is returned so Undo can restore it.
  //
  // THE NEW ONE IS WRITTEN BEFORE THE OLD ONE GOES (Dave 2026-09-28). A
  // failed or refused write leaves the oldest exactly where it was; a failed
  // delete after a good write leaves one sample over the cap, never one short,
  // and reports nothing replaced so Undo does not recreate a row that exists.
  async saveVoiceSample(text: string, source: BrainMemorySource = "email"): Promise<{ id: string | null; replaced: BrainMemoryRow | null; count: number }> {
    const samples = await this.voiceSamples();
    const oldest = oldestVoiceSample(samples);
    const id = await this.file({
      category: "voice",
      state: "LEARNED",
      text,
      source,
      wordCount: countWords(text),
    });
    if (!id) return { id: null, replaced: null, count: samples.length };
    let replaced: BrainMemoryRow | null = null;
    if (oldest) {
      try {
        await this.unfile(oldest.id);
        replaced = oldest;
      } catch { /* over the cap by one until the next save; nothing lost */ }
    }
    const after = await this.voiceSamples();
    return { id, replaced, count: after.length };
  }

  // Whether the last write is still on this phone: offline, or queued behind
  // a dropped connection. A filing toast says "Will Sync" instead of "Saved"
  // until it has reached the server (Dave 2026-09-28).
  pending(): boolean {
    const s = this.store.syncState();
    return !s.online || s.queued > 0;
  }

  // Undo of a capped replacement: the new row goes away and the replaced
  // sample comes back under its old id, with its original payload intact
  // (undoFiling's restore path, filingIntake).
  async restoreVoiceSample(newId: string, replaced: BrainMemoryRow): Promise<void> {
    await undoFiling(
      newId,
      { store: this.store, ownerId: this.ownerId },
      { id: replaced.id, data: replaced.data },
    );
    this.onEvent({ type: "entity.deleted", entityType: BRAIN_MEMORY_ENTITY, entityId: newId });
    this.onEvent({ type: "entity.created", entityType: BRAIN_MEMORY_ENTITY, entityId: replaced.id });
  }

  // Every brain_memory row, newest first. The Brain tab pages (What JARVIS
  // Knows, Decisions, the simple lists, export) read through this.
  async list(): Promise<BrainMemoryRow[]> {
    const items = await this.store.listForUser(this.ownerId, BRAIN_MEMORY_ENTITY);
    return items
      .map((i) => toRow(i))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async get(id: string): Promise<BrainMemoryRow | null> {
    const item = await this.store.read(this.ownerId, id);
    if (!item || item.entityType !== BRAIN_MEMORY_ENTITY) return null;
    return toRow(item);
  }

  // Edit: patch a row's data. A patch that would blank the text is refused,
  // the same client-side rule as filing.
  async update(id: string, patch: Partial<BrainMemoryData>): Promise<boolean> {
    const row = await this.get(id);
    if (!row) return false;
    const text = patch.text !== undefined ? patch.text.trim() : row.data.text;
    if (!text) return false;
    const next: BrainMemoryData = { ...row.data, ...patch, text };
    await this.store.update(this.ownerId, id, next as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: BRAIN_MEMORY_ENTITY, entityId: id });
    return true;
  }

  // Revisit (Decisions): the new value is a NEW row linked backward, the old
  // row is archived and linked forward. Nothing is ever deleted by a
  // revisit, so the trail of what changed survives.
  async supersede(oldId: string, data: BrainMemoryData): Promise<string | null> {
    const old = await this.get(oldId);
    if (!old || old.data.category !== "decision") return null;
    const newId = await this.file({ ...data, category: "decision", status: "active", supersedes: oldId });
    if (!newId) return null;
    const archived: BrainMemoryData = { ...old.data, status: "archived", supersededBy: newId };
    await this.store.update(this.ownerId, oldId, archived as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: BRAIN_MEMORY_ENTITY, entityId: oldId });
    return newId;
  }

  async markReversed(id: string, reversed: boolean): Promise<boolean> {
    return this.update(id, { status: reversed ? "reversed" : "active" });
  }

  // Erase (Settings → Brain): every brain_memory row goes away. Contacts
  // keep their rows; their triage reset is the erase screen's own write.
  // One failed delete never stops the rest, and the count of rows still
  // standing comes back, so the screen can say so and a second tap finishes
  // the job (it re-reads what is left). Dave 2026-09-28: never stop halfway
  // silently.
  async removeAll(): Promise<{ removed: number; failed: number }> {
    const rows = await this.list();
    let removed = 0;
    let failed = 0;
    for (const r of rows) {
      try { await this.unfile(r.id); removed++; } catch { failed++; }
    }
    return { removed, failed };
  }

  // "Who Is This?": write the triage fields onto the person row. The roles
  // are the flow-doc string set (BRAIN_ROLES), distinct from the person
  // sheet's per-area roles -- see people/types.ts on the shared key.
  async triagePerson(
    personId: string,
    roles: string[],
    roleNote: string | undefined,
    source: PersonTriageData["source"],
  ): Promise<boolean> {
    const item = await this.store.read(this.ownerId, personId);
    if (!item || item.entityType !== PERSON_ENTITY) return false;
    const data = { ...(item.data as Record<string, unknown>) } as Record<string, unknown>;
    // The key is shared with the person sheet's per-area roles (objects).
    // Triage owns the string entries only: the object entries are preserved
    // verbatim, the old string entries are replaced by this pick.
    const existing = Array.isArray(data.roles) ? data.roles : [];
    const keptAreaRoles = existing.filter((r) => typeof r !== "string");
    const picked = [...new Set(roles.filter((r) => typeof r === "string" && r))];
    data.roles = [...keptAreaRoles, ...picked];
    data.roleNote = roleNote && roleNote.trim() ? roleNote.trim() : null;
    data.triageState = "sorted";
    if (source) data.source = source;
    await this.store.update(this.ownerId, personId, data as unknown as ItemData);
    this.onEvent({ type: "entity.updated", entityType: PERSON_ENTITY, entityId: personId });
    return true;
  }
}
