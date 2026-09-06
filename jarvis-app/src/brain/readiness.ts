import { WINDOW_DAYS, type WindowRow } from "./window";
import {
  MIN_COMPLETIONS, MIN_BAND_SHARE, MIN_SLIPS_LEADER, SLIP_LEAD_RATIO, MIN_PLAN_PICKS,
  MIN_PERSON_HANDLED, QUIET_MS,
  completionBand, slipCounts, slipLeader, planOutcomes,
  taskDone, workoutDone, emailHandled, personHandled,
  deriveSlipCategory, derivePlanRate, derivePeopleRhythm, deriveGoneQuiet,
  type DerivePerson,
} from "./derive";
import { correctionStats, derivationMuted } from "./moments";
import {
  MIN_COUNT as MIN_TIMING_SAMPLES, MIN_AVG_ABS_MIN,
  planningPatternObservation, type DurationCorrection,
} from "../today/planningPatterns";
import type { Strand, DerivationKey } from "./strands/types";
import { capAfterNumber } from "../shared/casing";

// WHY IS NOTHING LEARNING (Dave, 2026-09-06: "i dont see any trace of jarvis
// learning anything. theres 1 fact in what jarvis knows about me").
//
// Eight detectors sit behind evidence gates and every one of them fails
// SILENTLY AND IDENTICALLY. A gate that has not been met, a gate met with a
// second condition still open, a detector that talked itself out of the room,
// and a fact JARVIS already knows all render as the same thing on screen:
// nothing. So does an event log that never reached the server, and so does a
// daily pass that never ran.
//
// This module is the instrument, not the fix. It changes no threshold and no
// detector: it reads the SAME window the detectors read, calls the SAME gate
// helpers, and reports what it finds. Every gate here is imported from the
// module that enforces it (brain/derive.ts, today/planningPatterns.ts) rather
// than re-typed, because a panel that misreports a threshold is worse than no
// panel: it would make Dave trust a wrong number.
//
// The strongest thing here is that `ready` is never an opinion. For every
// detector with a second condition, readiness asks the detector itself
// whether it would speak right now, so the panel and the Brain cannot
// disagree about a single row.

/** A detector's answer to "why have you said nothing?". */
export interface Readiness {
  key: DerivationKey;
  /** What it is watching, in Dave's words. */
  label: string;
  /** What the window actually holds. */
  have: number;
  /** The gate. */
  need: number;
  /** What `have` counts: "completions", "pushes in one area", ... */
  unit: string;
  state: ReadinessState;
  /** The second condition, or the reason this row is not about evidence. */
  detail?: string;
}

export type ReadinessState = "known" | "ready" | "close" | "waiting" | "muted";

/** How near the gate a count has to be before "waiting" becomes "close".
 *  A reporting threshold, not a gate: nothing surfaces at this number. */
export const CLOSE_SHARE = 0.6;

const BAND_PCT = Math.round(MIN_BAND_SHARE * 100);
const QUIET_DAYS = Math.round(QUIET_MS / 86400000);

// A window row's local moment. The window carries a local day and an hour
// (never a UTC instant, by the log's own design), so the clock is rebuilt the
// way the rest of the app rebuilds one: local fields into the local Date
// constructor, never a slice of an ISO string.
function rowMs(r: WindowRow): number {
  const [y, m, d] = r.day.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, r.h).getTime();
}

function stateOf(met: boolean, have: number, need: number): ReadinessState {
  if (met) return "ready";
  if (need > 0 && have / need >= CLOSE_SHARE) return "close";
  return "waiting";
}

// The three band detectors are one shape with three sets of rows: 10-plus
// samples AND one 3-hour stretch holding 40 percent of them. The second half
// is very likely why Dave sees nothing, so it is never folded into a bare
// "not yet": the count says the evidence is there and the detail says the
// shape is not.
function bandRow(key: DerivationKey, label: string, unit: string, done: WindowRow[]): Omit<Readiness, "state"> & { met: boolean } {
  const band = completionBand(done);
  const have = done.length;
  const detail = band
    ? `One 3-hour stretch holds ${band.count} of them`
    : have >= MIN_COMPLETIONS
      ? `${have} ${unit}, spread across the day · One 3-hour stretch has to hold ${BAND_PCT} percent`
      : `Needs ${MIN_COMPLETIONS} ${unit} · One 3-hour stretch holding ${BAND_PCT} percent of them`;
  return { key, label, have, need: MIN_COMPLETIONS, unit, detail, met: band !== null };
}

function slipRow(rows: WindowRow[]): Omit<Readiness, "state"> & { met: boolean } {
  const ranked = slipCounts(rows);
  const have = ranked[0]?.n ?? 0;
  const lead = slipLeader(rows);
  const spoken = deriveSlipCategory(rows);
  let detail: string;
  if (spoken) {
    detail = `${have} pushes in one area, clear of every other`;
  } else if (lead) {
    // BRAIN-F-05's other half: the leader is a category id, and an id that no
    // longer resolves to a name gets no derivation, because a sentence about
    // an area nobody can see is not a fact anyone can check.
    detail = "The area in front is one JARVIS can no longer name";
  } else if (have >= MIN_SLIPS_LEADER) {
    detail = `${have} pushes lead · No area is pushed ${SLIP_LEAD_RATIO} times as often as the next`;
  } else {
    detail = `Needs ${MIN_SLIPS_LEADER} pushes in one area, ${SLIP_LEAD_RATIO} times as often as the next`;
  }
  return {
    key: "slip_category", label: "The Area That Slips",
    have, need: MIN_SLIPS_LEADER, unit: "pushes in one area", detail, met: spoken !== null,
  };
}

function planRow(rows: WindowRow[]): Omit<Readiness, "state"> & { met: boolean } {
  const outcomes = planOutcomes(rows);
  const have = outcomes.length;
  const done = outcomes.filter((r) => r.flag === true).length;
  const spoken = derivePlanRate(rows);
  const detail = spoken
    ? `${done} of ${have} picks finished by that night`
    : have >= MIN_PLAN_PICKS
      ? `${done} of ${have} picks finished by that night · The middle is a normal life, not a pattern`
      : `Needs ${MIN_PLAN_PICKS} plan picks resolved, then a rate clearly high or clearly low`;
  return {
    key: "plan_rate", label: "Whether Plans Finish",
    have, need: MIN_PLAN_PICKS, unit: "plan picks resolved", detail, met: spoken !== null,
  };
}

function peopleRow(rows: WindowRow[], people: DerivePerson[]): Omit<Readiness, "state"> & { met: boolean } {
  const byPerson = personHandled(rows);
  let have = 0;      // the best count for somebody with no label yet
  let labelled = 0;  // the best count for somebody already labelled
  for (const p of people) {
    const n = (byPerson.get(p.id) ?? []).length;
    if (p.label?.trim()) labelled = Math.max(labelled, n);
    else have = Math.max(have, n);
  }
  const spoken = derivePeopleRhythm(rows, people);
  let detail: string;
  if (spoken) {
    detail = `${have} handled with one person, and no label on them yet`;
  } else if (people.length === 0) {
    // The log carries person ids and nothing else, on purpose: no names ever
    // leave the device through it. With no Contacts there is nobody to put a
    // name to, whatever the rows say.
    detail = "Nobody in Contacts to put a name to · The log carries ids, so a name comes from a person card";
  } else if (labelled >= MIN_PERSON_HANDLED) {
    detail = "The person you handle most already has a label, which is what this one proposes";
  } else {
    detail = `Needs ${MIN_PERSON_HANDLED} emails handled with one person who has no label yet`;
  }
  return {
    key: "people_rhythm", label: "The Person You Email Most",
    have, need: MIN_PERSON_HANDLED, unit: "emails with one person", detail, met: spoken !== null,
  };
}

// Gone quiet reads no window rows at all, and that is the honest thing to
// report: somebody who has gone quiet has no rows in a 30-day window BY
// DEFINITION. Its evidence is people the user labelled whose last contact is
// known, so that is what the count counts.
function quietRow(people: DerivePerson[], nowMs: number): Omit<Readiness, "state"> & { met: boolean } {
  const candidates = people.filter((p) => p.label?.trim() && typeof p.lastMs === "number" && p.lastMs > 0);
  const spoken = deriveGoneQuiet(people, nowMs);
  const detail = spoken
    ? `One of them has not written in ${QUIET_DAYS} days or more`
    : candidates.length > 0
      ? `Nobody you labelled has been quiet ${QUIET_DAYS} days yet`
      : "Needs somebody you labelled, and a last contact JARVIS knows";
  return {
    key: "gone_quiet", label: "Who Has Gone Quiet",
    have: candidates.length, need: 1, unit: "labelled people with a known last contact",
    detail, met: spoken !== null,
  };
}

// The eighth detector. It lives in today/planningPatterns.ts rather than
// derive.ts, and it reads plan.duration_corrected, which the window already
// pulls (window.ts READ_TYPES). Worth saying plainly on the row: the live
// detector reads this device's own log, so this is the one row where a server
// window can hold more than the detector will see.
function timingRow(rows: WindowRow[], nowMs: number): Omit<Readiness, "state"> & { met: boolean } {
  const corrections: DurationCorrection[] = rows
    .filter((r) => r.type === "plan.duration_corrected" && !!r.category && typeof r.n === "number")
    .map((r) => ({ category: r.category!, deltaMin: r.n!, ts: rowMs(r) }));
  const counts = new Map<string, number>();
  for (const c of corrections) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
  const have = Math.max(0, ...counts.values());
  const spoken = planningPatternObservation(corrections, nowMs);
  const detail = spoken
    ? `${have} corrections in one area, all running the same way`
    : have >= MIN_TIMING_SAMPLES
      ? `${have} corrections in one area · Not all the same way, or under ${MIN_AVG_ABS_MIN} minutes on average · Read from this device's log`
      : `Needs ${MIN_TIMING_SAMPLES} corrections in one area, same way, ${MIN_AVG_ABS_MIN} minutes or more · Read from this device's log`;
  return {
    key: "task_timing", label: "How Long Tasks Take",
    have, need: MIN_TIMING_SAMPLES, unit: "corrections in one area", detail, met: spoken !== null,
  };
}

/**
 * Every detector's answer to "why have you said nothing?", in the order the
 * detectors surface.
 *
 * `known` outranks everything: a met gate that already became a fact is not a
 * failure, it is the system working, and Dave should be able to see that on
 * the same list. `muted` comes next, because a detector the nod test switched
 * off will never speak however much evidence arrives, and that is a different
 * answer from "not yet".
 *
 * Pure. No React, no store, no network, no AI: this reads the window it is
 * handed and nothing else, so it says the same thing offline.
 */
export function readiness(rows: WindowRow[], strands: Strand[], people: DerivePerson[], nowMs: number): Readiness[] {
  const stats = correctionStats(rows);
  const known = new Set<DerivationKey>(
    strands.map((s) => s.data.derivation).filter((d): d is DerivationKey => !!d),
  );
  const built = [
    bandRow("completion_window", "When Tasks Get Done", "completions", taskDone(rows)),
    slipRow(rows),
    planRow(rows),
    bandRow("training_window", "When You Train", "sessions", workoutDone(rows)),
    bandRow("email_window", "When Email Gets Done", "emails handled", emailHandled(rows)),
    peopleRow(rows, people),
    quietRow(people, nowMs),
    timingRow(rows, nowMs),
  ];
  return built.map(({ met, ...r }) => {
    // Every line here leads with a count, so every line goes through the
    // leading-number casing rule, the same way derive.ts's own subs do.
    const detail = capAfterNumber(r.detail ?? "");
    if (known.has(r.key)) {
      return { ...r, state: "known" as const, detail: "JARVIS already knows this one" };
    }
    if (derivationMuted(stats.get(r.key))) {
      return { ...r, state: "muted" as const, detail: "Corrected or deleted twice, so it stopped offering this" };
    }
    return { ...r, detail, state: stateOf(met, r.have, r.need) };
  });
}

/** The window's own facts, for the line above the rows. Kept here so the
 *  panel holds no numbers of its own. */
export const READINESS_WINDOW_DAYS = WINDOW_DAYS;
