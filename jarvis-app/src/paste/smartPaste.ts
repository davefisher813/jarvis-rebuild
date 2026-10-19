// Smart Paste, the pipeline (addendum item 1). Deterministic first, AI
// fallback only for what the rules could not read confidently (and only when
// AI Control allows it; the pin is pasteFallback), honest note fallback when
// the AI cannot make sense of it either. Saves INSTANTLY: no preview gate,
// no confirm; correction happens after the fact via refile chips and undo
// (locked principle 1, minimum taps).

import type { AIService } from "../ai/AIService";
import { captureSystemPrompt, parseCapture, applyCapture, billRecurrenceOf, CAPTURE_SCHEMA, type CaptureResult } from "../ai/capture";
import type { AIContext } from "../ai/context";
import type { TasksService } from "../tasks/TasksService";
import type { ScheduleService } from "../schedule/ScheduleService";
import type { NotesService } from "../notes/NotesService";
import type { Category } from "../categories/types";
import { madeBy, withInferred, type Source } from "../shared/provenance";
import { flagOn } from "../substrate/flags";
import { parsePaste, titleCase, type ParsedEntity } from "./deterministic";
import { selfFact } from "./selfFact";
import { readPrefix } from "./prefixes";
import { personReceipt } from "./personLine";
import type { DecisionService } from "../decisions/DecisionService";
import type { PeopleService } from "../people/PeopleService";
import type { PersonData } from "../people/types";
import { markPasteSeen, recordCapture } from "./captureLog";
import { aliasTrigger } from "../rules/triggers";
import type { LearnedRule, LearnedRulesService } from "../rules/LearnedRulesService";
import type { StrandsService } from "../brain/strands/StrandsService";
import type { StrandCategory } from "../brain/strands/types";
import type { LedgerService } from "../money/ledger/LedgerService";
import type { TrackerService } from "../money/TrackerService";

export interface SavedEntity {
  id: string;
  // "fact" lands in the Brain (a told-rank strand), not on a list. See
  // selfFact.ts and the Quick Add block in smartPasteSave below.
  // UP-MIND-08 (2026-09-05): "decision" lands in the Decisions log and
  // "person" updates a contact's card. Both are records, not list rows, and
  // both are reversible from the same receipt as everything else here.
  // "bill" (Money ledger): a line that read as a bill is filed in Money, and
  // its receipt and Undo are the ledger's, never a task's.
  kind: "task" | "event" | "note" | "fact" | "decision" | "person" | "bill" | "expense";
  title: string;
  date?: string;
  start?: string;
  category?: string;
  // Fact only: the strand category it was filed under.
  factCategory?: StrandCategory;
  // C-49: the kind the Remember prefix chose, and whether Never/Always made
  // it a rule. Both show on the receipt as facts.
  factType?: import("../brain/strands/types").StrandType;
  rule?: boolean;
  // UP-CORE-01 (2026-09-05): what else the capture read, so the receipt can
  // show it ("Reminder · 9:00 PM · Daily") and the person can flip it there.
  recurrence?: import("../notes/types").Recurrence;
  reminder?: { time: string; days?: number[] };
  bill?: { amount: number };
  // "expense": a payment already made, filed in Money's tracker; Undo removes it.
  expense?: { amountCents: number; merchant: string };
  personId?: string;
  // More than one contact answered to the line, so nobody was filed and the
  // receipt asks (the Uncertainty Protocol).
  personChoices?: string[];
  projectId?: string;
  // Phase 0 D3 (2026-10-10): the fields a rule filled on this entity
  // (ParsedEntity.inferred), kept so a refile can stamp the copy with only
  // the guesses it still carries. Absent when nothing was guessed.
  inferred?: string[];
  // Person only: the card exactly as it was before this sentence touched it,
  // so Undo restores rather than deletes. Absent when the card was created.
  priorPerson?: PersonData;
  // Person only (2026-09-11): the fields this sentence wrote. update() merges,
  // so restoring priorPerson alone left a field the card never had.
  personKeys?: (keyof PersonData)[];
  // The line exactly as pasted. Both halves of the learned-rules loop derive
  // their trigger from THIS and never from title, so the correction that
  // teaches a rule and the lookup that applies it key on the same string.
  // They did not, briefly: title has been through titleCase, and running the
  // proper-noun heuristic over it made the trigger the whole title.
  raw?: string;
}

export interface PasteDeps {
  // Where a bill goes. Optional like every lane: absent, a bill is refused out
  // loud (onBillNote) and is never made a task instead.
  ledger?: Pick<LedgerService, "addBill" | "removeBill">;
  // Called when a line read as a bill and nothing was filed: already in Money,
  // what is missing, or that Money is unavailable. Same seam as onFactRefused.
  onBillNote?: (message: string) => void;
  // Where a payment already made goes (the tracker). Absent, an expense is
  // refused out loud through onBillNote and is never made a task instead.
  tracker?: Pick<TrackerService, "saveTx" | "load" | "removeTx">;
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
  // Phase 0 D11: a contact's aliases ride along, so "Mom" matches Linda.
  people?: { id: string; name: string; aliases?: string[] }[];
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
    ...(e.expense ? { expense: e.expense } : {}),
    ...(e.personId ? { personId: e.personId } : {}),
    ...(e.projectId ? { projectId: e.projectId } : {}),
    // The Logging Standard, rule 3 (2026-10-17): the length and the area the
    // words named ride through to the writer (applyCapture).
    ...(e.estimateMin ? { estimateMin: e.estimateMin } : {}),
    ...(e.end ? { end: e.end } : {}),
    ...(e.category ? { category: e.category } : {}),
  };
}

// THE REFUSED VERSUS FAILED SPLIT (Phase 0 D11, PHASE0-DESIGN.md, 2026-10-10).
//
// This used to answer null for every miss alike, and the caller read null
// plus `ai.available` as "the model read it and could not", so an
// unconfident line became a note with no personId whenever the backend was
// configured, which in production it always is (AIService.ts:54). With AI
// off in Settings or in airplane mode, "Need to follow up with Mike about
// summer roster" lost Mike. The three answers are now three words:
//
//   refused     no model answer exists: AI is off in this build, the call
//               was refused before any request left (the AI Control gate, the
//               admin switch, the budget; AIService.complete throws), the
//               backend could not be reached (fetch threw), or it answered
//               non 2xx (complete throws on !res.ok, AIService.ts:121-137).
//               The deterministic reading was never contradicted.
//   unreadable  a 2xx answer that parseCapture cannot read. The model had
//               its say and said nothing usable: the honest note.
//   parsed      the model's reading, Title Cased like every created title.
type AiAnswer = { kind: "refused" } | { kind: "unreadable" } | { kind: "parsed"; result: CaptureResult };

async function aiImprove(line: string, deps: PasteDeps): Promise<AiAnswer> {
  if (!deps.ai.available) return { kind: "refused" };
  let raw: string;
  try {
    const ctx = await deps.gather();
    raw = await deps.ai.complete(
      [{ role: "user", content: line }],
      captureSystemPrompt(ctx, deps.today),
      { kind: "paste", pin: "pasteFallback", schema: CAPTURE_SCHEMA },
    );
  } catch {
    return { kind: "refused" };
  }
  // The model answered; whatever cannot be read is unreadable, never a throw
  // out of saveEntities (review finding 12: a non string answer used to throw
  // at raw.replace once the parse moved outside the try).
  try {
    const parsed = parseCapture(raw);
    if (!parsed) return { kind: "unreadable" };
    // Created titles get the convention; the model does not get to invent
    // casing any more than the heuristics do.
    parsed.title = titleCase(parsed.title);
    return { kind: "parsed", result: parsed };
  } catch {
    return { kind: "unreadable" };
  }
}

// THE RULE'S LINKS SURVIVE THE MODEL (Phase 0.5, PHASE05-DESIGN.md). Behind
// memory_v1. The model may change the kind and the words; it never had the
// person or project ids (CAPTURE_SCHEMA leaves them out on purpose), so any id
// it sends is dropped and the deterministic match is put back. A note keeps
// the line as typed (the Smart Paste law) and carries the person as a
// connection; a task whose new title lost any of the typed words keeps the
// line in its Notes, so it is found by those words later. An event carries
// neither: an event write has no person or project field today.
// `inferred` names the rule fields that landed, in the leaf the database reads
// (0060: personId for a task, targetId for a note connection).
function keepRuleLinks(r: CaptureResult, e: ParsedEntity): { result: CaptureResult; inferred: string[] } {
  const out: CaptureResult = { ...r };
  delete out.personId;
  delete out.projectId;
  const inferred: string[] = [];
  if (out.kind === "task") {
    if (e.personId) { out.personId = e.personId; inferred.push("personId"); }
    if (e.projectId) { out.projectId = e.projectId; inferred.push("projectId"); }
    if (keepsEveryWord(out.title, e.raw)) delete out.notes;
    else out.notes = e.raw;
  } else if (out.kind === "note") {
    if (e.personId) { out.personId = e.personId; inferred.push("targetId"); }
    out.notes = e.body ?? e.raw;
  }
  return { result: out, inferred };
}

// Every word of the line (letters and digits, any case) is still in the title.
function keepsEveryWord(title: string, raw: string): boolean {
  const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const have = new Set(words(title));
  return words(raw).every((w) => have.has(w));
}

// The paste stamp. Behind memory_v1 it names the fields a rule guessed
// (Source.inferred, D3); flag off it is madeBy("paste") byte for byte, which
// about 25 exact data assertions pin. `fields` is empty whenever the reading
// that landed is not the rule's own (the model's answer, a refile that
// dropped the guessed field), because the stamp is a fact about THIS row.
function pasteStamp(fields: readonly string[]): Source {
  const stamp = madeBy("paste");
  return flagOn("memory_v1") ? withInferred(stamp, fields) : stamp;
}

// Save a paste. Returns what was created, in order, for the receipt, the
// refile chips, and undo.
//
// 2026-09-11: `saved` is filled as each entity lands, so a caller whose save
// throws on the second line still holds the first (receipt, Undo), and the
// paste is marked seen either way so a retry is flagged, not duplicated.
export async function smartPasteSave(text: string, deps: PasteDeps, saved: SavedEntity[] = []): Promise<SavedEntity[]> {
  try {
    return await saveEntities(text, deps, saved);
  } finally {
    if (saved.length) markPasteSeen(text);
  }
}

async function saveEntities(text: string, deps: PasteDeps, saved: SavedEntity[]): Promise<SavedEntity[]> {
  // C-49 (Astra, 2026-09-12): a stated destination beats a guessed one.
  // "Remember ...", "Never ..." / "Always ...", "Decision: ..." and
  // "... instead of ..." say where the line goes; each lane is closed when
  // its store is absent, and the line then falls through to the ordinary
  // reads, exactly as every other lane here.
  const pre = readPrefix(text);
  if (pre && pre.kind === "remember" && deps.strands) {
    const id = await deps.strands.add(pre.text, pre.category, deps.today, "influence", pre.type);
    if (id) {
      const s: SavedEntity = { id, kind: "fact", title: pre.text, factCategory: pre.category, factType: pre.type, raw: text.trim() };
      saved.push(s);
      recordCapture({ id, kind: "fact", title: s.title, ts: Date.now() });
      return saved;
    }
    deps.onFactRefused?.(pre.text);
    return saved;
  }
  if (pre && pre.kind === "rule" && deps.strands) {
    const id = await deps.strands.add(pre.text, pre.category, deps.today, "rule");
    if (id) {
      const s: SavedEntity = { id, kind: "fact", title: pre.text, factCategory: pre.category, rule: true, raw: text.trim() };
      saved.push(s);
      recordCapture({ id, kind: "fact", title: s.title, ts: Date.now() });
      return saved;
    }
    deps.onFactRefused?.(pre.text);
    return saved;
  }
  if (pre && pre.kind === "decision" && deps.decisions) {
    const id = await deps.decisions.create({ decision: pre.decision, ...(pre.ruledOut ? { ruledOut: pre.ruledOut } : {}), source: { kind: "manual", at: new Date().toISOString() } });
    if (id) {
      const s: SavedEntity = { id, kind: "decision", title: pre.decision, raw: text.trim() };
      saved.push(s);
      recordCapture({ id, kind: "decision", title: s.title, ts: Date.now() });
      return saved;
    }
  }
  const loop = flagOn("memory_v1");
  const { entities } = parsePaste(text, deps.today, {
    people: deps.people, projects: deps.projects,
    // The areas a #tag can name (rule 3, 2026-10-17).
    categories: deps.categories.map((c) => ({ id: c.id, name: c.data.name })),
    ...(loop ? { followUp: true } : {}),
  });
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
        const before = hits[0];
        // 2026-09-11: a note is ADDED to the card, never swapped in: "Mike
        // works at Acme" used to wipe "Allergic to nuts; kids Ava, Leo".
        const priorNotes = before?.data.notes ?? "";
        const notes = !priorNotes ? line.value
          : priorNotes.split("\n").some((l) => l.trim() === line.value) ? priorNotes
            : `${priorNotes}\n${line.value}`;
        const patch = line.field === "relationship" ? { relationship: line.value }
          : line.field === "phone" ? { phone: line.value }
            : line.field === "email" ? { email: line.value }
              : { notes };
        const id = before
          ? (await deps.peopleSvc.update(before.id, patch) ? before.id : null)
          : await deps.peopleSvc.create({ name: line.name, group: "contacts", ...patch });
        if (id) {
          const s: SavedEntity = {
            id, kind: "person", title: personReceipt(line), raw: e.raw,
            ...(before ? { priorPerson: before.data, personKeys: Object.keys(patch) as (keyof PersonData)[] } : {}),
          };
          saved.push(s);
          recordCapture({ id, kind: "person", title: s.title, ts: Date.now() });
          continue;
        }
      }
    }
    let result: CaptureResult;
    // Whether the reading that lands is the deterministic layer's own, so
    // its inferred fields are facts about the row (pasteStamp above).
    let ruleRead = true;
    // Phase 0.5: the rule fields that survived onto a reading that is not
    // the rule's own (keepRuleLinks), so the stamp still names them.
    let kept: string[] = [];
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
      const answer = await aiImprove(e.body ?? e.raw, deps);
      // Behind memory_v1 (D11): only a model that answered and could not be
      // read makes the note; a refused or unreachable AI leaves the
      // deterministic reading standing, personId and all. Flag off, today's
      // branch byte for byte: any miss with a configured backend is the note.
      const noteInstead = flagOn("memory_v1") ? answer.kind === "unreadable" : answer.kind !== "parsed" && deps.ai.available;
      if (answer.kind === "parsed") {
        result = answer.result;
        ruleRead = false;
        // Phase 0.5: the model reads the kind and the words; the rule's
        // person and project match is not its to drop.
        if (loop) ({ result, inferred: kept } = keepRuleLinks(result, e));
      } else if (noteInstead) {
        // The AI ran and still could not read it: honest note fallback,
        // paste kept verbatim. Never a guessed schedule.
        result = { kind: "note", title: e.title, notes: e.body ?? e.title };
        ruleRead = false;
        if (loop) ({ result, inferred: kept } = keepRuleLinks(result, e));
      } else {
        // No model answer exists: the deterministic guess stands (a short
        // text saved as a task is the cheapest honest read, and it is
        // reversible with one chip).
        result = toCaptureResult(e, e.kind);
      }
    }
    // An area he TYPED (#Work) is stated, so it stands over a learned rule
    // and over whatever the model answered (rule 3, 2026-10-17).
    if (e.category) result = { ...result, category: e.category };
    else result = await categoryFromRule(result, e.raw, deps);
    const billFor = [
      deps.people?.find((p) => p.id === result.personId)?.name,
      deps.projects?.find((p) => p.id === result.projectId)?.title,
    ].filter(Boolean).join(", ");
    const inferred = ruleRead ? e.inferred : kept;
    const personName = deps.people?.find((p) => p.id === result.personId)?.name;
    const applied = await applyCapture(result, deps, deps.categories, deps.today, pasteStamp(inferred), billFor,
      loop ? { ...(personName ? { personName } : {}), ...(result.kind === "task" && result.notes ? { taskNotes: result.notes } : {}) } : undefined);
    const { id } = applied;
    if (applied.note) deps.onBillNote?.(applied.note);
    if (id) {
      const isBill = applied.kind === "bill";
      const s: SavedEntity = {
        id,
        kind: isBill ? "bill" : applied.kind === "expense" ? "expense" : result.kind,
        title: result.title,
        ...(result.date ? { date: result.date } : {}),
        ...(result.start ? { start: result.start } : {}),
        ...(result.category ? { category: result.category } : {}),
        // UP-CORE-01: the extra reads, for the receipt. personChoices comes
        // off the parse rather than the result: nobody was filed, which is
        // the whole point of it reaching the receipt.
        // A bill's receipt shows the repeat only if the ledger kept it.
        ...(isBill ? (billRecurrenceOf(result.recurrence) ? { recurrence: result.recurrence! } : {}) : result.recurrence ? { recurrence: result.recurrence } : {}),
        ...(result.reminder ? { reminder: result.reminder } : {}),
        ...(result.bill ? { bill: result.bill } : {}),
        ...(result.expense ? { expense: result.expense } : {}),
        ...(result.personId ? { personId: result.personId } : {}),
        ...(e.personChoices ? { personChoices: e.personChoices } : {}),
        ...(result.projectId ? { projectId: result.projectId } : {}),
        ...(inferred.length ? { inferred } : {}),
        raw: e.raw,
      };
      saved.push(s);
      // Recent Captures opens a task, event, note or fact; a bill is opened in
      // Money, which that strip has no door to, so it is not listed there.
      if (s.kind !== "bill" && s.kind !== "expense") recordCapture({ id, kind: s.kind, title: s.title, ts: Date.now() });
    }
  }
  return saved;
}

// Undo one created entity: the record disappears entirely.
export async function undoSaved(
  s: SavedEntity,
  deps: Pick<PasteDeps, "tasks" | "schedule" | "notes" | "strands" | "decisions" | "peopleSvc" | "ledger" | "tracker">,
): Promise<void> {
  // A payment filed in the tracker is deleted from the tracker.
  if (s.kind === "expense") {
    await deps.tracker?.removeTx(s.id);
    return;
  }
  // A bill filed in Money comes back out of Money (never through the task door).
  if (s.kind === "bill") {
    await deps.ledger?.removeBill(s.id);
    return;
  }
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
    if (s.priorPerson) {
      // 2026-09-11: update() merges, so a field the card did not have is
      // cleared explicitly (undefined is the store's "remove", patch.ts).
      const prior = s.priorPerson;
      const cleared = Object.fromEntries((s.personKeys ?? []).filter((k) => prior[k] === undefined).map((k) => [k, undefined]));
      await deps.peopleSvc.update(s.id, { ...prior, ...cleared });
    } else await deps.peopleSvc.remove(s.id);
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
  // A bill is Money's and never becomes a task, an event or a note by a chip,
  // and nothing is refiled INTO Money from here (ledger hard rule 1).
  if (toKind === "bill" || s.kind === "bill" || toKind === "expense" || s.kind === "expense") return null;
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
    // 2026-09-11: a person capture's title is the receipt ("Saved Sarah's
    // number") and the card edit is undone below, so the line as pasted is
    // what has to land, or the number itself is lost.
    const text = s.kind === "person" ? (s.raw ?? s.title) : s.title;
    // Phase 0.5 (behind memory_v1): the person rides a refile between a task
    // and a note (a note holds it as a connection), and the project rides to
    // a task. An event holds neither, as before.
    const loop = flagOn("memory_v1");
    // A note holds the person only as a named connection, so a person the
    // list no longer has is not carried onto a note.
    const personName = loop && s.personId ? deps.people?.find((p) => p.id === s.personId)?.name : undefined;
    const person = loop && s.personId && (toKind === "task" || (toKind === "note" && personName)) ? s.personId : undefined;
    const project = loop && s.projectId && toKind === "task" ? s.projectId : undefined;
    // The line as typed is the body only for a record that line made; a
    // fact's or a decision's raw carries its prefix word.
    const typed = s.kind === "task" || s.kind === "event" || s.kind === "note" ? (s.raw ?? text) : text;
    const result: CaptureResult = {
      kind: toKind,
      title: s.kind === "person" ? titleCase(text) : text,
      ...(s.date ? { date: s.date } : {}),
      ...(s.start ? { start: s.start } : {}),
      ...(toKind === "note" ? { notes: loop ? typed : text } : {}),
      ...(person ? { personId: person } : {}),
      ...(project ? { projectId: project } : {}),
    };
    // The copy keeps only the guesses it still carries: flag off a refile
    // drops the person and project, and keeps the date, so "date" survives and
    // "personId" does not. Flag off, pasteStamp is madeBy("paste") as before.
    // A person guessed onto a task is a connection's targetId on a note, and
    // back again (the leaf 0060 reads).
    const leaf = (f: string) => (toKind === "note" && f === "personId" ? "targetId" : toKind === "task" && f === "targetId" ? "personId" : f);
    const kept = (s.inferred ?? []).map(leaf).filter((f) => f in result || (f === "targetId" && !!person));
    const { id } = await applyCapture(result, deps, deps.categories, deps.today, pasteStamp(kept), undefined,
      person && personName ? { personName } : undefined);
    if (!id) return null;
    next = { ...s, id, kind: toKind, title: result.title, ...(kept.length ? { inferred: kept } : {}) };
    if (!kept.length) delete next.inferred;
    if (loop && !person) delete next.personId;
    if (loop && !project) delete next.projectId;
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
  if (next.kind !== "bill" && next.kind !== "expense") recordCapture({ id: next.id, kind: next.kind, title: next.title, ts: Date.now() });
  return next;
}

// Refile to another category, in place.
export async function recategorizeSaved(
  s: SavedEntity,
  categoryId: string,
  deps: Pick<PasteDeps, "tasks" | "schedule" | "notes">,
): Promise<void> {
  if (s.kind === "bill" || s.kind === "expense") return; // Money's records have no area
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
