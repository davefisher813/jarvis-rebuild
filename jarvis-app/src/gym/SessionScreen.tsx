import { useEffect, useState } from "react";
import { loadCalcFor, loadStyleOf, plateMath, styleSummary, weightLabel, type LoadStyle } from "./equipment";
import type { Exercise, MeasureKind, ProgramDay, SetEntry, Workout  } from "./types";
import { elapsedMs, type LiveSession } from "./liveSession";
import { overBudgetMin, nextLever, projectFinishMs, estimateDaySec, type FitPlan } from "./fit";
import { capAfterNumber, liftTitle, workoutTitle } from "../shared/casing";
import { REST_FLOOR_SEC } from "./pacing";
import { logButtonLabel, plannedEntryAt, entryNoun, formatSet } from "./measures";
import { nextSetEntry } from "./nextSet";
import { newSetId, blankEntry, duplicateEntry, entryFrom } from "./strip";
import { isSessionPR, lastHeader, lastSessionFor } from "./prs";
import { readGymSettings, rackFrom } from "./settings";
import { readHealthSettings } from "../health/settings";
import { rampFor } from "./ramp";
import { suggestFor, type Suggestion } from "./progression";
import { groupLabels, fillerFor, nextInGroup, groupOf, roundRestFor } from "./groups";
import { withLiveGroups } from "./liveGroups";
import { useBarClearance } from "../shared/useBarClearance";
import type { LibraryEntry } from "./library";
import { newExerciseKey } from "./library";
import SetStrip from "./SetStrip";
import RestTimer from "./RestTimer";
import ConditioningFace from "./ConditioningFace";
import CondReceipt from "./CondReceipt";
import { condResultEntry } from "./conditioning";
import LibraryPickSheet from "./LibraryPickSheet";
import PlateSheet from "./PlateSheet";
import LoadSheet from "./LoadSheet";
import ExerciseSheet from "./ExerciseSheet";
import MusicChip from "../music/MusicChip";
import { showToast } from "../shared/toast";
import { monthDay } from "../money/bills";
import { useWakeLock } from "../shared/useWakeLock";
import { HyperfocusLine, useHyperfocusGuard } from "../today/useHyperfocusGuard";

const CHEV = (
  <div className="chev" />
);

// H-52 (Health Push B, 2026-09-12): the time the athlete has actually been in
// the gym, parked time excluded. Its own second tick, so one number does not
// re-render the whole screen once a second; visibilitychange re-reads the
// clock the moment the app is foregrounded, the RestTimer's own lesson.
function ElapsedClock({ live }: { live: LiveSession }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const t = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, []);
  const s = Math.floor(elapsedMs(live, now) / 1000);
  return <span className="fact amber">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</span>;
}

// The in-gym screen. ONE exercise, huge type, readable from a bench, because
// standing there scrolling is the moment self-consciousness eats people. The
// big button carries the real numbers so a set that matched the plan is one
// tap; the set strip below is where a deviation gets corrected, in place,
// after the fact -- the same strip that planned the exercise now logs it.
export default function SessionScreen({
  live,
  exercise,
  dayExercises,
  programDay,
  history,
  library,
  onLog,
  onSetLogged,
  onSkip,
  onMove,
  onSuperset,
  onSwap,
  onSetLoad,
  onAddMidSession,
  onUpdateProgram,
  onAcceptSuggestion,
  onFit,
  onAdjustTime,
  onFinish,
  onBack,
  onPause,
  // UP-ATH-03 (2026-09-06): the Notifications page's rest switch, read once
  // by GymFlow. Off means the rest timer arms nothing, so the switch is a
  // real switch and not a label on a thing that buzzes anyway.
  restNotify = true,
  // H-35 (Health Push C): the PR mark renders only while Celebrations is on.
  celebrations = true,
  // UP-ATH-02 (2026-09-06): "Game Saturday 6 PM" when the program is in
  // season and the athlete has said which category means a game. A fact on
  // the header, stated once. Never a prescription: nothing in this app is
  // allowed to tell somebody to back off before a game.
  gameLine,
}: {
  live: LiveSession;
  exercise: Exercise;
  /** The program day's own exercise list, for A1/A2 pairing and filler
   *  lookups (catalog §4.2). Empty for a custom/swapped/added exercise --
   *  those carry no plan-side pairing. */
  dayExercises: Exercise[];
  history: Workout[];
  library: LibraryEntry[];
  onLog: (s: SetEntry) => void;
  /** UP-ATH-04 (2026-09-06): `at` names the exercise the strip belongs to,
   *  which matters for an Undo taken LATE. Every write here is same-exercise
   *  and the caller's own live index answered for it until the toast made a
   *  gap: tap Log, walk to the pair partner, tap Undo, and the restore landed
   *  on whichever exercise the session had moved to. Omitted means the live
   *  index, exactly as before. */
  onSetLogged: (sets: SetEntry[], at?: number) => void;
  onSkip: () => void;
  onMove: (idx: number) => void;
  /** SUPERSET WHILE LOGGING (Dave, 2026-09-21: "I can't easily create a
   *  superset as I'm logging"). Opens the day's own Group With picker, which
   *  GymFlow already owns -- the live screen reads pairings OFF the program
   *  day, so grouping has to be written there for the pair to exist at all.
   *  Absent for a lift the day does not have, which cannot be paired with
   *  anything (the same reason Add Exercise carries its "also on the day"
   *  switch). */
  onSuperset?: () => void;
  onSwap: (sub: { exerciseKey?: string; name: string; kind: MeasureKind; unit?: string; timeUnit?: string }) => void;
  /** HOW THIS LIFT LOADS, SET FROM IN HERE (2026-09-16, Dave: "I don't even
   *  have the option while I'm logging to select what type of weight system
   *  it is"). The equipment, the reading and the reps axis. Absent leaves the
   *  header chip a fact rather than a door, which is what it was. */
  onSetLoad?: (next: LoadStyle) => void;
  /** The draft, and whether it should also land on the program day. */
  onAddMidSession: (draft: Omit<Exercise, "id">, alsoOnDay: boolean) => void;
  /** Part 3 wave 5 (Dave's 10a): a swapped or added exercise changes this
   *  session only; this is the one explicit way to carry it into the
   *  program. Absent on a planned exercise. */
  onUpdateProgram?: () => void;
  /** D6-A: the athlete accepted a suggestion, so the PROGRAM's own plan for
   *  this exercise moves. The only writer; a suggestion left alone changes
   *  nothing. */
  onAcceptSuggestion?: (s: Suggestion) => void;
  /** The program day this session runs, whole -- warm-up and cool-down
   *  blocks, pairs, every lift's rest target -- for the D5 projection.
   *  Null when the day was deleted mid-session. */
  programDay: ProgramDay | null;
  /** D5-C: the one door for fit-state changes from in here -- a lever
   *  accepted from the catch-up banner, a block checked off, a budget
   *  loosened. GymFlow merges the patch into the live session. */
  onFit: (patch: Partial<LiveSession>) => void;
  /** 2026-09-14 (the reference's Adjust time): a budget chosen mid-session.
   *  Absent, the row is absent. */
  onAdjustTime?: () => void;
  onFinish: () => void;
  onBack: () => void;
  /** H-27 (Health Push B, 2026-09-12): Pause parks the session. Defaults to
   *  Back, which has parked since GYM-F-14. */
  onPause?: () => void;
  restNotify?: boolean;
  celebrations?: boolean;
  gameLine?: string;
}) {
  // S5-Q30 (2026-09-04): "the screen sleeps between sets." This screen stays
  // mounted for the whole session (GymFlow swaps its props, not the
  // component, as the athlete moves between exercises), so holding the lock
  // here -- not only inside ConditioningFace's own clock -- is what actually
  // covers the gaps between sets and during rest, where the old code held
  // nothing awake at all.
  useWakeLock();
  // UP-CORE-06: the next hard commitment, refreshed every minute.
  const guard = useHyperfocusGuard();
  const idx = live.idx;
  const current = live.exercises[idx]!;
  const logged = current.sets;
  const noun = entryNoun(exercise.kind);
  // WHAT THIS THING LOADS WITH, read once. It drives the strip's own steppers
  // now (2026-09-16), not just the header chip and the calculator's door.
  const style = loadStyleOf(exercise);
  const [loadOpen, setLoadOpen] = useState(false);
  // LAST TIME, ALWAYS IN SIGHT -- D2 (Training Catalog V2, approved
  // 2026-08-31). One header line (whole last session, date, all-time best)
  // plus a per-position reference under every chip, with tap-to-match on
  // the ghosts. Defaults ON; the switch lives in Settings → Training.
  const showLast = readGymSettings().showLast;
  // GYM-F-04 (2026-09-05): the EXERCISE, not its current name, so a rename
  // keeps its Last line, its ghosts' "Last:" and its PR history.
  const header = showLast ? lastHeader(history, exercise, exercise.kind) : null;
  const lastHit = showLast ? lastSessionFor(history, exercise, exercise.kind) : null;
  // THE TRIM (D5-C). A trimmed lift plans fewer sets for THIS session only:
  // the ghosts shrink from the end, the program keeps every set it had
  // (LAW 17), and the big button can still log past the trim -- the lever
  // shortens the plan, never the athlete's ceiling.
  const trimCount = live.trims?.[exercise.id] ?? 0;
  const planEx = trimCount > 0 ? { ...exercise, sets: exercise.sets.slice(0, Math.max(0, exercise.sets.length - trimCount)) } : exercise;
  // THE RAMP (D3-A). Derived from the exercise's own first working weight,
  // never stored, so an edited plan re-ramps for free. Offered before the
  // work and only until it has been logged.
  const ramp = exercise.ramp ? rampFor(exercise, rackFrom(readGymSettings())) : [];
  const rampLogged = logged.filter((s) => s.warmup).length;
  // Part 3 wave 2: a drop segment is not a working set, so it never advances
  // the athlete's place in the plan.
  const workLogged = logged.filter((s) => !s.warmup && !s.drop).length;
  const rampLeft = ramp.slice(rampLogged);
  // THE NOW CARD SHOWS WHAT WILL ACTUALLY BE LOGGED (2026-09-21). It used to
  // show planEx.sets[workLogged] -- the template -- while the big red button
  // named plannedEntryAt() merged with a draft that every write cleared. Two
  // sources, one screen, and they drifted: his card read 225 lb x 2 while the
  // button read "Log 275 lb x 5". Both read nextSetEntry now, so the number
  // under your thumb is the number in the fields.
  const nextUp = nextSetEntry({ plan: planEx, logged, lastSession: lastHit?.sets ?? null });
  const planGhosts = planEx.sets.slice(workLogged);
  const ghost = [...rampLeft, ...(nextUp && planGhosts.length > 0
    ? [{ ...nextUp, id: planGhosts[0]!.id }, ...planGhosts.slice(1)]
    : planGhosts)];
  // 2026-09-11: kept per exercise. This screen stays mounted as the athlete
  // moves through the session, so one flag meant Keep on Bench also dismissed
  // Squat's suggestion, and every lift after it, for the rest of the session.
  const [keptPlan, setKeptPlan] = useState<string[]>([]);
  const [swapOpen, setSwapOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // Default yes: a lift you bothered to name mid-workout is usually one
  // you are doing again, and it is the answer that lets it be paired.
  const [addToDay, setAddToDay] = useState(true);
  const [platesOpen, setPlatesOpen] = useState(false);
  /** What the open set's two fields say this moment, or null before a key is
   *  pressed (then the plan stands). Cleared on every write, and by the effect
   *  below when the athlete moves to another exercise. */
  const [draft, setDraft] = useState<{ w: number; r: number } | null>(null);
  // GYM-F-01 (2026-09-05): the rest is a deadline on the live session, not a
  // tick counter in screen state -- see RestTimer.tsx and LiveSession.restEndsAt.
  const restEndsAt = live.restEndsAt ?? null;
  // THE CONDITIONING BLOCK (ruled 2026-09-01, built 2026-09-02): an exercise
  // that is a clock, not a strip. The big button opens the face; the face
  // writes one entry when it stops; the strip's place is taken by the
  // receipt. Two states, one exercise.
  const cond = exercise.cond ?? null;
  const [clockOpen, setClockOpen] = useState(false);
  // THE PROGRESSION ENGINE (D6-A): a ghost with its reason, offered once,
  // before the first working set. Accepting logs it AND moves the plan;
  // Keep dismisses it and changes nothing at all.
  // Part 3 wave 5: the mode from Health Settings, the rack's smallest plate
  // as a barbell's increment, and the equipment named on the basis.
  const suggestion = workLogged === 0 && !keptPlan.includes(exercise.id)
    ? suggestFor(history, exercise, {
      mode: readHealthSettings().progression,
      // 2026-09-14: the smallest real jump is a PAIR of the smallest plates
      // on anything you load plates onto -- a barbell and a plate-loaded
      // machine both -- and is meaningless on a pinned stack.
      ...(plateMath(style).offer ? { smallestJump: Math.min(...rackFrom(readGymSettings()).plates) * 2 } : {}),
      ...(style.equipment ? { equipmentLabel: styleSummary(style) } : {}),
    })
    : null;
  const [basisOpen, setBasisOpen] = useState(false);

  // D5-C: "the session header shows projected finish against your budget the
  // whole time." Re-projected on a slow tick; only sessions that chose a
  // budget are paced at all -- aware, never nagged.
  const [, setPaceTick] = useState(0);
  useEffect(() => {
    if (!live.budgetMin) return;
    const t = setInterval(() => setPaceTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, [live.budgetMin]);
  const rack = rackFrom(readGymSettings());
  const finishMs = live.budgetMin ? projectFinishMs(live, programDay, history, rack) : null;
  const over = live.budgetMin ? overBudgetMin(live, programDay, history, rack) : null;
  const clock = (ms: number) => { const d = new Date(ms); const h = d.getHours() % 12 || 12; return `${h}:${String(d.getMinutes()).padStart(2, "0")}`; };
  // One quiet banner, one lever at a time, plus the loosener (D5-C: "A +5
  // min button loosens the budget without ceremony").
  const lever = over != null && over >= 3 ? nextLever(live, programDay, history) : null;
  // H-28 (Health Push B, 2026-09-12): the banner names the exact change and
  // what it saves, the capsule says the verb, and every lever has an Undo
  // that puts the session's own fit state back the way it was.
  const fitPlan: FitPlan = { restCut: !!live.restCut, superset: !!live.superset, skipCool: !!live.skipCool, trims: live.trims ?? {} };
  const leverPatch: Partial<LiveSession> | null = !lever ? null
    : lever.key === "restCut" ? { restCut: true }
    : lever.key === "trim" ? { trims: { ...(live.trims ?? {}), [lever.exerciseId]: (live.trims?.[lever.exerciseId] ?? 0) + 1 } }
    : { skipCool: true };
  const leverSave = lever && leverPatch && programDay
    ? Math.max(0, Math.round((estimateDaySec(programDay, history, rack, fitPlan) - estimateDaySec(programDay, history, rack, { ...fitPlan, ...leverPatch })) / 60))
    : 0;
  const leverName = !lever ? "" : lever.key === "restCut"
    ? (() => {
        const rests = (programDay?.exercises ?? []).filter((e) => !e.filler && e.restSec != null).map((e) => e.restSec!);
        const uniform = rests.length > 0 && rests.every((r) => r === rests[0]);
        return uniform ? `Rests ${rests[0]} → ${Math.max(REST_FLOOR_SEC, rests[0]! - 30)}s` : "Shorter rests";
      })()
    : lever.key === "trim"
      ? (() => {
          const ex = programDay?.exercises.find((e) => e.id === lever.exerciseId);
          const planned = ex ? ex.sets.length - (live.trims?.[ex.id] ?? 0) : 0;
          return ex ? `Trim ${ex.name} ${planned} → ${planned - 1} sets` : `Trim ${lever.name}`;
        })()
      : "Skip the cool-down";
  const leverVerb = !lever ? "" : lever.key === "restCut" ? "Shorten Rests" : lever.key === "trim" ? "Trim It" : "Skip It";
  const applyLever = () => {
    if (!lever || !leverPatch) return;
    const before: Partial<LiveSession> = { restCut: live.restCut, trims: live.trims, skipCool: live.skipCool };
    const undo = () => onFit(before);
    onFit(leverPatch);
    const message = lever.key === "restCut" ? "Rests shortened toward 45s"
      : lever.key === "trim" ? `${lever.name} trimmed by a set · This session only`
      : "Cool-down skipped";
    showToast({ message, actionLabel: "Undo", onAction: undo });
  };
  const liftsDone = live.exercises.filter((e) => e.sets.length > 0).length;
  // THE METER (2026-09-14, the reference's "4 of 17 planned working sets
  // logged"): working sets logged against the plan the session started with,
  // trims counted, warm-ups and drops excluded, across the whole day.
  const plannedFor = (e: LiveSession["exercises"][number]): number => {
    const pe = !e.custom && programDay ? programDay.exercises.find((x) => x.id === e.exerciseId) : undefined;
    return pe ? Math.max(0, pe.sets.length - (live.trims?.[pe.id] ?? 0)) : (e.plan?.length ?? 0);
  };
  const plannedTotal = live.exercises.filter((e) => !e.skipped).reduce((n, e) => n + plannedFor(e), 0);
  const loggedTotal = live.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.warmup && !s.skipped && !s.drop).length, 0);
  const meterPct = plannedTotal > 0 ? Math.min(100, Math.round((loggedTotal / plannedTotal) * 100)) : 0;
  // UP NEXT (2026-09-14): the next exercise in the day's order that still has
  // work in it, as one row under the strip. A group's own Next row wins.
  const upNextIdx = live.exercises.findIndex((e, i) => i > idx && !e.skipped && e.sets.filter((s) => !s.warmup && !s.drop && !s.skipped).length < Math.max(1, plannedFor(e)));
  const upNext = upNextIdx >= 0 ? live.exercises[upNextIdx] : undefined;
  /** THIS EXERCISE HAS NOTHING LEFT IN IT (Dave 2026-09-17: "when logging
   *  workouts there should be a done button for exercises right now it just
   *  goes on forever til I switch to another exercise").
   *
   *  The log bar has always held one button that says Log, at every moment of
   *  every exercise, so the plan running out looked exactly like the plan
   *  having two sets left: the only way on was to notice a row further down
   *  the screen and tap it. There was no way to SAY you were finished.
   *
   *  Finished means the planned working sets are logged -- or, for a lift with
   *  no plan at all (added mid-session, or a scratch session), that at least
   *  one set is. Warm-ups and drops are not the work and never have been. */
  const planComplete = !current.skipped && (planEx.sets.length > 0
    ? workLogged >= planEx.sets.length
    : logged.length > 0);
  const nextPlannedWeight = (() => { const n = plannedEntryAt(planEx, workLogged); return n?.w ?? [...logged].reverse().find((x) => !x.warmup)?.w ?? 0; })();
  // The bar tells the foot below how much room it is taking. Its height moves
  // with the text scale, with how many buttons it is carrying, and with the
  // keyboard eating into the home-indicator inset, so it is measured rather
  // than written down. See shared/useBarClearance.ts.
  const logbarRef = useBarClearance("logbar", [planComplete, current.skipped, cond]);

  // D3-C in session: the day's own blocks, checked off as they happen.
  const warmBlocks = programDay?.warmUp ?? [];
  const warmAllDone = warmBlocks.length > 0 && warmBlocks.every((b) => live.warmDone?.includes(b.id));
  const showWarm = idx === 0 && warmBlocks.length > 0 && !live.warmSkipped && !warmAllDone && !current.skipped;
  const allDone = live.exercises.every((e) => {
    if (e.skipped) return true;
    const pe = !e.custom && programDay ? programDay.exercises.find((x) => x.id === e.exerciseId) : undefined;
    const planned = pe ? Math.max(0, pe.sets.length - (live.trims?.[pe.id] ?? 0)) : (e.plan?.length ?? 0);
    const w = e.sets.filter((x) => !x.warmup && !x.skipped).length;
    return planned > 0 ? w >= planned : e.sets.length > 0;
  });
  const coolBlocks = programDay?.coolDown ?? [];
  const coolAllDone = coolBlocks.length > 0 && coolBlocks.every((b) => live.coolDone?.includes(b.id));
  const showCool = allDone && coolBlocks.length > 0 && !live.skipCool && !live.coolSkipped && !coolAllDone;
  const toggleBlock = (which: "warm" | "cool", id: string) => {
    const cur = (which === "warm" ? live.warmDone : live.coolDone) ?? [];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    onFit(which === "warm" ? { warmDone: next } : { coolDone: next });
  };

  /** The WORKING position of the chip at strip position `i`, or null when
   *  that chip is a warm-up. Last session's strip holds working sets only,
   *  so pairing "Last: ..." by raw index would line the work up against the
   *  approach the moment a ramp is on. */
  const workPosAt = (i: number): number | null => {
    if (i < logged.length) {
      if (logged[i]!.warmup || logged[i]!.drop) return null;
      return logged.slice(0, i).filter((s) => !s.warmup && !s.drop).length;
    }
    const g = i - logged.length;
    if (g < rampLeft.length) return null;
    return workLogged + (g - rampLeft.length);
  };
  const lastAt = (i: number): SetEntry | undefined => {
    const pos = workPosAt(i);
    return pos === null ? undefined : lastHit?.sets[pos];
  };

  // UP-ATH-17 (2026-09-06): a group, not a pair. Two members behave exactly
  // as they did; three or more finally can exist. `partner` is the next
  // member in day order, which for a pair is the same exercise it always was.
  // TODAY'S OWN PAIRS, LAID OVER THE DAY (2026-09-21). Every group question
  // below is asked of the day's exercises, so a superset made for this
  // session only has to change exactly one thing: the list they are asked of.
  const dayEx = withLiveGroups(dayExercises, live.groups);
  const labels = groupLabels(dayEx);
  const pairLabel = labels.get(exercise.id);
  const members = groupOf(exercise, dayEx).filter((e) => !e.filler);
  const here = members.findIndex((e) => e.id === exercise.id);
  const partner = members.length > 1 && here >= 0 ? members[(here + 1) % members.length] : undefined;
  const partnerLabel = partner ? labels.get(partner.id) : undefined;
  const partnerLiveIdx = partner ? live.exercises.findIndex((e) => e.exerciseId === partner.id) : -1;
  const filler = fillerFor(exercise, dayEx);
  const fillerLiveIdx = filler ? live.exercises.findIndex((e) => e.exerciseId === filler.id) : -1;

  // D5-C: the rest-cut lever shortens every stated rest toward the floor,
  // live, without touching the program's own number.
  const restSecEff = (() => {
    const stated = exercise.restSec ?? 0;
    if (stated <= 0) return 0;
    return live.restCut ? Math.max(REST_FLOOR_SEC, stated - 30) : stated;
  })();
  // REST AFTER THE ROUND (Part 3 wave 2, 2026-09-13). With a round rest set
  // on the group, a set that leaves another member behind starts no rest:
  // the session moves to that member, and the rest comes once the round is
  // complete. Counted from the live log plus the set that just landed, since
  // this runs in the same tick as the log. A group with no round rest keeps
  // resting after every set, exactly as before.
  const startRest = () => {
    if (exercise.kind === "done") return;
    const roundRest = roundRestFor(exercise, dayEx);
    if (roundRest > 0) {
      const after = { ...loggedByExerciseId, [exercise.id]: (loggedByExerciseId[exercise.id] ?? 0) + 1 };
      if (nextInGroup(exercise, dayEx, after)) return;
      const eff = live.restCut ? Math.max(REST_FLOOR_SEC, roundRest - 30) : roundRest;
      onFit({ restEndsAt: Date.now() + eff * 1000 });
      return;
    }
    if (restSecEff > 0) onFit({ restEndsAt: Date.now() + restSecEff * 1000 });
  };
  const endRest = () => onFit({ restEndsAt: undefined });
  // UP-ATH-03 (2026-09-06): what the lock screen says when the rest lands,
  // built from what actually just happened rather than from the plan: the
  // exercise by name, and the working set number, or the word warm-up when
  // the last thing logged was one of those.
  const lastLogged = logged[logged.length - 1];
  const restLine = exercise.name + (lastLogged?.warmup ? " warm-up" : lastLogged?.drop ? " drop" : " set " + workLogged);

  // GYM-F-24 (2026-09-05): in the live session the strip writes straight
  // through to storage, so one tap on the swipe-revealed delete took the
  // 275 x 5 that had just happened with no toast and no undo -- while every
  // other delete in the app offers one, and the finished-workout editor keeps
  // its changes local until Save Changes. A change that only REMOVES entries
  // is a delete; an edit, a reorder, an add and a duplicate are not, and none
  // of them gets a toast.
  const changeSets = (next: SetEntry[]) => {
    const before = logged;
    onSetLogged(next);
    if (next.length >= before.length) return;
    const gone = before.filter((e) => !next.some((n) => n.id === e.id));
    if (gone.length === 0) return;
    // A conditioning entry is a whole run, not a round of one.
    const one = cond ? "Attempt" : entryNoun(exercise.kind, false);
    const many = cond ? "Attempts" : entryNoun(exercise.kind);
    showToast({
      message: gone.length === 1 ? `${one} deleted` : `${gone.length} ${many.toLowerCase()} deleted`,
      actionLabel: "Undo",
      onAction: () => onSetLogged(before, idx),
    });
  };

  // SUPERSET FLOW (D8-C). A true A1/A2 pair alternates, so once this half is
  // ahead the session offers the other one and the rest belongs to the pair.
  // Counts come from the LIVE log, not the plan, and warm-ups do not count
  // as a turn.
  const loggedByExerciseId: Record<string, number> = {};
  for (const e of live.exercises) {
    loggedByExerciseId[e.exerciseId] = e.sets.filter((x) => !x.warmup && !x.skipped && !x.drop).length;
  }
  const pairNextId = nextInGroup(exercise, dayEx, loggedByExerciseId);
  const pairNext = pairNextId ? dayExercises.find((e) => e.id === pairNextId) : undefined;
  const pairNextLiveIdx = pairNext ? live.exercises.findIndex((e) => e.exerciseId === pairNext.id) : -1;

  // UP-ATH-04 (2026-09-06): every Log Set gets the app's standard receipt
  // with an Undo, the same shape the swipe-delete above already has. A
  // fat-fingered tap on a gym floor cost a swipe and a hunt through the strip
  // before this. The Undo writes the strip as it was BEFORE this tap (the
  // snapshot rule, SHARED-F-03), against the exercise it belongs to, so
  // tapping it twice, or late, or after moving to the pair partner lands on
  // the same answer.
  const receiptForLog = (entry: SetEntry) => {
    const before = logged;
    showToast({
      message: exercise.kind === "done" ? `${exercise.name} logged` : `Logged ${formatSet(exercise, entry)}`,
      actionLabel: "Undo",
      onAction: () => onSetLogged(before, idx),
    });
  };
  // WHAT THE FIELDS SAY, RIGHT NOW (2026-09-16, Dave, mid-session: "when you
  // do see it, it just defaults to like whatever it originally was. So it'll
  // just say log eight reps when I put in a bunch of other info").
  //
  // He was right and it was worse than a label bug. There were TWO ways to log
  // one set and they logged different things: the small tick inside the open
  // set wrote what the fields said, and the big red Log Set -- the obvious one,
  // the one your thumb is already on -- wrote the PLAN and discarded the
  // typing. So the number that landed in his history was not the number he had
  // just entered, and the button had been telling him so the whole time.
  //
  // The open set's fields report upward as they are typed (SetStrip's
  // onGhostDraft). One draft, for the set he is ON, and both doors write it.
  // A draft belongs to ONE open set. Moving exercise leaves it behind rather
  // than carrying last exercise's numbers onto the next one's button.
  useEffect(() => { setDraft(null); }, [exercise.name, exercise.kind, workLogged]);

  const log = () => {
    if (exercise.kind === "done") { const e = { id: newSetId(), done: true }; onLog(e); receiptForLog(e); return; }
    // The plan is the WORK, so it is indexed by working sets logged. Warm-ups
    // sit in the same strip and must never advance the athlete's place in it.
    // The SAME answer the card is showing and the button is naming.
    const resolved = nextSetEntry({ plan: planEx, logged, lastSession: lastHit?.sets ?? null, draft });
    if (resolved) {
      const e = { ...resolved, id: newSetId() };
      onLog(e); setDraft(null); startRest(); receiptForLog(e); return;
    }
    const e = { ...blankEntry(), ...(draft ?? {}) };
    onLog(e);
    setDraft(null);
    startRest();
    receiptForLog(e);
  };
  // LOG A DROP (Part 3 wave 2). A segment right after the last working set,
  // opened at that set's own numbers so the only thing to change is the
  // weight he actually dropped to (the chip is a tap away, and the brief's
  // 75 percent is not a training rule). No rest starts: a drop is the same
  // set continuing. Counted in tonnage, nowhere else.
  const lastWorkForDrop = exercise.kind === "weight_reps" ? [...logged].reverse().find((x) => !x.warmup && !x.drop && !x.skipped) : undefined;
  const logDrop = () => {
    if (!lastWorkForDrop) return;
    const e: SetEntry = { ...duplicateEntry(lastWorkForDrop), drop: true };
    onLog(e);
    const before = logged;
    showToast({ message: "Logged a drop · Tap it to set the weight", actionLabel: "Undo", onAction: () => onSetLogged(before, idx) });
  };

  return (
    <div className="screen ruled health-ruled screen-session">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title truncate">{workoutTitle(live.dayName)}</div>
        {/* H-27: Pause beside Finish. Both quiet; the one filled control on
            this screen is the Log bar's. */}
        <div className="nav-actions">
          <button className="nav-action-text nav-action-quiet" onClick={onPause ?? onBack}>Pause</button>
          <button className="nav-action-text" onClick={onFinish}>Finish</button>
        </div>
      </div>

      {/* LOG IT LATER (catalog §3.8): a backdated session says so, plainly,
          so there is never a doubt about which day this is landing on. */}
      {live.backdated && (
        <div className="pad-x"><div className="eyebrow">Logging for {monthDay(live.date)}</div></div>
      )}

      <div className="pad-x"><div className="card pad">
        {/* WHERE YOU ARE, AS A PICTURE (Dave 2026-09-10: "you barely added
            color... I also said to kill grey subtext throughout and you did
            none of that"). "Exercise 1 of 7" was a grey caps line doing the
            work a progress meter does in every training app ever shipped. It
            is a run of dots now -- filled for finished, ringed for the one
            you are on, hollow for what is left -- with the count beside it.
            Nothing is added that was not already true; it is the same fact,
            drawn instead of spelled. */}
        <div className="se-prog">
          <span className="se-dots" aria-label={`Exercise ${idx + 1} of ${live.exercises.length}`}>
            {live.exercises.map((e, i) => (
              <i key={e.exerciseId + i} className={"se-dot" + (i === idx ? " on" : e.skipped ? " skip" : e.sets.length > 0 ? " done" : "")} />
            ))}
          </span>
          <span className="se-count">{idx + 1}<em>/{live.exercises.length}</em></span>
          {pairLabel && <span className="se-chip se-chip-pair">{pairLabel}</span>}
          {gameLine && <span className="se-chip se-chip-game">{gameLine}</span>}
        </div>
        {/* H-52: how long he has actually been in the gym and how far through
            the day. Parked time is excluded, and says so once there is any. */}
        <div className="facts se-elapsed">
          <ElapsedClock live={live} />
          {(live.pausedMs ?? 0) > 0 && <span className="fact">Paused time excluded</span>}
          <span className="fact">{capAfterNumber(`${liftsDone} of ${live.exercises.length} lifts`)}</span>
          {plannedTotal > 0 && <span className="fact lime">{capAfterNumber(`${loggedTotal} of ${plannedTotal} sets`)}</span>}
        </div>
        {plannedTotal > 0 && (
          <div className="se-meter" role="img" aria-label={`${loggedTotal} of ${plannedTotal} planned working sets logged`}><span style={{ width: meterPct + "%" }} /></div>
        )}
        {/* D5-C: the projected finish rides the header the whole session --
            amber only when actually over, never red (time pressure is a
            warning, not a verb). Two facts, so two chips, aligned: a sentence
            joined by a middot made the reader parse a clause to find a clock. */}
        {finishMs != null && (
          <div className="se-chips">
            <span className={"se-chip" + (over != null && over >= 3 ? " se-chip-over" : " se-chip-time")}>
              <em>Finish</em>{clock(finishMs)}
            </span>
            <span className="se-chip se-chip-budget"><em>Budget</em>{clock(live.startedAt + (live.budgetMin ?? 0) * 60_000)}</span>
          </div>
        )}
        <div className="p3-q">{liftTitle(exercise.name)}</div>
        {/* Part 3 wave 5: the equipment convention, on the session too. */}
        {/* 2026-09-14: the chip names the reading, not just the hardware, so
            mid-set there is no doubt whether the number on the button is one
            dumbbell or the pair. "Load" was the old word for it; the row it
            mirrors is called Equipment now. */}
        {/* A DOOR, AND IT IS THERE WHEN NOTHING HAS BEEN SAID (2026-09-16).
            The chip rendered only once an equipment existed, so the lift that
            most needed the question -- the unclassified one, whose strip was
            stepping by 5 and calling its number "Weight" -- was the one with
            no way to answer it. It asks now, and answering is one tap from
            the rack. */}
        {onSetLoad ? (
          <div className="se-chips">
            <button type="button" className="se-chip se-chip-pair se-chip-door" onClick={() => setLoadOpen(true)}>
              <em>{style.equipment ? weightLabel(style) : "Equipment"}</em>
              {style.equipment ? styleSummary(style) : "Not Set"}
            </button>
            {style.sided && <span className="se-chip se-chip-pair"><em>Reps</em>Per Side</span>}
          </div>
        ) : style.equipment && (
          <div className="se-chips"><span className="se-chip se-chip-pair"><em>{weightLabel(style)}</em>{styleSummary(style)}</span></div>
        )}
        {/* UP-CORE-06 (2026-09-05): the guard, under the title. A workout is
            one of the two places two hours disappear, and the person is by
            definition not looking at their calendar. A fact, in the same
            line the Up Next card has carried since Group B item 12; never a
            modal, and it never stops the session. */}
        <HyperfocusLine guard={guard} variant="chip" />
        {/* THE HISTORY, AS FACTS RATHER THAN A PARAGRAPH. This was one grey
            run-on: every set from last time, then the date, then the best,
            all joined by middots and wrapping to three lines. Best is the
            number that matters mid-lift, so it leads, in the ramp's ink; last
            time and its date follow as their own chips. */}
        {header && (
          <div className="se-chips">
            {header.best && <span className="se-chip se-chip-best"><em>Best</em>{header.best}</span>}
            <span className="se-chip se-chip-last"><em>Last</em>{header.last}</span>
            <span className="se-chip se-chip-when">{monthDay(header.date)}</span>
          </div>
        )}
        {exercise.note && <div className="se-note">{exercise.note}</div>}
      </div></div>

      {/* THE CATCH-UP BANNER (D5-C): "Fall behind and one quiet banner
          offers the next lever." One offer, one loosener, no ceremony. */}
      {over != null && over >= 3 && (
        <div className="pad-x"><div className="catchup banner-warn">
          <div className="grow">
            <div className="catchup-t">{capAfterNumber(`${over} min over`)}</div>
            {lever && (
              <div className="facts">
                <span className="fact">{leverName}</span>
                {leverSave > 0 && <span className="fact cyan">{`Saves ${leverSave} min`}</span>}
              </div>
            )}
          </div>
          {lever && <button className="pill-act" onClick={applyLever}>{leverVerb}</button>}
          <button className="pill-act pill-quiet" onClick={() => onFit({ budgetMin: (live.budgetMin ?? 0) + 5 })}>+5 Min</button>
        </div></div>
      )}

      {/* THE WARM-UP, in session (D3-C): the day's own checklist, checked
          off block by block, skippable as one unit. Shows on the first
          exercise until it is done or waved off. */}
      {/* AND IT WEARS ITS COLOUR IN HERE TOO (Dave, 2026-09-16: "you actually
          took the color out of warm up and cool down sections"). The workout
          DAY has drawn the warm amber and the fading blue since his
          2026-09-13 ruling; this checklist, the one he actually stands in
          front of at the rack, has been plain grey the whole time. Nothing
          took the colour out of it -- it never had it, and the day screen
          beside it did, which is worse than either answer on its own. Same
          two classes, same tones, same eyebrow. */}
      {showWarm && (
        <div className="pad-x"><div className="card list-card-ruled banner-warn">
          <div className="grp"><div className="eyebrow eyebrow-warn">Warm-Up{programDay?.warmUpMin ? ` · ${programDay.warmUpMin} Min` : ""}</div></div>
          {warmBlocks.map((b) => {
            const done = !!live.warmDone?.includes(b.id);
            return (
              <div className="row" role="button" tabIndex={0} key={b.id} onClick={() => toggleBlock("warm", b.id)}>
                <div className="row-grow">
                  <div className="conn-name">{b.name}</div>
                  {b.amount && <div className="conn-meta">{b.amount}</div>}
                </div>
                {done && <span className="pill pill-good">Done</span>}
              </div>
            );
          })}
          <button className="row-create" onClick={() => onFit({ warmSkipped: true })}>Skip the Warm-Up</button>
        </div></div>
      )}

      {/* THE SUGGESTION (D6-A). Never a silent edit: the offer names its own
          evidence, and Keep leaves the plan exactly where it was. */}
      {suggestion && !current.skipped && (
        <div className="pad-x"><div className="card pad">
          <div className="eyebrow">Suggested</div>
          <div className="p3-q">{formatSet(exercise, suggestion.next)}</div>
          <div className="bp-sub">{suggestion.why}</div>
          <div className="row-pair">
            <button className="pill-act" onClick={() => {
              onLog({ ...duplicateEntry({ id: newSetId(), ...suggestion.next }) });
              onAcceptSuggestion?.(suggestion);
              startRest();
            }}>Log {formatSet(exercise, suggestion.next)}</button>
            <button className="pill-act pill-quiet" onClick={() => setKeptPlan((k) => (k.includes(exercise.id) ? k : [...k, exercise.id]))}>Keep {formatSet(exercise, suggestion.from)}</button>
            {/* Part 3 wave 5: every suggestion shows its basis on tap.
                IN THE SAME ROW AS THE OTHER TWO (2026-09-21, the first audit
                ever run inside a session). It had its own .ins-acts below,
                whose 8px margin put its hit box 10px inside the Log pill's --
                the bottom of "Log 275 lb x 5" opened Basis. Three pills are
                one row of actions anyway; a third container under two was
                only ever an accident of the order they were built in. */}
            {suggestion.basis && (
              <button type="button" className="pill-act pill-quiet" aria-expanded={basisOpen} onClick={() => setBasisOpen((o) => !o)}>{basisOpen ? "Hide Basis" : "Basis"}</button>
            )}
          </div>
          {basisOpen && suggestion.basis && (
            <div className="ins-rows ins-ev">
              <div className="ins-row"><span className="ins-k">Lift</span><span className="ins-sub">{suggestion.basis.variant}</span></div>
              <div className="ins-row"><span className="ins-k">Read</span><span className="ins-sub">{suggestion.basis.source}</span></div>
              <div className="ins-row"><span className="ins-k">Sets</span><span className="ins-sub">{suggestion.basis.role}</span></div>
              <div className="ins-row"><span className="ins-k">Range</span><span className="ins-sub">{suggestion.basis.range}</span></div>
              <div className="ins-row"><span className="ins-k">Increment</span><span className="ins-sub">{suggestion.basis.increment}</span></div>
              <div className="ins-row"><span className="ins-k">Marks</span><span className="ins-sub">{suggestion.basis.marks}</span></div>
            </div>
          )}
        </div></div>
      )}

      {/* GROUPS (catalog §4.2, widened by UP-ATH-17) and SUPERSET FLOW
          (D8-C). One row, two states: while the group is mid-round it says
          whose turn it actually is, and otherwise it is the plain switch it
          always was, pointing at the next member in the day's own order. */}
      {partner && partnerLiveIdx >= 0 && (
        <div className="pad-x">
          <button className="row-create" onClick={() => onMove(pairNextLiveIdx >= 0 ? pairNextLiveIdx : partnerLiveIdx)}>
            {pairNext && pairNextLiveIdx >= 0
              ? `Next · ${labels.get(pairNext.id) ?? ""} ${pairNext.name}`.trim()
              : `Switch to ${partnerLabel} · ${partner.name}`}
          </button>
        </div>
      )}

      {/* Music Tier 1 (addendum item 5): the gym context's remembered link. */}
      <div className="pad-x"><MusicChip context="gym" /></div>

      {clockOpen && cond && (
        <ConditioningFace
          name={exercise.name}
          cond={cond}
          onFinish={(r) => { onLog(condResultEntry(exercise, r.elapsed, r.splits)); setClockOpen(false); }}
          onCancel={() => setClockOpen(false)}
        />
      )}

      {/* REST TIMER + FILLER (catalog §4.3, §4.2). key={restEndsAt} remounts
          the timer clean on every new deadline instead of it trying to track
          which set it belongs to. */}
      {restEndsAt != null && (
        <RestTimer
          key={restEndsAt}
          endsAt={restEndsAt}
          fillerName={filler?.name}
          onLogFiller={filler && fillerLiveIdx >= 0 ? () => { onMove(fillerLiveIdx); endRest(); } : undefined}
          onDismiss={endRest}
          notifyLine={restNotify ? restLine : undefined}
          onExtend={() => { onFit({ restEndsAt: restEndsAt + 30_000 }); showToast({ message: "Rest extended 30s" }); }}
        />
      )}

      {/* One head grammar across the gym pages (reformat 2026-08-31): the
          quiet sh2, same as the program page's Days and Recent. */}
      {/* AND IT SAYS WHICH LIFT (2026-09-16, Dave mid-set: "if I'm trying to
          log something, I don't even know what I'm logging, whether it's the
          exercise before or the exercise after"). The head said SETS. The
          exercise's name was a screen above it, past the warm-up card, the
          suggestion card and the superset row, and the list of every OTHER
          exercise in the session sits directly below the strip -- so the one
          place the athlete actually types a number was the one place nothing
          named the lift. The name takes the head and the noun rides the count,
          which is where the noun was doing its work anyway. */}
      <div className="sh2 sh2-quiet"><span className="t">{exercise.name}</span>
        {!cond && !current.skipped && planEx.sets.length > 0 && <span className="n">{capAfterNumber(`${workLogged} of ${planEx.sets.length} ${noun.toLowerCase()}`)}</span>}</div>
      <div className="pad-x">
        {current.skipped ? (
          <div className="card list-card-ruled"><div className="row"><div className="row-grow"><div className="conn-name">Skipped</div></div></div></div>
        ) : cond ? (
          <CondReceipt
            exercise={exercise}
            entries={logged}
            onChange={changeSets}
            lastLine={header ? `Last: ${header.last} · ${monthDay(header.date)}` : null}
          />
        ) : (
          <SetStrip
            kind={exercise.kind}
            unit={exercise.unit}
            timeUnit={exercise.timeUnit}
            style={style}
            entries={logged}
            ghost={ghost}
            onLogGhost={(i) => { onLog(duplicateEntry(ghost[i]!)); startRest(); }}
            editableGhosts
            onLogGhostAs={(i, patch) => { const e = { ...duplicateEntry(ghost[i]!), ...patch }; onLog(e); setDraft(null); startRest(); receiptForLog(e); }}
            onGhostDraft={setDraft}
            onChange={changeSets}
            prAt={celebrations ? (i) => isSessionPR(history, exercise, exercise.kind, logged, i) : undefined}
            moveTracking
            lastFor={lastHit ? (i) => { const s = lastAt(i); return s ? `Last: ${formatSet(lastHit.fx, s)}` : null; } : undefined}
            onMatchLast={lastHit ? (i) => { const src = lastAt(i); if (src) { onLog(entryFrom(src)); startRest(); } } : undefined}
          />
        )}
        {!current.skipped && (
          <>
            {/* SWAP (catalog §3.9): the rack is taken, the shoulder is
                cranky. The program day is never touched -- only this
                session's entry changes. */}
            {lastWorkForDrop && !cond && (
              <button className="row-create" role="button" tabIndex={0} onClick={logDrop}>Log a Drop</button>
            )}
            {upNext && !(partner && partnerLiveIdx >= 0) && (
              <button className="row-create" role="button" tabIndex={0} onClick={() => onMove(upNextIdx)}>{`Up Next · ${upNext.name}`}</button>
            )}
            {/* ONLY WHERE THERE ARE PLATES (2026-09-16, Dave: "it just always
                defaults to dumbbell weight, so the plate loading and all that
                is completely off"). It was gated on the measurement kind
                alone, which every loaded exercise shares -- so a dumbbell press,
                a cable row and a selectorized machine all offered to work out
                which plates go on a barbell, and the sheet then assumed the
                rack's 45 lb bar. plateMath already answers this exactly and
                was already imported at the top of this file; it simply was
                not being asked. */}
            {/* WHATEVER THIS THING LOADS WITH (2026-09-16, Dave: "the plate
                calculator has to factor in all of the weight loading options
                not just dumbbells"). It used to be gated on the measurement
                kind, which every loaded exercise shares, so a stack and a
                dumbbell were both offered barbell plate math. It is offered
                now where there is something to WORK OUT -- plates to hang, a
                pair to total, a pin to find -- and the sheet answers in that
                equipment's own terms. A band has no number and bodyweight and
                assisted are the number itself, so neither asks. */}
            {loadCalcFor(style) && !cond && (
              <button className="row-create" role="button" tabIndex={0} onClick={() => setPlatesOpen(true)}>{loadCalcFor(style)}</button>
            )}
            {onAdjustTime && (
              <button className="row-create" role="button" tabIndex={0} onClick={onAdjustTime}>Adjust Time</button>
            )}
            <button className="row-create" role="button" tabIndex={0} onClick={() => setSwapOpen(true)}>Swap</button>
            {onSuperset && dayExercises.length > 1 && (
              <button className="row-create" role="button" tabIndex={0} onClick={onSuperset}>Superset With…</button>
            )}
            {onUpdateProgram && (
              <button className="row-create" role="button" tabIndex={0} onClick={onUpdateProgram}>Also Update the Program</button>
            )}
            <button className="row-create" role="button" tabIndex={0} onClick={onSkip}>Skip This Exercise</button>
          </>
        )}
      </div>

      {/* THE COOL-DOWN (D3-C): offered when the work is done, skippable as
          a unit. Skipping here is the same lever the fit sheet offers. */}
      {showCool && (
        <div className="pad-x"><div className="card list-card-ruled banner-cool">
          <div className="grp"><div className="eyebrow eyebrow-cool">Cool-Down{programDay?.coolDownMin ? ` · ${programDay.coolDownMin} Min` : ""}</div></div>
          {coolBlocks.map((b) => {
            const done = !!live.coolDone?.includes(b.id);
            return (
              <div className="row" role="button" tabIndex={0} key={b.id} onClick={() => toggleBlock("cool", b.id)}>
                <div className="row-grow">
                  <div className="conn-name">{b.name}</div>
                  {b.amount && <div className="conn-meta">{b.amount}</div>}
                </div>
                {done && <span className="pill pill-good">Done</span>}
              </div>
            );
          })}
          <button className="row-create" onClick={() => onFit({ coolSkipped: true })}>Skip the Cool-Down</button>
        </div></div>
      )}

      <div className="sh2 sh2-quiet"><span className="t">This Session</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        {live.exercises.map((e, i) => (
          // RED IS A VERB: "you are here" is a fact, not an action, so the
          // current exercise marks itself with weight and a quiet Now pill,
          // never a red name (spec sweep 2026-09-01).
          <div className="row" role="button" tabIndex={0} key={e.exerciseId + i} onClick={() => onMove(i)}>
            <div className="row-grow">
              <div className="conn-name truncate">{e.name}</div>
              {/* THREE STATES, THREE COLOURS, NO SENTENCE (Dave 2026-09-10:
                  "kill grey subtext throughout"). "3 Logged" / "Not started" /
                  "Skipped" were the same grey, so the one thing this list is
                  for -- seeing at a glance what is done -- took reading seven
                  lines of identical text. Done is lime, skipped is amber,
                  untouched is a hollow outline that says To Do. */}
              {/* ONE ROW ANATOMY (2026-09-16): the three states keep their
                  three colours, which is the whole point of this list; what
                  changes is that they are facts on the row's own second line
                  like every other list in the app, not filled capsules this
                  screen invented for itself. */}
              <div className="facts">
                {e.skipped
                  ? <span className="fact st amber">Skipped</span>
                  : e.sets.length > 0
                    ? <span className="fact lime">{capAfterNumber(`${e.sets.length} ${e.sets.length === 1 ? "set" : "sets"}`)}</span>
                    : <span className="fact st gray">To Do</span>}
              </div>
            </div>
            {/* NOW is the one row you are standing on. It was .pill-subdued,
                which is the app's neutral grey pill, so it read as a disabled
                control rather than a position. It takes the ramp's cyan. */}
            {i === idx ? <span className="se-now">Now</span> : CHEV}
          </div>
        ))}
        {/* ADD MID-SESSION (catalog §3.10): an exercise that was never in
            the plan, without editing the program. */}
        <button className="row-create" onClick={() => setAddOpen(true)}>Add Exercise</button>
      </div></div>
      {/* THE FOOT IS THE LOG BAR'S OWN HEIGHT (2026-09-21, the first audit
          ever run inside a session). .screen-foot is 32px and the log bar is
          nearer 90 -- a 56px button, its padding, and whatever the home
          indicator is still asking for -- so the last set row and the Add
          Exercise button sat permanently behind it. No number typed here
          could be right for every text size and every phone, so the bar
          measures itself and this reads what it found. */}
      <div className="screen-foot se-foot" />

      {/* THE LOG BAR (H-11 / R8, Health Push B, 2026-09-12): one bar owning
          the bottom edge with the one primary, the note editor's geometry;
          the shell has stepped its tab bar and dock aside (gym/sessionChrome). */}
      {!current.skipped && (
        <div className="logbar" ref={logbarRef}>
          {/* THE SECOND HALF OF THE BAR (2026-09-17). Once the plan is done,
              logging another set is the unusual move and moving on is the
              common one, so they swap places: the extra set keeps a secondary
              button (it is still one tap, nothing is taken away) and the
              primary becomes what you actually meant. It says where it goes,
              because "Done" alone on the last exercise of a session would be
              a button that silently ends the workout. */}
          {planComplete && (
            cond
              ? <button className="btn btn-secondary btn-lg" onClick={() => setClockOpen(true)}>Run It Again</button>
              : <button className="btn btn-secondary btn-lg" onClick={log}>Log Another Set</button>
          )}
          {/* DONE IS NOT THE SAME AS FINISHING THE PLAN (Dave, 2026-09-21: "I
              still can't make an exercise as done during a workout").
              The way on only appeared once every planned set was logged. Stop
              at two of three because that is genuinely all you have in you,
              and the only exit was Skip This Exercise -- a row far down the
              screen, and the wrong word: skipped means you did none of it,
              and it would have thrown away the two sets you did do.
              So the way on is always there once there is anything to keep.
              It stays SECONDARY until the plan is complete, because until
              then logging is still the common move and moving on is the
              exception; after it they swap, which is the 2026-09-17 ruling
              and is unchanged. */}
          {!planComplete && logged.length > 0 && !cond && (
            <button className="btn btn-secondary btn-lg"
              onClick={() => (upNextIdx >= 0 ? onMove(upNextIdx) : onFinish())}>
              {upNextIdx >= 0 ? "Next Exercise" : "Finish Workout"}
            </button>
          )}
          {planComplete
            ? <button className="btn btn-primary btn-launch btn-lg"
                onClick={() => (upNextIdx >= 0 ? onMove(upNextIdx) : onFinish())}>
                {upNextIdx >= 0 ? "Next Exercise" : "Finish Workout"}
              </button>
            : cond
              ? <button className="btn btn-primary btn-launch btn-lg" onClick={() => setClockOpen(true)}>
                  {logged.length === 0 ? "Start the Clock" : "Run It Again"}
                </button>
              : <button className="btn btn-primary btn-launch btn-lg" onClick={log}>
                  {logButtonLabel(planEx, workLogged, { ...(nextUp ?? {}), ...(draft ?? {}) })}
                </button>}
        </div>
      )}

      {swapOpen && (
        <LibraryPickSheet
          title="Swap For"
          library={library}
          kindFilter={exercise.kind}
          onPick={(entry) => { onSwap({ exerciseKey: entry.exerciseKey, name: entry.name, kind: entry.kind, unit: entry.unit, timeUnit: entry.timeUnit }); setSwapOpen(false); }}
          onFreeText={(text) => { onSwap({ exerciseKey: newExerciseKey(), name: text, kind: exercise.kind, unit: exercise.unit, timeUnit: exercise.timeUnit }); setSwapOpen(false); }}
          onCancel={() => setSwapOpen(false)}
        />
      )}
      {platesOpen && (
        <PlateSheet total={nextPlannedWeight} unit={exercise.unit} rack={rack} style={style} onClose={() => setPlatesOpen(false)} />
      )}
      {loadOpen && onSetLoad && (
        <LoadSheet
          name={exercise.name}
          initial={style}
          onSave={(next) => { onSetLoad(next); setLoadOpen(false); }}
          onCancel={() => setLoadOpen(false)}
        />
      )}
      {addOpen && (
        <ExerciseSheet
          mode="new"
          library={library}
          history={history}
          alsoOnDay={programDay ? { dayName: programDay.name, value: addToDay, onChange: setAddToDay } : undefined}
          onSave={(draft) => { onAddMidSession(draft, !!programDay && addToDay); setAddOpen(false); }}
          onCancel={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}
