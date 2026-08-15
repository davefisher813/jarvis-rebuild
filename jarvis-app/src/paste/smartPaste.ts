// Smart Paste, the pipeline (addendum item 1). Deterministic first, AI
// fallback only for what the rules could not read confidently (and only when
// AI Control allows it; the pin is pasteFallback), honest note fallback when
// the AI cannot make sense of it either. Saves INSTANTLY: no preview gate,
// no confirm; correction happens after the fact via refile chips and undo
// (locked principle 1, minimum taps).

import type { AIService } from "../ai/AIService";
import { captureSystemPrompt, parseCapture, applyCapture, type CaptureResult } from "../ai/capture";
import type { AIContext } from "../ai/context";
import type { TasksService } from "../tasks/TasksService";
import type { ScheduleService } from "../schedule/ScheduleService";
import type { NotesService } from "../notes/NotesService";
import type { Category } from "../categories/types";
import { madeBy } from "../shared/provenance";
import { parsePaste, titleCase, type ParsedEntity } from "./deterministic";
import { markPasteSeen, recordCapture } from "./captureLog";

export interface SavedEntity {
  id: string;
  kind: "task" | "event" | "note";
  title: string;
  date?: string;
  start?: string;
  category?: string;
}

export interface PasteDeps {
  ai: AIService;
  gather: () => Promise<AIContext>;
  tasks: TasksService;
  schedule: ScheduleService;
  notes: NotesService;
  categories: Category[];
  today: string;
}

function toCaptureResult(e: ParsedEntity): CaptureResult {
  return {
    kind: e.kind,
    title: e.title,
    ...(e.date ? { date: e.date } : {}),
    ...(e.start ? { start: e.start } : {}),
    ...(e.body ? { notes: e.body } : {}),
  };
}

// Try the AI on one unconfident line. Any failure (unavailable, gated off,
// network, unparseable reply) returns null; the caller falls back honestly.
async function aiImprove(line: string, deps: PasteDeps): Promise<CaptureResult | null> {
  if (!deps.ai.available) return null;
  try {
    const ctx = await deps.gather();
    const raw = await deps.ai.complete(
      [{ role: "user", content: line }],
      captureSystemPrompt(ctx, deps.today),
      { kind: "paste", pin: "pasteFallback" },
    );
    const parsed = parseCapture(raw);
    if (!parsed) return null;
    // Created titles get the convention; the model does not get to invent
    // casing any more than the heuristics do.
    parsed.title = titleCase(parsed.title);
    return parsed;
  } catch {
    return null;
  }
}

// Save a paste. Returns what was created, in order, for the receipt, the
// refile chips, and undo.
export async function smartPasteSave(text: string, deps: PasteDeps): Promise<SavedEntity[]> {
  const { entities } = parsePaste(text, deps.today);
  const saved: SavedEntity[] = [];
  for (const e of entities) {
    let result: CaptureResult;
    if (e.confident) {
      result = toCaptureResult(e);
    } else {
      const improved = await aiImprove(e.body ?? e.title, deps);
      if (improved) {
        result = improved;
      } else if (deps.ai.available) {
        // The AI ran (or was reachable) and still could not read it: honest
        // note fallback, paste kept verbatim. Never a guessed schedule.
        result = { kind: "note", title: e.title, notes: e.body ?? e.title };
      } else {
        // No AI in this build: the deterministic guess stands (a short text
        // saved as a task is the cheapest honest read, and it is reversible
        // with one chip).
        result = toCaptureResult(e);
      }
    }
    const { id } = await applyCapture(result, deps, deps.categories, deps.today, madeBy("paste"));
    if (id) {
      const s: SavedEntity = {
        id,
        kind: result.kind,
        title: result.title,
        ...(result.date ? { date: result.date } : {}),
        ...(result.start ? { start: result.start } : {}),
        ...(result.category ? { category: result.category } : {}),
      };
      saved.push(s);
      recordCapture({ id, kind: s.kind, title: s.title, ts: Date.now() });
    }
  }
  if (saved.length) markPasteSeen(text);
  return saved;
}

// Undo one created entity: the record disappears entirely.
export async function undoSaved(s: SavedEntity, deps: Pick<PasteDeps, "tasks" | "schedule" | "notes">): Promise<void> {
  if (s.kind === "task") await deps.tasks.deleteTask(s.id);
  else if (s.kind === "event") await deps.schedule.deleteEvent(s.id);
  else await deps.notes.deleteNote(s.id);
}

// Refile to another kind: delete the created record, recreate as the target
// kind with the same facts and the same paste provenance. Returns the new
// entity for the receipt to keep tracking.
export async function refileSaved(
  s: SavedEntity,
  toKind: SavedEntity["kind"],
  deps: PasteDeps,
): Promise<SavedEntity | null> {
  if (toKind === s.kind) return s;
  await undoSaved(s, deps);
  const result: CaptureResult = {
    kind: toKind,
    title: s.title,
    ...(s.date ? { date: s.date } : {}),
    ...(s.start ? { start: s.start } : {}),
    ...(toKind === "note" ? { notes: s.title } : {}),
  };
  const { id } = await applyCapture(result, deps, deps.categories, deps.today, madeBy("paste"));
  if (!id) return null;
  const next: SavedEntity = { ...s, id, kind: toKind };
  recordCapture({ id, kind: toKind, title: s.title, ts: Date.now() });
  return next;
}

// Refile to another category, in place.
export async function recategorizeSaved(
  s: SavedEntity,
  categoryId: string,
  deps: Pick<PasteDeps, "tasks" | "schedule" | "notes">,
): Promise<void> {
  if (s.kind === "task") await deps.tasks.setCategory(s.id, categoryId);
  else if (s.kind === "event") await deps.schedule.editCategory(s.id, categoryId);
  else await deps.notes.setCategory(s.id, categoryId);
}
