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
import { personReceipt } from "./personLine";
import type { DecisionService } from "../decisions/DecisionService";
import type { PeopleService } from "../people/PeopleService";
import type { PersonData } from "../people/types";
import { markPasteSeen, recordCapture } from "./captureLog";
import { aliasTrigger } from "../rules/triggers";
import type { LearnedRule, LearnedRulesService } from "../rules/LearnedRulesService";
import type { StrandsService } from "../brain/strands/StrandsService";
import type { StrandCategory } from "../brain/strands/types";

export interface SavedEntity {
  id: string;
  // "fact" lands in the Brain (a told-rank strand), not on a list. See
  // selfFact.ts and the Quick Add block in smartPasteSave below.
  // UP-MIND-08 (2026-09-05): "decision" lands in the Decisions log and
  // "person" updates a contact's card. Both are records, not list rows, and
  // both are reversible from the same receipt as everything else here.
  kind: "task" | "event" | "note" | "fact" | "decision" | "person";
  title: string;
  date?: string;
  start?: string;
  category?: string;
  // Fact only: the strand category it was filed under.
  factCategory?: StrandCategory;
  // UP-CORE-01 (2026-09-05): what else the capture read, so the receipt can
  // show it ("Reminder · 9:00 PM · Daily") and the person can flip it there.
  recurrence?: import("../notes/types").Recurrence;
  reminder?: { time: string; days?: number[] };
  bill?: { amount: number };
  personId?: string;
  // More than one contact answered to the line, so nobody was filed and the
  // receipt asks (the Uncertainty Protocol).
  personChoices?: string[];
  projectId?: string;
  // Person only: the card exactly as it was before this sentence touched it,
  // so Undo restores rather than deletes. Absent when the card was created.
  priorPerson?: PersonData;
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
  // UP-CORE-01 (2026-09-05): the bounded lists the person and project reads
  // match against. Optional, and absent means those two lanes are simply
  // closed: a capture is never dropped because a list was not passed.
  people?: { id: string; name: string }[];
  projects?: { id: string; title: string }[];
  // Learned rules, optional. Absent means no capture is ever categorised by
  // a rule, which is what every existing caller and every test gets by
  // default: this can only ever change behaviour where it is passed in.
  rules?: Pick<LearnedRulesService, "resolve" | "announceIfFirstUse">;
  // The genome, optional (Quick Add, handoff 5.0). Absent means the fact
  // lane is closed and a self-fact lands the way it does today, as a task:
  // degrading to the old behaviour, never dropping the capture on the floor.
  // Same seam shape as `rules` above.
  strands?: Pick<StrandsService, "add" | "list" | "remove" | "recategorize">;
  // UP-MIND-08 (2026-09-05): the Decisions log and Contacts, both optional
  // on the same seam. Absent means the lane is closed and the line lands as
  // it did before, which is what every existing caller and test gets.
  //
  // Merge (2026-09-06): the CONTACT STORE is `peopleSvc`, because `people`
  // above is already UP-CORE-01's bounded list of names to match against.
  // Two different things, and one of them writes.
  decisions?: Pick<DecisionService, "create" | "remove">;
  peopleSvc?: Pick<PeopleService, "list" | "create" | "update" | "remove">;
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
    // UP-CORE-01 (2026-09-05): the four extra reads ride through. Only ever
    // on the confident path: an unconfident line goes to the model, and what
    // comes back is what gets written.
    ...(e.recurrence ? { recurrence: e.recurrence } : {}),
    ...(e.reminder ? { reminder: e.reminder } : {}),
    ...(e.bill ? { bill: e.bill } : {}),
    ...(e.personId ? { personId: e.personId } : {}),
    ...(e.projectId ? { projectId: e.projectId } : {}),
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
  const { entities } = parsePaste(text, deps.today, { people: deps.people, projects: deps.projects });
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
    // UP-MIND-08: the decision lane. The sentence IS the decision, verbatim,
    // and the why stays empty because inventing a reason is how a decision
    // record stops being evidence. With no decisions store the lane is
    // closed and the line falls through, which is today's behaviour.
    if (e.kind === "decision" && deps.decisions) {
      const id = await deps.decisions.create({ decision: e.title });
      if (id) {
        const s: SavedEntity = { id, kind: "decision", title: e.title, raw: e.raw };
        saved.push(s);
        recordCapture({ id, kind: "decision", title: s.title, ts: Date.now() });
        continue;
      }
    }
    // UP-MIND-08: the person lane. It updates an existing card when exactly
    // one contact answers to the name, and creates one when none does. Two
    // matches is an ambiguity, and this refuses rather than picking: the
    // line falls through to the ordinary reads, where it is one chip from
    // right, which is better than the wrong person's card being edited.
    if (e.kind === "person" && e.person && deps.peopleSvc) {
      const line = e.person;
      const all = await deps.peopleSvc.list().catch(() => []);
      const hits = all.filter((p) => p.data.name.toLowerCase() === line.name.toLowerCase()
        || p.data.name.toLowerCase().startsWith(line.name.toLowerCase() + " "));
      if (hits.length <= 1) {
        const patch = line.field === "relationship" ? { relationship: line.value }
          : line.field === "phone" ? { phone: line.value }
            : line.field === "email" ? { email: line.value }
              : { notes: line.value };
        const before = hits[0];
        const id = before
          ? (await deps.peopleSvc.update(before.id, patch) ? before.id : null)
          : await deps.peopleSvc.create({ name: line.name, group: "contacts", ...patch });
        if (id) {
          const s: SavedEntity = {
            id, kind: "person", title: personReceipt(line), raw: e.raw,
            ...(before ? { priorPerson: before.data } : {}),
          };
          saved.push(s);
          recordCapture({ id, kind: "person", title: s.title, ts: Date.now() });
          continue;
        }
      }
    }
    let result: CaptureResult;
    if (e.kind === "fact") {
      // The lane is closed (no strand store). Read it the way this pipeline
      // read it before Quick Add existed: a short line with no date is a
      // task, reversible with one chip.
      result = { kind: "task", title: titleCase(e.title) };
    } else if (e.kind === "decision" || e.kind === "person") {
      // The lane is closed (no store, or an ambiguous name). Read the line
      // the way this pipeline read it before these lanes existed.
      result = { kind: "task", title: titleCase(e.title) };
    } else if (e.confident) {
      result = toCaptureResult(e, e.kind);
    } else {
      // PLUMB-F-05 (2026-09-05): the model used to be handed e.title, which
      // has already been Title Cased and had its date words cut out, so it was
      // asked to improve "Accounts" when the person wrote "separate 2
      // accounts". It gets the line as pasted; that is the only version of it
      // that still holds every word.
      const improved = await aiImprove(e.body ?? e.raw, deps);
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
        // UP-CORE-01: the extra reads, for the receipt. personChoices comes
        // off the parse rather than the result: nobody was filed, which is
        // the whole point of it reaching the receipt.
        ...(result.recurrence ? { recurrence: result.recurrence } : {}),
        ...(result.reminder ? { reminder: result.reminder } : {}),
        ...(result.bill ? { bill: result.bill } : {}),
        ...(result.personId ? { personId: result.personId } : {}),
        ...(e.personChoices ? { personChoices: e.personChoices } : {}),
        ...(result.projectId ? { projectId: result.projectId } : {}),
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
export async function undoSaved(
  s: SavedEntity,
  deps: Pick<PasteDeps, "tasks" | "schedule" | "notes" | "strands" | "decisions" | "peopleSvc">,
): Promise<void> {
  // UP-MIND-08: a decision record is removed outright. A person's card is
  // PUT BACK to what it held: the card almost always existed before the
  // sentence, and deleting a contact because one field was typed wrong
  // would be the most expensive undo in the app.
  if (s.kind === "decision") {
    await deps.decisions?.remove(s.id);
    return;
  }
  if (s.kind === "person") {
    if (!deps.peopleSvc) return;
    if (s.priorPerson) await deps.peopleSvc.update(s.id, s.priorPerson);
    else await deps.peopleSvc.remove(s.id);
    return;
  }
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
  // UP-MIND-08 (2026-09-05): neither of the two new kinds is a refile
  // TARGET. A decision record needs a decision, a person's card needs a
  // name and a field, and neither can be conjured from a task title; the
  // chips never offer them (QuickCapture's KINDS), and this refuses rather
  // than half-writing one if a future caller asks.
  if (toKind === "decision" || toKind === "person") return null;
  // Refiling one AWAY is the ordinary path: the target is created first and
  // the original removed after (SHELL-F-02's order), which undoSaved
  // already handles for both kinds.
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
