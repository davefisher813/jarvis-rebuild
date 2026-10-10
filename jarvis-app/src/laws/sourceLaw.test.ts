// LAW: EVERY KIND OF ROW SAYS, IN ONE PLACE, HOW IT ANSWERS "WHY DOES JARVIS KNOW THIS?".
//
// The data-model audit (2026-10-05) and the Phase 0 gap matrix (2026-10-10,
// section 2) walked every one of the 45 kinds in ALL_ENTITY_TYPES and found
// five different answers: four kinds require a Source stamp, eight carry one
// when a machine made the row, three keep evidence ids instead of a stamp,
// fifteen carry only the moment they happened, and fifteen carry nothing at
// all and need Dave's ruling before a law may ask anything of them. None of
// that was written down anywhere the code could read it, so a `source?:`
// quietly added to ProjectData would have made Projects answer "typed" for
// every hand made row with nobody deciding that it should.
//
// This law pins the five rosters (PHASE0-DESIGN.md D9) as an exact map over
// ALL_ENTITY_TYPES and then reads the Data interfaces themselves: a required
// kind declares `source:`, an optional kind `source?:`, and every other kind
// declares no `source` at all. The matrix's five rosters union to 43; the
// design adds health_med_def and health_age_rule_shown to NO_SOURCE_TODAY
// (both in the matrix's "not at all" row and missing from its line 52).
// Moving a kind between rosters is a decision, made here, with its reason.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_ENTITY_TYPES } from "../backup/entityRegistry";

const SRC = join(__dirname, "..");

// A Source stamp is required: the interface declares `source:`.
const SOURCE_REQUIRED: Record<string, string> = {
  money_bill: "BillSource is manual, camera or email; LedgerService refuses a bill without one (money/ledger/types.ts)",
  money_receipt: "ReceiptSource, the same three words; history[0] is 'created' and names who",
  strand: "StrandSource says which derivation or hand wrote the strand; the Brain's honesty rests on it",
  brain_memory: "BrainMemorySource is drawn as 'Filed From X' in the sheet eyebrow (brain/manual/MemorySheet.tsx)",
};

// A Source stamp is carried when a machine made the row: `source?:`.
const SOURCE_OPTIONAL: Record<string, string> = {
  task: "shared/provenance Source when a paste, note, email, chat, file, plan or health offer made it; a hand typed task carries none (provenance.ts:4-6)",
  event: "Source when pasted, planned or captured from mail; Google and booking imports carry gcalId or bookingId and earn a stamp behind memory_v1",
  note: "Source when pasted, captured or made for an event; a hand written note carries none",
  workout: "Source when Apple Health or a gym import made it; a logged session carries none",
  money_tx: "TxSource and history are optional: the 31 pre ledger rows carry neither",
  decision_record: "DecisionSource {kind, entityId?, at}; the Decisions sheet path passes none",
  person: "an enum (email, calendar, event, import, manual) with no ref and no when; sourceUid marks a vCard import",
  waiting: "madeBy('email', threadId) from the one adapter that creates one",
};

// No stamp: the row keeps evidence ids and the chain runs through them.
const EVIDENCE_INSTEAD: Record<string, string> = {
  exploration_note: "evidenceIds[] (source_evidence rows) and proposalId; empty means 'Entered by you'",
  learned_rule: "evidence[] holds the pair of corrections the rule was learned from",
  chat_message: "provenance.refs names the rows an answer was built from",
};

// Only the moment it happened: the health loggers and the rows that are a
// date by nature. Nothing to say about who, because the person did it.
const WHEN_ONLY: Record<string, string> = {
  // The ten health loggers (health/types.ts): each extends QueuedLog and
  // carries the tap's own time and nothing else about where it came from.
  health_lights_out: "a health logger: the tap's time, queued on the phone",
  health_ate_before: "a health logger: the tap's time and the event it answers",
  health_took_it: "a health logger: the tap's time and the med it answers",
  health_call_it: "a health logger: the tap's time and the event it answers",
  health_point_at_it: "a health logger: the tap's time and the body part",
  health_meal: "a health logger: the meal's time",
  health_checkin: "a health logger: the check in's time",
  health_med_refill: "a health logger: the refill's time",
  health_bag_check: "a health logger: the check's time and the event it answers",
  health_locker_doc: "a health logger: the document's time",
  health_consent: "grantedAt per grant; consent is the person's own act by definition",
  metric_def: "createdAt; a metric is defined by hand, never derived",
  metric_log: "the log's date; Apple Health In stamps apple_health on the workout, not the metric",
  user_file: "addedAt; the file is its own evidence",
  month_seal: "the month it seals; written by the review, read by nothing else",
};

// Nothing today. Each needs Dave's ruling before a law may require anything.
const NO_SOURCE_TODAY: Record<string, string> = {
  account: "Dave's ruling pending; account and money_account are two homes for one thing (AUDIT D5)",
  money_account: "Dave's ruling pending",
  money_budget: "Dave's ruling pending",
  money_sub: "Dave's ruling pending",
  project: "Dave's ruling pending; goalId and category only, closedOn on the transition to done",
  goal: "Dave's ruling pending",
  life_area: "Dave's ruling pending",
  category: "Dave's ruling pending; a classification, not a record of anything that happened",
  program: "Dave's ruling pending; an upload writes it, and the upload's origin is not kept",
  profile: "Dave's ruling pending; one row per person, edited in place",
  routine: "Dave's ruling pending; one row per person, edited in place",
  brain_doc: "Dave's ruling pending",
  health_trusted_adult: "Dave's ruling pending; personId is the link, not the source",
  health_med_def: "Dave's ruling pending (added by PHASE0-DESIGN.md D9; the matrix's line 52 left it out)",
  health_age_rule_shown: "Dave's ruling pending (added by PHASE0-DESIGN.md D9; the matrix's line 52 left it out)",
};

const ROSTERS = { SOURCE_REQUIRED, SOURCE_OPTIONAL, EVIDENCE_INSTEAD, WHEN_ONLY, NO_SOURCE_TODAY };

// No registry maps a kind to its Data interface, so this law carries its own.
// `file · Interface`, the file relative to src/.
const INTERFACE_OF: Record<string, string> = {
  account: "money/types.ts · AccountData",
  money_account: "money/tracker.ts · TrackerAccountData",
  money_tx: "money/tracker.ts · TrackerTxData",
  money_budget: "money/tracker.ts · TrackerBudgetData",
  money_sub: "money/tracker.ts · TrackerSubData",
  money_bill: "money/ledger/types.ts · BillData",
  money_receipt: "money/ledger/types.ts · ReceiptData",
  brain_memory: "ai/brainMemory.ts · BrainMemoryData",
  health_checkin: "health/types.ts · CheckInData",
  health_meal: "health/types.ts · MealData",
  health_med_def: "health/types.ts · MedDefData",
  project: "projects/types.ts · ProjectData",
  profile: "profile/types.ts · ProfileData",
  routine: "routine/types.ts · RoutineData",
  month_seal: "review/seal.ts · MonthSealData",
  note: "notes/types.ts · NoteData",
  task: "notes/types.ts · TaskData",
  category: "categories/types.ts · CategoryData",
  metric_def: "gym/metrics.ts · MetricDefData",
  metric_log: "gym/metrics.ts · MetricLogData",
  program: "gym/types.ts · ProgramData",
  workout: "gym/types.ts · WorkoutData",
  user_file: "files/types.ts · FileData",
  chat_message: "chat/types.ts · ChatMessageData",
  learned_rule: "rules/types.ts · LearnedRuleData",
  health_consent: "health/types.ts · ConsentGrantsData",
  health_lights_out: "health/types.ts · LightsOutData",
  health_ate_before: "health/types.ts · AteBeforeData",
  health_took_it: "health/types.ts · TookItData",
  health_call_it: "health/types.ts · CallItData",
  health_point_at_it: "health/types.ts · PointAtItData",
  health_med_refill: "health/types.ts · MedRefillData",
  health_bag_check: "health/types.ts · BagCheckData",
  health_locker_doc: "health/types.ts · LockerDocData",
  health_trusted_adult: "health/types.ts · TrustedAdultData",
  health_age_rule_shown: "health/types.ts · AgeRuleShownData",
  event: "schedule/types.ts · EventData",
  strand: "brain/strands/types.ts · StrandData",
  brain_doc: "brain/docs/types.ts · BrainDocData",
  decision_record: "decisions/types.ts · DecisionRecordData",
  life_area: "life/types.ts · AreaData",
  goal: "life/types.ts · GoalData",
  person: "people/types.ts · PersonData",
  waiting: "substrate/waiting/types.ts · WaitingData",
  exploration_note: "substrate/exploration/types.ts · ExplorationNoteData",
};

/** The body of `export interface Name ... { ... }`, with any same file `extends` parent appended. */
function bodyOf(file: string, name: string, depth = 0): string {
  const src = readFileSync(join(SRC, file), "utf8");
  const head = new RegExp(`export interface ${name}\\b([^{]*)\\{`).exec(src);
  if (!head) throw new Error(`${file}: no export interface ${name}`);
  let i = head.index + head[0].length, d = 1;
  const start = i;
  for (; i < src.length && d > 0; i++) { if (src[i] === "{") d++; else if (src[i] === "}") d--; }
  let body = src.slice(start, i - 1);
  const parent = /extends\s+([A-Za-z_]+)/.exec(head[1]!)?.[1];
  if (parent && depth < 3 && new RegExp(`export interface ${parent}\\b`).test(src)) body += "\n" + bodyOf(file, parent, depth + 1);
  return body;
}

/** "required", "optional" or "none": how the interface declares `source`. */
function sourceField(body: string): "required" | "optional" | "none" {
  // Comments can say "source" all they like; only a field declaration counts.
  const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const m = /^\s*(?:readonly\s+)?source(\??)\s*:/m.exec(code);
  if (!m) return "none";
  return m[1] === "?" ? "optional" : "required";
}

describe("LAW: every kind says how it answers 'why does JARVIS know this?'", () => {
  it("the five rosters are an exact map over ALL_ENTITY_TYPES, with no kind in two", () => {
    const seen = new Map<string, string>();
    for (const [name, roster] of Object.entries(ROSTERS)) {
      for (const k of Object.keys(roster)) {
        expect(seen.get(k), `${k} is in ${seen.get(k)} and ${name}`).toBeUndefined();
        seen.set(k, name);
      }
    }
    expect([...seen.keys()].sort(), "a kind in the registry with no roster, or a rostered kind the registry does not know")
      .toEqual([...ALL_ENTITY_TYPES].sort());
    expect(ALL_ENTITY_TYPES.length).toBe(45);
  });

  it("the rosters are the sizes the design names", () => {
    expect(Object.keys(SOURCE_REQUIRED).length).toBe(4);
    expect(Object.keys(SOURCE_OPTIONAL).length).toBe(8);
    expect(Object.keys(EVIDENCE_INSTEAD).length).toBe(3);
    expect(Object.keys(WHEN_ONLY).length).toBe(15);
    expect(Object.keys(NO_SOURCE_TODAY).length).toBe(15);
  });

  it("every kind maps to a Data interface that exists", () => {
    expect(Object.keys(INTERFACE_OF).sort()).toEqual([...ALL_ENTITY_TYPES].sort());
    for (const [kind, at] of Object.entries(INTERFACE_OF)) {
      const [file, name] = at.split(" · ") as [string, string];
      expect(() => bodyOf(file, name), kind).not.toThrow();
    }
  });

  it("a required kind declares source:, an optional kind source?:, every other kind none", () => {
    const wrong: string[] = [];
    for (const kind of ALL_ENTITY_TYPES) {
      const [file, name] = INTERFACE_OF[kind]!.split(" · ") as [string, string];
      const has = sourceField(bodyOf(file, name));
      const want = kind in SOURCE_REQUIRED ? "required" : kind in SOURCE_OPTIONAL ? "optional" : "none";
      if (has !== want) wrong.push(`${kind} (${name}): declares source as ${has}, the roster says ${want}`);
    }
    expect(wrong, "a stamp nobody decided on, or a roster that fell behind the interface; move the kind, with its reason").toEqual([]);
  });

  it("the evidence kinds keep the evidence fields the roster names", () => {
    expect(bodyOf("substrate/exploration/types.ts", "ExplorationNoteData")).toMatch(/^\s*evidenceIds\?:/m);
    expect(bodyOf("rules/types.ts", "LearnedRuleData")).toMatch(/^\s*evidence:/m);
    expect(bodyOf("chat/types.ts", "ChatMessageData")).toMatch(/^\s*provenance\?:/m);
  });
});
