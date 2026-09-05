// Smart Paste, the pipeline (addendum item 1). Deterministic first, AI
// fallback only for what the rules could not read confidently (and only when
// AI Control allows it; the pin is pasteFallback), honest note fallback when
// the AI cannot make sense of it either. Saves INSTANTLY: no preview gate,
// no confirm; correction happens after the fact via refile chips and undo
// (locked principle 1, minimum taps).

import type { AIService } from "../ai/AIService";
import { captureSystemPrompt, parseCapture, applyCapture, CAPTURE_SCHEMA, type CaptureResult } from "../ai/capture";
import type { AIContext } from "../ai/context";
import type { TasksService } from "../tasks/TasksService";
import type { ScheduleService } from "../schedule/ScheduleService";
import type { NotesService } from "../notes/NotesService";
import type { Category } from "../categories/types";
import { madeBy } from "../shared/provenance";
import { parsePaste, titleCase, type ParsedEntity } from "./deterministic";
import { selfFact } from "./selfFact";
import { markPasteSeen, recordCapture } from "./captureLog";
import { aliasTrigger } from "../rules/triggers";
import type { LearnedRule, LearnedRulesService } from "../rules/LearnedRulesService";
import type { StrandsService } from "../brain/strands/StrandsService";
import type { StrandCategory } from "../brain/strands/types";

export interface SavedEntity {
  id: string;
  // "fact" lands in the Brain (a told-rank strand), not on a list. See
  // selfFact.ts and the Quick Add block in smartPasteSave below.
  kind: "task" | "event" | "note" | "fact";
  title: string;
  date?: string;
  start?: string;
  category?: string;
  // Fact only: the strand category it was filed under.
  factCategory?: StrandCategory;
  // The line exactly as pasted. Both halves of the learned-rules loop derive
  // their trigger from THIS and never from title, so the correction that
  // teaches a rule and the lookup that applies it key on the same string.
  // They did not, briefly: title has been through titleCase, and running the
  // proper-noun heuristic over it made the trigger the whole title.
  raw?: string;
}

export interface PasteDeps {
  ai: AIService;
  gather: () => Promise<AIContext>;
  tasks: TasksService;
  schedule: ScheduleService;
  notes: NotesService;
  categories: Category[];
  today: string;
  // Learned rules, optional. Absent means no capture is ever categorised by
  // a rule, which is what every existing caller and every test gets by
  // default: this can only ever change behaviour where it is passed in.
  rules?: Pick<LearnedRulesService, "resolve" | "announceIfFirstUse">;
  // The genome, optional (Quick Add, handoff 5.0). Absent means the fact
  // lane is closed and a self-fact lands the way it does today, as a task:
  // degrading to the old behaviour, never dropping the capture on the floor.
  // Same seam shape as `rules` above.
  strands?: Pick<StrandsService, "add" | "list" | "remove" | "recategorize">;
  // Called when a fact could not be filed because the genome (or its
  // category) is at its cap. A refusal with a real reason has to reach the
  // person: without this the receipt would fall through to "Nothing to save
  // in that", which is the one thing that did not happen. The caller owns
  // the wording, the way TodaySuggestions already owns its three outcomes.
  onFactRefused?: (text: string) => void;
}

// APPLYING WHAT IT LEARNED (2026-08-24). Two identical corrections of the
// same proper noun made a rule; this is the decision point that rule exists
// to answer. Consulted BEFORE the write, so the capture lands categorised
// correctly the first time rather than being fixed a moment later.
//
// Four refusals, in order, and every one of them is the difference between a
// rule and a guess:
//
//   1. No trigger in the text means no rule can key on it. triggers.ts
//      already refuses to invent one.
//   2. No rule for that trigger means fall through. resolve() never
//      generalizes, so silence here is the normal case, not a failure.
//   3. A rule that agrees with what JARVIS was going to do anyway changes
//      nothing, so it is not a USE and must not announce. An announcement
//      about a non-event is noise, and this toast has exactly one job.
//   4. A rule pointing at a category that no longer exists is stale, and
//      applying it would write a dangling id. It is ignored rather than
//      repaired, because guessing which category replaced it is the kind of
//      inference this whole engine is built to avoid.
//
// The announcement is not optional and not deferred. types.ts states the
// deal that licenses creating a rule with no confirmation step: "Every rule
// announces itself on first use. Visibility is what licenses creating it
// without a tap." The first time a rule silently changes something is the
// moment it has to say so, and laws.test.ts fails if this file resolves
// without announcing.
async function categoryFromRule(result: CaptureResult, raw: string, deps: PasteDeps): Promise<CaptureResult> {
  if (!deps.rules) return result;
  const trigger = aliasTrigger(raw);
  if (!trigger) return result;
  let rule: LearnedRule | null = null;
  try {
    rule = await deps.rules.resolve("capture.category", trigger);
  } catch {
    return result; // a store that cannot be read teaches nothing this time
  }
  if (!rule) return result;
  if (rule.data.to === result.category) return result;
  if (!deps.categories.some((c) => c.id === rule!.data.to)) return result;
  await deps.rules.announceIfFirstUse(rule);
  return { ...result, category: rule.data.to };
}

// Facts never reach here: smartPasteSave branches on them first. The kind is
// passed separately rather than read off `e` because ParsedEntity is one
// interface with a union field, not a discriminated union, so narrowing
// `e.kind` at the call site does not narrow `e` itself. Making the caller
// hand over the already-narrowed kind is what keeps a fact from silently
// becoming a CaptureResult if this file changes shape later.
function toCaptureResult(e: ParsedEntity, kind: CaptureResult["kind"]): CaptureResult {
  return {
    kind,
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
      { kind: "paste", pin: "pasteFallback", schema: CAPTURE_SCHEMA },
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
    // QUICK ADD (handoff 5.0). A standing fact about the user goes straight
    // into the genome as a told-rank strand: no AI call (a model never gets
    // to decide it heard a belief about someone), no category rules (those
    // key on app categories, which a strand does not use), no applyCapture.
    //
    // With no strand store the lane is closed and the line falls through to
    // the ordinary reads below, which is exactly today's behaviour. A
    // capture is never dropped because a service was missing.
    if (e.kind === "fact" && deps.strands) {
      const cat = e.factCategory ?? "values";
      const id = await deps.strands.add(e.title, cat, deps.today);
      // add() returns null when the genome or the category is at its cap.
      // That is a real refusal with a real reason, so it must not silently
      // become a task: the caller says so on the receipt.
      if (id) {
        const s: SavedEntity = { id, kind: "fact", title: e.title, factCategory: cat, raw: e.raw };
        saved.push(s);
        recordCapture({ id, kind: "fact", title: s.title, ts: Date.now() });
      } else {
        deps.onFactRefused?.(e.title);
      }
      continue;
    }
    let result: CaptureResult;
    if (e.kind === "fact") {
      // The lane is closed (no strand store). Read it the way this pipeline
      // read it before Quick Add existed: a short line with no date is a
      // task, reversible with one chip.
      result = { kind: "task", title: titleCase(e.title) };
    } else if (e.confident) {
      result = toCaptureResult(e, e.kind);
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
        result = toCaptureResult(e, e.kind);
      }
    }
    result = await categoryFromRule(result, e.raw, deps);
    const { id } = await applyCapture(result, deps, deps.categories, deps.today, madeBy("paste"));
    if (id) {
      const s: SavedEntity = {
        id,
        kind: result.kind,
        title: result.title,
        ...(result.date ? { date: result.date } : {}),
        ...(result.start ? { start: result.start } : {}),
        ...(result.category ? { category: result.category } : {}),
        raw: e.raw,
      };
      saved.push(s);
      recordCapture({ id, kind: s.kind, title: s.title, ts: Date.now() });
    }
  }
  if (saved.length) markPasteSeen(text);
  return saved;
}

// Undo one created entity: the record disappears entirely.
export async function undoSaved(s: SavedEntity, deps: Pick<PasteDeps, "tasks" | "schedule" | "notes" | "strands">): Promise<void> {
  if (s.kind === "fact") {
    // remove() takes the strand so it can emit a correction event for a
    // WATCHED one; a told strand emits nothing. Looked up through list()
    // rather than adding a delete-by-id door to the service: the genome is
    // small, and one fewer way to delete a fact is the right trade.
    const hit = (await deps.strands?.list())?.find((x) => x.id === s.id);
    if (hit) await deps.strands!.remove(hit);
    return;
  }
  if (s.kind === "task") await deps.tasks.deleteTask(s.id);
  else if (s.kind === "event") await deps.schedule.deleteEvent(s.id);
  else await deps.notes.deleteNote(s.id);
}

// Refile to another kind: recreate as the target kind with the same facts and
// the same paste provenance, then delete the created record. Returns the new
// entity for the receipt to keep tracking, or null when the target lane
// REFUSED (a full Brain, or no Brain at all), in which case the original is
// exactly where it was.
//
// SHELL-F-02 (2026-09-05): this used to delete first and create second, so a
// refusal from strands.add (twelve per bucket) left the person with nothing:
// the task gone from Tasks, no strand in the Brain, and a Recent Captures row
// that opened nothing. The target is now written before the original is
// touched; a refusal costs nothing and a null return means "refused", never
// "half done".
export async function refileSaved(
  s: SavedEntity,
  toKind: SavedEntity["kind"],
  deps: PasteDeps,
): Promise<SavedEntity | null> {
  if (toKind === s.kind) return s;
  let next: SavedEntity;
  // Refiling INTO the Brain: the sentence becomes a told-rank strand. The
  // category comes from the same classifier the lane uses, so a line the
  // shapes did not match still gets a sensible bucket rather than none.
  if (toKind === "fact") {
    if (!deps.strands) return null;
    const cat = selfFact(s.raw ?? s.title)?.category ?? "values";
    const id = await deps.strands.add(s.raw ?? s.title, cat, deps.today);
    if (!id) return null;
    next = { ...s, id, kind: "fact", factCategory: cat };
  } else {
    const result: CaptureResult = {
      kind: toKind,
      title: s.title,
      ...(s.date ? { date: s.date } : {}),
      ...(s.start ? { start: s.start } : {}),
      ...(toKind === "note" ? { notes: s.title } : {}),
    };
    const { id } = await applyCapture(result, deps, deps.categories, deps.today, madeBy("paste"));
    if (!id) return null;
    next = { ...s, id, kind: toKind };
  }
  try {
    await undoSaved(s, deps);
  } catch (e) {
    // The target landed but the original would not go. Take the copy back
    // so the person is not left with two, then let the caller's guard say
    // "couldn't save" about the one thing that is still there.
    try { await undoSaved(next, deps); } catch { /* the original still stands; the receipt keeps tracking it */ }
    throw e;
  }
  recordCapture({ id: next.id, kind: next.kind, title: next.title, ts: Date.now() });
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

// A fact's bucket, changed on the receipt (S4-Q22): selfFact.ts's own words
// are "the category is a guess, and it says so... the receipt renders the
// category with chips to change it, same as every other capture" -- true of
// every other capture and, until this, not of a fact. Returns false rather
// than throwing when the target bucket is already at its cap, since that is
// a real, expected outcome the caller has to say something honest about,
// not a write failure.
export async function recategorizeFact(
  s: SavedEntity,
  category: StrandCategory,
  deps: Pick<PasteDeps, "strands">,
): Promise<boolean> {
  if (!deps.strands) return false;
  const hit = (await deps.strands.list()).find((x) => x.id === s.id);
  if (!hit) return false;
  return deps.strands.recategorize(hit, category);
}
