// Brain Manual v1 (Phase 1) - filing intake.
//
// The write half of the filing flow: turn a filing into a brain_memory row
// payload (fileMemory, pure), write it (saveFiling, store injected), undo it
// (undoFiling, per-filing), and confirm it (showFilingConfirm, the app's
// existing toast pattern from shared/toast.ts - no new visual language).
//
// Flow doc §4: every flow ends the same way - a one-line toast naming the
// destination ("Saved to Philosophy ✓") with Undo for UNDO_MS (8s). Undo
// deletes the row it just wrote (or, for the 6th voice sample replacing the
// oldest, restores the replaced row under its old id). An undo sets a state,
// it never toggles one (SHARED-F-03 in shared/toast.ts).

import type { ItemData } from "@core";
import {
  BRAIN_MEMORY_ENTITY,
  UNDO_MS,
  VOICE_SAMPLE_CAP,
  filedToastText,
  type BrainMemoryCategory,
  type BrainMemoryData,
  type BrainMemoryRow,
  type BrainMemorySource,
} from "./brainMemory";
import { countWords } from "./filing";
import { todayISO } from "../schedule/calendar";
import { showToast } from "../shared/toast";

export interface FileMemoryInput {
  category: BrainMemoryCategory;
  text: string; // callers must not file empty text; §4 Note flow disables it
  why?: string;
  source: BrainMemorySource;
  linkedItemIds?: string[]; // decisions filed from a task/event
}

// The write surface saveFiling needs. Structural, not the class, so tests
// inject a fake without an adapter. The real Store satisfies it: the
// signatures below match Store.create/Store.delete exactly.
export interface FilingStore {
  create(ownerId: string, entityType: string, data: ItemData, id?: string): Promise<string>;
  delete(ownerId: string, id: string): Promise<void>;
}

export interface FilingEnv {
  store: FilingStore;
  ownerId: string;
}

// Pure payload builder: input -> brain_memory data payload, shaped per flow
// doc §2. Decisions get today's date and 'active' status by default; voice
// samples carry their word count.
export function fileMemory(input: FileMemoryInput): BrainMemoryData {
  const text = input.text.trim();
  const data: BrainMemoryData = {
    category: input.category,
    state: "LEARNED",
    text,
    source: input.source,
    pinned: false,
  };
  if (input.why?.trim()) data.why = input.why.trim();
  if (input.linkedItemIds && input.linkedItemIds.length > 0) data.linkedItemIds = [...input.linkedItemIds];
  if (input.category === "decision") {
    data.date = todayISO();
    data.status = "active";
  }
  if (input.category === "voice") {
    data.wordCount = countWords(text);
  }
  return data;
}

// Writes the row and returns the new id; the caller keeps it for Undo.
// Filing is a memory write, not an AI action, so it needs no approval card
// at any AI Control level, including Off (flow doc §6).
export async function saveFiling(input: FileMemoryInput, env: FilingEnv): Promise<string> {
  // The ItemsData cast follows the TasksService convention (TasksService.ts):
  // optional fields widen to string|undefined, which Record<string, Json>
  // rejects, so the cast lives at the write boundary, not in the payload.
  return env.store.create(env.ownerId, BRAIN_MEMORY_ENTITY, fileMemory(input) as unknown as ItemData);
}

// Per-filing undo: deletes exactly the row the filing created, nothing else
// - never a toggle (SHARED-F-03). For the voice 6th-sample flow the caller
// passes the row the new sample replaced, and it is recreated under its OLD
// id so anything holding that id still opens it (the recreateFrom convention
// in TasksService: `id` on create is for restores only).
export async function undoFiling(
  rowId: string,
  env: FilingEnv,
  restore?: { id: string; data: BrainMemoryData },
): Promise<void> {
  await env.store.delete(env.ownerId, rowId);
  if (restore) {
    await env.store.create(env.ownerId, BRAIN_MEMORY_ENTITY, restore.data as unknown as ItemData, restore.id);
  }
}

// Voice cap helper (flow doc §4.4): with VOICE_SAMPLE_CAP samples already
// filed, the next save replaces the oldest. Returns that row (oldest
// created_at wins), or null when there is room. The caller writes the new
// sample, keeps the replaced row for Undo, and passes it to undoFiling.
export function oldestVoiceSample(rows: BrainMemoryRow[]): BrainMemoryRow | null {
  const voice = rows.filter((r) => r.data.category === "voice");
  if (voice.length < VOICE_SAMPLE_CAP) return null;
  return voice.reduce((a, b) => (a.created_at <= b.created_at ? a : b));
}

// The confirm toast, in the app's existing toast pattern (shared/toast.ts +
// ToastHost): the message names the destination via filedToastText, the
// Undo capsule runs the caller's per-filing undo (writes the exact restore
// state, SHARED-F-03), and the toast lives UNDO_MS (8s). Same component, same
// styles as every other "Saved …" toast; no new visuals.
export function showFilingConfirm(category: BrainMemoryCategory, onUndo: () => void): void {
  showToast(
    { message: filedToastText(category), actionLabel: "Undo", onAction: onUndo },
    UNDO_MS,
  );
}
