import { useEffect, useRef, useState } from "react";
import { EQUIPMENT_LABEL, loadCalcFor, loadStyleOf, plateMath, styleSummary, weightLabel, weightStep, type LoadStyle } from "./equipment";
import { MUSCLE_LABEL } from "./muscles";
import MusclePickSheet, { type MusclePick } from "./MusclePickSheet";
import type { Exercise, MeasureKind, ProgramDay, SetEntry, Workout  } from "./types";
import { elapsedMs, type LiveSession } from "./liveSession";
import { nowDraftStore, readNowDraft, writeNowDraft } from "./sessionDrafts";
import { overBudgetMin, nextLever, projectFinishMs, estimateDaySec, type FitPlan } from "./fit";
import { liftTitle, lineCase, workoutTitle } from "../shared/casing";
import { spanLabel } from "../shared/duration";
import { REST_FLOOR_SEC } from "./pacing";
import { logButtonLabel, entryNoun, formatSet, fieldsFor, isLoggable, loggingBlocker } from "./measures";
import { fieldsOf, withDraft, type SetDraft } from "./nextSet";
import { nextSetEntry } from "./nextSet";
import { newSetId, blankEntry, duplicateEntry, entryFrom, uniformStrip } from "./strip";
import { isSessionPR, lastHeader, lastSessionFor, lastWarmupsFor } from "./prs";
import { readGymSettings, rackFrom, overloadApplyOf, overloadTargetsOf, type CreatedLift } from "./settings";
import { readHealthSettings } from "../health/settings";
import { rackIn, rampFor, scaleWarmups, startsInWarmUp, warmupSeed } from "./ramp";
import { readClassStore, type Classification } from "./classify";
import { exerciseFromEntry } from "./fromLibrary";
import { suggestFor, inSessionAdjust, type Suggestion, type SuggestOptions } from "./progression";
import HowSuggestionsSheet from "./HowSuggestionsSheet";
import VoiceSetSheet from "./VoiceSetSheet";
import { groupLabels, fillerFor, nextInGroup, nextTurnInGroup, groupOf, roundRestFor } from "./groups";
import { isLiveGroup, sessionExercises } from "./liveGroups";
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
import ActionSheet, { PickSheet, type SheetAction, type PickItem } from "./ActionSheet";
import SetSheet from "./SetSheet";
import { setCount, workNumbers } from "./stateWord";
import { fmtTime } from "../schedule/calendar";
import MusicChip from "../music/MusicChip";
import { showToast } from "../shared/toast";
import { monthDay } from "../money/bills";
import { useWakeLock } from "../shared/useWakeLock";

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
  // m:ss, and h:mm:ss once past an hour (Dave 2026-09-26): 75:12 is not a
  // clock anybody reads.
  const mm = String(Math.floor(s / 60) % 60).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  const text = s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${Math.floor(s / 60)}:${ss}`;
  const paused = (live.pausedMs ?? 0) > 0;
  // The running clock is the current reading, so it wears the Health "now"
  // ink (§AM). Parked time is excluded, and the clock says so to VoiceOver;
  // on screen the lift count carries it, not a second plain fact (§AK).
  return (
    <span className="fact now" role="timer" aria-label={paused ? `${text} elapsed, paused time excluded` : `${text} elapsed`}>
      {text}
    </span>
  );
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
  onGroupToday,
  onGroupProgram,
  onUngroup,
  onSwap,
  onSetLoad,
  musclesOf,
  onSetMuscles,
  onOpenHistory,
  onAddMidSession,
  onAdopt,
  onUpdateProgram,
  onAcceptSuggestion,
  onFit,
  onAdjustTime,
  onFinish,
  onCancel,
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
  // THE PROGRAM WEEK'S OWN WORD (2026-10-17, section 10): this session's week
  // is marked Back-Off in the program, so rule 4 applies whatever the log
  // says. GymFlow reads it off the week that holds the live day.
  backOffWeek = false,
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
  /** SUPERSET, ONE ACTION (2026-09-26, the workout logging pass-off, Dave:
   *  "Superset linking between exercises is broken and hard to use"). The
   *  old door opened a multi-pick sheet and then a second sheet asking
   *  whether the pair was for today or for the program, from a chip in the
   *  header AND a red line under the strip. It is one line in the More sheet
   *  now, "Superset With <the next lift>", and it pairs THIS session (the
   *  ids are the session's own exerciseIds, see liveGroups.sessionExercises).
   *  Keeping it in the program is the separate, explicit line below, the way
   *  Also Update the Program is for a swap. Absent while no session write is
   *  possible. */
  onGroupToday?: (ids: string[]) => void;
  /** The same pair written to the program day ("Every Push Day"), offered
   *  only when both lifts are on the day. Dave's 2026-09-21 pick, "ask me
   *  each time", is the two-line sheet the Superset chip opens. */
  onGroupProgram?: (ids: string[]) => void;
  /** BREAK IT UP (2026-09-21; scoped 2026-09-26). Today's own pair is simply
   *  released. A pair the program owns asks the same two questions as making
   *  one: just this workout, or every one of this day. */
  onUngroup?: (scope: "today" | "program") => void;
  onSwap: (sub: { exerciseKey?: string; name: string; kind: MeasureKind; unit?: string; timeUnit?: string }) => void;
  /** HOW THIS LIFT LOADS, SET FROM IN HERE (2026-09-16, Dave: "I don't even
   *  have the option while I'm logging to select what type of weight system
   *  it is"). The equipment, the reading and the reps axis. Absent leaves the
   *  header chip a fact rather than a door, which is what it was. */
  onSetLoad?: (next: LoadStyle, at?: number) => void;
  /** WHAT AN EXERCISE TRAINS (Dave 2026-10-09, mockup 3 and 8): the
   *  classification the library keeps, read for the header's Primary and Also
   *  chips and for each list row's muscle fact. Absent, neither is drawn. */
  musclesOf?: (e: { exerciseKey?: string; name: string; kind: MeasureKind }) => MusclePick;
  /** The muscles picked on the header's sheet, written to that same
   *  classification. Absent, the chips are facts rather than doors. */
  onSetMuscles?: (next: MusclePick) => void;
  /** The exercise's own history page (mockup 3's History), from the More
   *  sheet. Absent, the line is absent. */
  onOpenHistory?: () => void;
  /** The draft, and whether it should also land on the program day. */
  onAddMidSession: (draft: Omit<Exercise, "id">, alsoOnDay: boolean) => void;
  /** A STARTER PICKED IN HERE BECOMES THE ATHLETE'S (S9; 2026-10-17). Swap
   *  and Add Exercise both list the preloaded catalog, and a pick from it is
   *  adopted (a fresh key, the catalog's muscles as its classification). The
   *  adoption goes to GymFlow, the one writer of classByKey and createdLifts,
   *  through this; the sheet writes nothing itself, so a lift adopted at the
   *  rack keeps its muscles past the next classification saved anywhere. */
  onAdopt: (adopted: { entry: LibraryEntry; seed: CreatedLift; cls: Classification }[]) => void;
  /** Part 3 wave 5 (Dave's 10a): a swapped or added exercise changes this
   *  session only; this is the one explicit way to carry it into the
   *  program. Absent on a planned exercise. */
  onUpdateProgram?: () => void;
  /** D6-A: the athlete accepted a suggestion, so the PROGRAM's own plan for
   *  this exercise moves. The only writer; a suggestion left alone changes
   *  nothing. IT HANDS BACK THE WAY BACK (2026-10-17, Logging Standard rule
   *  5: every write inside a logging flow has an Undo): a function that puts
   *  the plan back exactly as it was before the accept, or null when nothing
   *  moved (the lift is not in this day's plan). The set's one receipt
   *  carries one Undo, and that Undo reverts the set and the move together. */
  onAcceptSuggestion?: (s: Suggestion) => (() => void) | null;
  /** The live day's program week is a back-off week (ProgramWeek.backOff),
   *  handed to the progression engine as its backOffWeek option. */
  backOffWeek?: boolean;
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
  /** CANCEL THE WORKOUT (2026-09-27, Dave: "I need to be able to cancel a
   *  workout. There's no way to do that once you hit start"). Throws the
   *  session away without saving anything; GymFlow's toast carries the
   *  Undo. Absent, the row is absent. */
  onCancel?: () => void;
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
  // NO CALENDAR LINE IN A WORKOUT (Dave 2026-10-17): the hyperfocus guard's
  // amber "next commitment" chip used to ride this header. No schedule or
  // suggestion banner renders inside a session; the hook is not called here.
  const idx = live.idx;
  const current = live.exercises[idx]!;
  const logged = current.sets;
  const noun = entryNoun(exercise.kind);
  // WHAT THIS THING LOADS WITH, read once. It drives the strip's own steppers
  // now (2026-09-16), not just the header chip and the calculator's door.
  const style = loadStyleOf(exercise);
  /** WHICH EXERCISE THE EQUIPMENT SHEET IS ANSWERING FOR (2026-10-09): the
   *  one on screen, from the header chip, or any row of the list, from that
   *  row's own chip. Null when it is closed. */
  const [loadAt, setLoadAt] = useState<number | null>(null);
  /** The Primary or Secondary chip's sheet, while it is open. */
  const [muscleRole, setMuscleRole] = useState<"primary" | "secondary" | null>(null);
  // THE MUSCLES ON THE HEADER (mockup 3). The library's classification first;
  // a lift only ever tagged on its program day still shows that one muscle.
  const muscles: MusclePick | null = musclesOf ? (() => {
    const c = musclesOf(exercise);
    return c.primary.length === 0 && c.secondary.length === 0 && exercise.muscleGroup
      ? { primary: [exercise.muscleGroup], secondary: [] }
      : c;
  })() : null;
  /** A list row's one muscle: its first primary, from the same places. */
  const rowMuscle = (e: LiveSession["exercises"][number]) => {
    if (!musclesOf) return null;
    return musclesOf(e).primary[0] ?? e.program?.muscleGroup ?? dayExercises.find((d) => d.id === e.exerciseId)?.muscleGroup ?? null;
  };
  /** ONE OVERFLOW (2026-09-26, Dave: "Overall format is cluttered. Dropdowns
   *  everywhere, not organized, not minimalist"). Every secondary move on
   *  the exercise -- a drop, the load calculator, the superset, time, swap,
   *  the program write, skip -- sat as its own red line under the strip,
   *  eight of them on a full screen. They are one More capsule on the
   *  strip's head and the app's own row-action sheet. */
  const [moreOpen, setMoreOpen] = useState(false);
  /** LOG ANOTHER SET OPENS A NOW ROW (2026-09-26). Once the plan is done the
   *  extra set used to be written on the spot, from a number nowhere on the
   *  screen. It opens the same Now row every other set is logged from, so
   *  the fields say what is about to land and the button says the same. */
  const [extraOpen, setExtraOpen] = useState(false);
  /** What the Now row's two fields say this moment, as the strings they
   *  hold, or null before a key is pressed (then the seed stands). Cleared on
   *  every write, and by the effect below when the athlete moves to another
   *  exercise. See nextSet.ts, SetDraft. */
  //
  // AND IT SURVIVES THE APP (the Logging Standard, rule 8, 2026-10-17:
  // "No entry is ever lost. Drafts persist per keystroke"). Every change to
  // the draft is also written to this session's store for this exercise
  // (sessionDrafts.ts), and a remount opens on what was typed. The log that
  // spends it clears it; clearLive sweeps the rest when the session ends. A
  // restored draft sits in the fields unselected: he was mid-typing, and
  // nothing here pretends otherwise.
  const nowStore = nowDraftStore(live.startedAt, current.exerciseId);
  const [draft, setDraft] = useState<SetDraft | null>(() => readNowDraft(nowStore));
  const putDraft = (d: SetDraft | null) => { setDraft(d); writeNowDraft(nowStore, d); };
  // LAST TIME, ALWAYS IN SIGHT -- D2 (Training Catalog V2, approved
  // 2026-08-31). One header line (whole last session, date, all-time best)
  // plus a per-position reference under every chip, with tap-to-match on
  // the ghosts. Defaults ON; the switch lives in Settings → Training.
  const showLast = readGymSettings().showLast;
  // GYM-F-04 (2026-09-05): the EXERCISE, not its current name, so a rename
  // keeps its Last line, its ghosts' "Last:" and its PR history.
  // THE WEEK PRIOR, FOR THIS DAY (2026-09-27): the last time this workout day
  // trained the lift, before any other day's session (prs.ts).
  const lastOpts = { preferDayId: live.dayId };
  const header = showLast ? lastHeader(history, exercise, exercise.kind, lastOpts) : null;
  // THE PREFILL DOES NOT ASK THE SETTING (2026-09-27, Dave: "autofill ...
  // should default to the week prior"). Show Last is a switch for what the
  // screen SAYS -- the Last chips and Match. It was also silently deciding
  // what the fields opened at, so with it off the first set fell back to the
  // plan's template and never to what he actually lifted.
  const seedHit = lastSessionFor(history, exercise, exercise.kind, lastOpts);
  const lastHit = showLast ? seedHit : null;
  // THE TRIM (D5-C). A trimmed lift plans fewer sets for THIS session only:
  // the ghosts shrink from the end, the program keeps every set it had
  // (LAW 17), and the big button can still log past the trim -- the lever
  // shortens the plan, never the athlete's ceiling.
  const trimCount = live.trims?.[exercise.id] ?? 0;
  const planEx = trimCount > 0 ? { ...exercise, sets: exercise.sets.slice(0, Math.max(0, exercise.sets.length - trimCount)) } : exercise;
  // THE RAMP (D3-A). Derived from the exercise's own first working weight,
  // never stored, so an edited plan re-ramps for free. AS OF 2026-09-29 IT IS
  // A SUGGESTION, NOT ROWS (Dave: "way too complicated... some automode"). It
  // used to draw itself as dashed Warm-Up rows counted off by how many
  // warm-ups were logged, so two warm-ups of his own (180, 270) left the
  // ramp's 160 and 225 sitting on screen. Now it only decides what the Now
  // card opens with: the next step above the heaviest warm-up logged, until
  // the first working set lands or the ramp runs out (ramp.ts).
  const gymSettings = readGymSettings();
  /** THE RACK IN THIS LIFT'S UNIT (2026-10-17, defect G): what the weight
   *  field steps by on anything plates go on. */
  const exRack = rackIn(rackFrom(gymSettings), exercise.unit);
  // Part 3 wave 2: a drop segment is not a working set, so it never advances
  // the athlete's place in the plan.
  const workLogged = logged.filter((s) => !s.warmup && !s.drop).length;
  // ONE COUNT (pass-off item 9): the head's "N of M Sets", the Now row's set
  // number and whether the plan is done all read this, so they cannot
  // disagree (stateWord.setCount). `workLogged` above is the PLACE in the plan
  // (a skipped set holds its place); this is what was lifted.
  const count = setCount(logged, planEx.sets.length);
  // THE PROGRESSION ENGINE (section 10, PROGRESSIVE OVERLOAD, 2026-10-17; was
  // D6-A): one published rule, autoregulated double progression
  // (progression.ts), offered before the first working set, with its reason
  // citing his own last sets. Accepting logs it AND moves the plan; left
  // alone it changes nothing at all.
  // 2026-09-26: it rides INSIDE the Now row as one line, so it never moves the
  // row when it goes; it goes with the first working set, and the program
  // moves only if that set is logged at the suggested numbers.
  //
  // ONCE SET ONE IS LOGGED (rule 7, 2026-10-17), the same line reads set one
  // against its target and offers the rest of the sets a drop or, for a
  // seasoned lifter whose top set was easy, a little more (inSessionAdjust).
  // It fills the fields through Use like the first; the program never moves
  // on it (the accept below is gated to the first working set).
  const suggestOpts: SuggestOptions = {
    mode: readHealthSettings().progression,
    // The session the Last header names, this workout day's own first
    // (2026-09-29), so "Last" and "Suggested" are built on the same lift.
    preferDayId: live.dayId,
    // The smallest real jump: a PAIR of the smallest plates on anything you
    // load plates onto (2026-09-14), the stack's own step on a machine, and
    // the engine's 2.5 default for anything that named no equipment.
    ...(plateMath(style).offer ? { smallestJump: Math.min(...exRack.plates) * 2 } : style.equipment ? { smallestJump: weightStep(style, exercise.unit) } : {}),
    ...(style.equipment ? { equipmentLabel: styleSummary(style) } : {}),
    // The program week's word, the sets setting, and the day the week is
    // counted from (section 10, 2026-10-17).
    ...(backOffWeek ? { backOffWeek: true } : {}),
    targets: overloadTargetsOf(gymSettings),
    today: live.date,
  };
  const suggestion = workLogged === 0
    ? suggestFor(history, exercise, suggestOpts)
    : inSessionAdjust(history, exercise, logged, suggestOpts);
  // THE NOW CARD SHOWS WHAT WILL ACTUALLY BE LOGGED (2026-09-21). It used to
  // show planEx.sets[workLogged] -- the template -- while the big red button
  // named plannedEntryAt() merged with a draft that every write cleared. Two
  // sources, one screen, and they drifted: his card read 225 lb x 2 while the
  // button read "Log 275 lb x 5".
  //
  // ONE ANSWER, THREE READERS (2026-09-26, the pass-off: "Bottom action
  // buttons do not update when numbers change. They show the wrong logged
  // weight"). `seed` is the app's own guess (nextSet.ts); `pending` is that
  // guess with the fields' typing laid over it. The fields SHOW pending, the
  // button NAMES pending, and log() WRITES pending. There is no plan merged
  // underneath any of them, and no copy the fields keep for themselves.
  //
  // WORK OR WARM-UP (2026-09-29). The Now card is on one of two sides. Its
  // default is startsInWarmUp (ramp on, no working set yet, a step left); the
  // Work | Warm-Up pill overrides it through the draft, and the override
  // survives typing and goes with the next write. Each side has its own
  // starting numbers, and `seed` is the one for the side it is on.
  //
  // PREFILL (Dave, 2026-10-17: "Fill it in for me, the next weight and reps
  // are already there, I just log it"; gym/settings.ts overloadApply). The
  // first set opens ON the step, and the set after set one opens on the
  // in-session adjustment when set one called for one. Logged untouched, the
  // first is the accept and moves the plan (log() below). Two never fill in:
  // a scheme change, which is a question and not a number, and a step he
  // changed last session (Suggestion.declined), which is offered with Use
  // instead, because the app never argues twice. "suggest", a stored value
  // only, opens where the screen did before: last session's set at this
  // position (or the plan), with the step beside it as Suggested and Use.
  const seededWork = nextSetEntry({ plan: planEx, logged, lastSession: seedHit?.sets ?? null });
  const prefillOn = overloadApplyOf(gymSettings) === "prefill";
  const prefillStep = prefillOn && (workLogged === 0 || workLogged === 1) && !!suggestion && suggestion.kind !== "scheme" && !suggestion.declined;
  const workSeed = prefillStep ? { ...(seededWork ?? blankEntry()), ...suggestion.next } : seededWork;
  // THE WARM-UPS CLIMB TO THE STEP (2026-10-17, item 5 behind Dave's prefill
  // answer). The computed ramp is built under the weight the first set opens
  // at; his own warm-ups from last time stay his, and only one that would sit
  // at or over a lighter top moves under it (ramp.ts scaleWarmups).
  const stepTop = prefillStep && workLogged === 0 && exercise.kind === "weight_reps" ? workSeed?.w ?? null : null;
  const ramp = !exercise.ramp ? [] : stepTop
    ? rampFor({ ...exercise, sets: [{ id: "step", w: stepTop }] }, rackFrom(gymSettings))
    : rampFor(exercise, rackFrom(gymSettings));
  // HIS OWN WARM-UPS FROM LAST TIME (Dave 2026-10-15; defect I): the same
  // session the Last line reads, its warm-ups in order, so the Warm-Up side
  // opens on what he actually did, and only falls back to the computed ramp
  // when there is no history at all.
  const warmFields = fieldsFor(exercise.kind, { ...style, unit: exercise.unit, rack: exRack });
  const ownWarmups = exercise.kind === "weight_reps" ? lastWarmupsFor(history, exercise, exercise.kind, lastOpts) : [];
  const priorWarmups = stepTop && suggestion?.from.w
    ? scaleWarmups(ownWarmups, { from: suggestion.from.w, to: stepTop, hasBar: !style.equipment || plateMath(style).hasBar, rack: rackFrom(gymSettings), unit: exercise.unit, step: warmFields.find((f) => f.key === "w")?.step ?? 0.5 })
    : ownWarmups;
  const warm = draft?.warm ?? startsInWarmUp(ramp, logged, priorWarmups);
  const warmGuess = exercise.kind === "weight_reps"
    ? warmupSeed({
      ramp, logged, work: workSeed?.w ?? null,
      // A lift nobody has classified reads as a barbell, the ramp's own reading.
      hasBar: !style.equipment || plateMath(style).hasBar,
      rack: rackFrom(gymSettings), unit: exercise.unit,
      step: warmFields.find((f) => f.key === "w")?.step ?? 0.5,
      priorWarmups,
    })
    : null;
  const warmSeed: SetEntry | null = warmGuess
    ? { id: "", ...(warmGuess.w !== undefined ? { w: warmGuess.w } : {}), ...(warmGuess.r !== undefined ? { r: warmGuess.r } : {}) }
    : workSeed;
  /** The Warm-Up side is the app's computed guess, not his history (defect
   *  I): the card labels it Suggested. */
  const warmComputed = !!warmGuess?.computed;
  const seed = warm ? warmSeed : workSeed;
  const pending = withDraft(seed, draft);
  const fields: SetDraft = draft ?? fieldsOf(seed);
  const planGhosts = planEx.sets.slice(workLogged);
  const nowEntry = { ...(pending ?? blankEntry()), id: planGhosts[0]?.id ?? `extra-${workLogged}` };
  // The Now row is on the screen whenever a set can be logged: the plan's
  // next set, the extra set once the plan is done and Log Another Set was
  // tapped, or the first set of a lift that planned none.
  const showNow = !exercise.cond && !current.skipped && exercise.kind !== "done" && (planGhosts.length > 0 || extraOpen || (planEx.sets.length === 0 && logged.length === 0));
  // The rows after it show the Now row's numbers (Dave's own "set before"
  // rule carried forward, so a row never changes numbers the moment it
  // becomes Now), each with its own Last chip.
  // On the Warm-Up side the rows after it still show the WORK's numbers, never
  // the warm-up's.
  const ahead = warm ? workSeed : pending;
  const carry = (g: SetEntry): SetEntry => { const { w: _w, r: _r, ...rest } = g; return { ...rest, ...(ahead?.w ? { w: ahead.w } : {}), ...(ahead?.r ? { r: ahead.r } : {}) }; };
  // ON THE WARM-UP SIDE THE NOW CARD IS A WARM-UP, NOT THE PLAN'S NEXT SET
  // (pass-off item 9). It used to stand in for planned Set 1, so the rows
  // under it started at Set 2 while the head said "0 of 3 Sets"; the plan's
  // sets all stay on screen under it now, numbered from 1.
  const ghost = !showNow ? [] : warm
    ? [{ ...nowEntry, id: `warm-${logged.length}` }, ...planGhosts.map(carry)]
    : [nowEntry, ...planGhosts.slice(1).map(carry)];
  // 2026-09-11: kept per exercise. This screen stays mounted as the athlete
  // moves through the session, so one flag meant Keep on Bench also dismissed
  // Squat's suggestion, and every lift after it, for the rest of the session.
  /** The set a Done row opened in the Set sheet (2026-09-26), by id. */
  const [openSetId, setOpenSetId] = useState<string | null>(null);
  /** THE PLANNED SET A DASHED ROW OPENED (2026-10-17, defect C), by its id in
   *  this session's plan. Saving writes the session's own plan
   *  (WorkoutExercise.plan, through the live-session writer); the program is
   *  never touched from here. */
  const [openPlanId, setOpenPlanId] = useState<string | null>(null);
  /** LOG BY VOICE, AS A TEST (2026-10-17, Alfred's ruling on Dave's "Whatever
   *  is standard"): the More sheet's door to VoiceSetSheet. */
  const [voiceOpen, setVoiceOpen] = useState(false);
  /** START REST BY HAND (2026-10-17, defect J): the More sheet's picks. */
  const [restPickOpen, setRestPickOpen] = useState(false);
  /** ADD EXERCISE, FROM THE LIBRARY FIRST (2026-10-17, defect K): the picker,
   *  then the full sheet only for a name the library does not know. */
  const [addPickOpen, setAddPickOpen] = useState(false);
  const [addName, setAddName] = useState<string | null>(null);
  /** The Superset chip's two questions (2026-09-26): which lift to pair
   *  with, and whether a program pair breaks for today or for good. */
  /** THE SUPERSET PICKER (2026-09-27): every lift in the session with a Pick
   *  chip, this one already picked; two or three picks and one button. */
  const [pickOpen, setPickOpen] = useState(false);
  /** The picked ids, while the "just today or every day" question is up. */
  const [scopeAsk, setScopeAsk] = useState<string[] | null>(null);
  const [breakAsk, setBreakAsk] = useState(false);
  const [cancelAsk, setCancelAsk] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  // Default yes: a lift you bothered to name mid-workout is usually one
  // you are doing again, and it is the answer that lets it be paired.
  const [addToDay, setAddToDay] = useState(true);
  const [platesOpen, setPlatesOpen] = useState(false);
  // GYM-F-01 (2026-09-05): the rest is a deadline on the live session, not a
  // tick counter in screen state -- see RestTimer.tsx and LiveSession.restEndsAt.
  const restEndsAt = live.restEndsAt ?? null;
  // THE CONDITIONING BLOCK (ruled 2026-09-01, built 2026-09-02): an exercise
  // that is a clock, not a strip. The big button opens the face; the face
  // writes one entry when it stops; the strip's place is taken by the
  // receipt. Two states, one exercise.
  const cond = exercise.cond ?? null;
  const [clockOpen, setClockOpen] = useState(false);

  // D5-C: "the session header shows projected finish against your budget the
  // whole time." Re-projected on a slow tick; only sessions that chose a
  // budget are paced at all -- aware, never nagged.
  const [, setPaceTick] = useState(0);
  useEffect(() => {
    if (!live.budgetMin) return;
    const t = setInterval(() => setPaceTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, [live.budgetMin]);
  const rack = rackFrom(gymSettings);
  const finishMs = live.budgetMin ? projectFinishMs(live, programDay, history, rack) : null;
  const over = live.budgetMin ? overBudgetMin(live, programDay, history, rack) : null;
  // A clock time reads the way every other one in the app does: 12-hour
  // with AM/PM, through the one formatter (Dave 2026-09-26).
  const clock = (ms: number) => { const d = new Date(ms); const t = fmtTime(`${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`); return `${t.time} ${t.ap}`; };
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
        return uniform ? `Rests ${rests[0]} → ${Math.max(REST_FLOOR_SEC, rests[0]! - 30)} Sec` : "Shorter Rests";
      })()
    : lever.key === "trim"
      ? (() => {
          const ex = programDay?.exercises.find((e) => e.id === lever.exerciseId);
          const planned = ex ? ex.sets.length - (live.trims?.[ex.id] ?? 0) : 0;
          return ex ? `Trim ${liftTitle(ex.name)} ${planned} → ${planned - 1} Sets` : `Trim ${liftTitle(lever.name)}`;
        })()
      : "Skip the Cool-Down";
  const leverVerb = !lever ? "" : lever.key === "restCut" ? "Shorten Rests" : lever.key === "trim" ? "Trim It" : "Skip It";
  const applyLever = () => {
    if (!lever || !leverPatch) return;
    const before: Partial<LiveSession> = { restCut: live.restCut, trims: live.trims, skipCool: live.skipCool };
    const undo = () => onFit(before);
    onFit(leverPatch);
    const message = lever.key === "restCut" ? "Rests Shortened Toward 45 Sec"
      : lever.key === "trim" ? `${liftTitle(lever.name)} Trimmed by a Set \u00b7 This Session Only`
      : "Cool-Down Skipped";
    showToast({ message, actionLabel: "Undo", onAction: undo });
  };
  // THE METER (2026-09-14, the reference's "4 of 17 planned working sets
  // logged"): working sets logged against the plan the session started with,
  // trims counted, warm-ups and drops excluded, across the whole day.
  const plannedFor = (e: LiveSession["exercises"][number]): number => {
    const pe = !e.custom && programDay ? programDay.exercises.find((x) => x.id === e.exerciseId) : undefined;
    return pe ? Math.max(0, pe.sets.length - (live.trims?.[pe.id] ?? 0)) : (e.plan?.length ?? 0);
  };
  // The same count as the strip's head (pass-off item 9), summed over the day.
  const dayCounts = live.exercises.filter((e) => !e.skipped).map((e) => setCount(e.sets, plannedFor(e)));
  const plannedTotal = dayCounts.reduce((n, c) => n + c.target, 0);
  const loggedTotal = dayCounts.reduce((n, c) => n + c.done, 0);
  // UP NEXT (2026-09-14): the next exercise in the day's order that still has
  // work in it, as one row under the strip. A group's own Next row wins.
  const upNextIdx = live.exercises.findIndex((e, i) => {
    if (i <= idx || e.skipped) return false;
    const c = setCount(e.sets, plannedFor(e));
    return c.done < Math.max(1, c.target);
  });
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
  const planComplete = !current.skipped && count.complete;
  // The load calculator opens at the weight in the fields (2026-09-26), the
  // one number this screen is about to write, never the plan's.
  const nextPlannedWeight = pending?.w ?? [...logged].reverse().find((x) => !x.warmup)?.w ?? 0;
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
    return setCount(e.sets, planned).complete;
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
    // On the Warm-Up side the first ghost is the warm-up card, and the plan's
    // rows follow it one place down.
    const g = i - logged.length - (warm && showNow ? 1 : 0);
    return g < 0 ? null : workLogged + g;
  };
  const lastAt = (i: number): SetEntry | undefined => {
    const pos = workPosAt(i);
    return pos === null ? undefined : lastHit?.sets[pos];
  };

  // UP-ATH-17 (2026-09-06): a group, not a pair. Two members behave exactly
  // as they did; three or more finally can exist. `partner` is the next
  // member in day order, which for a pair is the same exercise it always was.
  // THE SESSION'S OWN LIST, WITH TODAY'S PAIRS LAID OVER IT (2026-09-26,
  // was the day's list with the overlay, 2026-09-21). Every group question
  // below is asked of the exercises this session actually runs, in its own
  // order, so a swapped or added lift can be in a superset like any other
  // and the list below the strip can show every pair it holds.
  const dayEx = sessionExercises(live.exercises, dayExercises, live.groups);
  const me = dayEx.find((e) => e.id === exercise.id) ?? exercise;
  const labels = groupLabels(dayEx);
  const pairLabel = labels.get(exercise.id);
  const members = groupOf(me, dayEx).filter((e) => !e.filler);
  const filler = fillerFor(me, dayEx);
  const fillerLiveIdx = filler ? live.exercises.findIndex((e) => e.exerciseId === filler.id) : -1;
  // The lifts the picker offers: every one in the session that is not
  // skipped, once each, in the session's own order.
  const pickable = live.exercises.filter((e, i, all) => !e.skipped && all.findIndex((x) => x.exerciseId === e.exerciseId) === i);

  // D5-C: the rest-cut lever shortens every stated rest toward the floor,
  // live, without touching the program's own number.
  const restSecEff = (() => {
    const stated = exercise.restSec ?? 0;
    if (stated <= 0) return 0;
    return live.restCut ? Math.max(REST_FLOOR_SEC, stated - 30) : stated;
  })();
  // REST AFTER THE ROUND (Part 3 wave 2, 2026-09-13; every superset, Dave
  // 2026-09-26). In a group a set that leaves another member behind starts
  // no rest: the session offers that member, and the rest comes once the
  // round is complete, at the round rest the program set or, failing that,
  // the shortest rest among the members -- which is what the fit sheet's
  // superset lever has priced since D5-C (fit.ts). Counted from the live log
  // plus the set that just landed, since this runs in the same tick as the
  // log. Outside a group the lift's own rest runs after every set.
  const startRest = () => {
    if (exercise.kind === "done") return;
    if (members.length > 1) {
      const after = { ...loggedByExerciseId, [exercise.id]: (loggedByExerciseId[exercise.id] ?? 0) + 1 };
      if (nextInGroup(me, dayEx, after)) return;
      const stated = members.map((m) => m.restSec ?? 0).filter((r) => r > 0);
      const roundRest = roundRestFor(me, dayEx) || (stated.length ? Math.min(...stated) : 0);
      if (roundRest <= 0) return;
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
  const restLine = liftTitle(exercise.name) + (lastLogged?.warmup ? " Warm-Up" : lastLogged?.drop ? " Drop" : " Set " + (workNumbers(logged)[logged.length - 1] ?? 1));

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
      message: gone.length === 1 ? `${one} Deleted` : `${gone.length} ${many} Deleted`,
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
  // The bar's Next reads the whole rotation (nextTurnInGroup), so after A2's
  // set it goes back to A1 for the next round rather than down the list.
  const pairNextId = nextTurnInGroup(me, dayEx, loggedByExerciseId);
  const pairNextLiveIdx = pairNextId ? live.exercises.findIndex((e) => e.exerciseId === pairNextId && !e.skipped) : -1;
  // WHERE NEXT GOES (2026-09-26). Inside a superset the bar's Next used to
  // walk the day's order like everywhere else, so after A1's first set it
  // offered whatever sat below A1 in the list instead of A2, and the only
  // right door was a red line a screen up. The partner that is behind wins;
  // otherwise the next lift in the session with work left; otherwise Finish.
  const nextIdx = pairNextLiveIdx >= 0 ? pairNextLiveIdx : upNextIdx;
  const nextLabel = pairNextLiveIdx >= 0 ? `Next: ${labels.get(pairNextId!) ?? ""}`.trim() : nextIdx >= 0 ? "Next Exercise" : "Finish Workout";
  const goNext = () => (nextIdx >= 0 ? onMove(nextIdx) : onFinish());

  // UP-ATH-04 (2026-09-06): every Log Set gets the app's standard receipt
  // with an Undo, the same shape the swipe-delete above already has. A
  // fat-fingered tap on a gym floor cost a swipe and a hunt through the strip
  // before this. The Undo writes the strip as it was BEFORE this tap (the
  // snapshot rule, SHARED-F-03), against the exercise it belongs to, so
  // tapping it twice, or late, or after moving to the pair partner lands on
  // the same answer.
  //
  // ONE RECEIPT, ONE UNDO, BOTH WRITES (2026-10-17, Logging Standard rule 5).
  // Logging the first set at the suggested numbers also moves the program's
  // plan (the accept below), and that move used to announce itself on a
  // second toast with no Undo while this one put back only the set: the
  // plan stayed moved. The accept hands back the way to restore the plan,
  // the receipt says the plan moved, and its one Undo reverts both. A second
  // receipt would be a second thing to tap for one action.
  const receiptForLog = (entry: SetEntry, movedTo?: string, undoAccept?: (() => void) | null) => {
    const before = logged;
    const at = idx;
    const logged1 = exercise.kind === "done" ? `${liftTitle(exercise.name)} Logged` : `Logged ${entry.warmup ? "Warm-Up " : ""}${lineCase(formatSet(exercise, entry))}`;
    const said = undoAccept ? `${logged1} \u00b7 Plan Moved` : logged1;
    showToast({
      // In a superset the receipt says where the session just went, so the
      // screen changing under his thumb is never a surprise.
      message: movedTo ? `${said} \u00b7 Now ${movedTo}` : said,
      actionLabel: "Undo",
      onAction: () => { onSetLogged(before, at); undoAccept?.(); if (movedTo) onMove(at); },
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
  // Moving to another exercise opens ITS stored draft, if one was left
  // mid-typing (rule 8); a set landing on this one spent the draft, so the
  // fields fall back to the seed.
  const draftOwner = useRef<string | null>(null);
  useEffect(() => {
    const owner = `${current.exerciseId}\u0000${exercise.name}\u0000${exercise.kind}`;
    if (draftOwner.current === owner) putDraft(null);
    else { draftOwner.current = owner; setDraft(readNowDraft(nowStore)); }
    setExtraOpen(false);
  }, [current.exerciseId, exercise.name, exercise.kind, workLogged]);

  /** THE WORK | WARM-UP PILL (2026-09-29). One tap, and the fields open at the
   *  new side's own numbers: the plan's working set for Work, the next ramp
   *  step (or a sensible default) for Warm-Up. Whatever was typed on the side
   *  being left is dropped; the choice itself survives typing on this one. */
  const flipMode = (toWarm: boolean) => {
    if (toWarm === warm) return;
    putDraft({ ...fieldsOf(toWarm ? warmSeed : workSeed), warm: toWarm });
  };

  /** THE ONE WRITER (2026-09-26). The big red button and the tick on the
   *  Now row both land here, and it writes `pending`: the same entry the
   *  fields show and the button names. */
  /** CAN THE BUTTON WRITE (2026-10-17, defects B and H): the same answer
   *  disables the button and guards the write, so an empty set never lands. */
  const loggable = isLoggable(exercise.kind, style, pending);
  const log = () => {
    if (exercise.kind === "done") { const e: SetEntry = { id: newSetId(), done: true, state: "reported" }; onLog(e); receiptForLog(e); return; }
    if (!loggable) return;
    // THE PILL DECIDES THE FLAG (2026-09-29): what the button names is what is
    // written, warm-up or work.
    // Logged by his hand, so reported (Logging Standard addendum 1), and that
    // holds for a prefill logged untouched: on screen it was suggested; once
    // he logs it, it is his (Dave, 2026-10-17).
    // A CHANGED STEP IS HIS BASELINE (never argues twice): the first working
    // set carries the step the app filled in, or offered again after he
    // changed it once, whenever he logs a different weight, so the next
    // session offers that step instead of filling it in.
    const stepHere = !warm && workLogged === 0 && prefillOn && !!suggestion && suggestion.kind !== "scheme" && suggestion.next.w !== undefined;
    const turnedDown = stepHere && (pending?.w ?? 0) > 0 && Math.abs((pending?.w ?? 0) - suggestion.next.w!) >= 0.05;
    const e: SetEntry = { ...(pending ?? blankEntry()), id: newSetId(), ...(warm ? { warmup: true } : {}), state: "reported", ...(turnedDown ? { declined: { ...suggestion.next } } : {}) };
    // D6-A, the accept (2026-09-26): the program's plan moves only when the
    // first working set is logged AT the suggested numbers. Under prefill
    // (Dave, 2026-10-17) that is the step logged as it was filled in: an
    // untouched prefill counts as accepting it and updates the plan going
    // forward. Use puts them back after an edit; nothing else writes.
    // What comes back is the way to put the plan back, for the receipt's Undo.
    const undoAccept = !warm && suggestion && workLogged === 0 && e.w === suggestion.next.w && e.r === suggestion.next.r
      ? onAcceptSuggestion?.(suggestion) ?? null
      : null;
    onLog(e);
    putDraft(null);
    if (warm) {
      // A warm-up is not a turn in a superset and not a round: it rests like
      // the old ramp row did on a single lift, and hands nothing over.
      if (members.length <= 1) startRest();
      receiptForLog(e);
      return;
    }
    startRest();
    // BACK AND FORTH, ON ITS OWN (2026-09-27, Dave: "it does not
    // automatically go back and forth from exercises during supersets"). In a
    // group the next member's turn is taken for him the moment a set lands:
    // A1, then A2, then A3, then back to A1 for the next round. The rest runs
    // as it did (after the round), and a member with nothing left is passed
    // over. The Undo on the receipt puts him back on this lift.
    const after = { ...loggedByExerciseId, [exercise.id]: (loggedByExerciseId[exercise.id] ?? 0) + 1 };
    const turnId = members.length > 1 ? nextTurnInGroup(me, dayEx, after) : null;
    const turnIdx = turnId ? live.exercises.findIndex((x) => x.exerciseId === turnId && !x.skipped) : -1;
    const moved = turnIdx >= 0 && turnIdx !== idx;
    if (moved) onMove(turnIdx);
    receiptForLog(e, moved ? liftTitle(live.exercises[turnIdx]!.name) : undefined, undoAccept);
  };
  // LOG A DROP (Part 3 wave 2). A segment right after the last working set,
  // opened at that set's own numbers so the only thing to change is the
  // weight he actually dropped to (the chip is a tap away, and the brief's
  // 75 percent is not a training rule). No rest starts: a drop is the same
  // set continuing. Counted in tonnage, nowhere else.
  const lastWorkForDrop = exercise.kind === "weight_reps" ? [...logged].reverse().find((x) => !x.warmup && !x.drop && !x.skipped) : undefined;
  const logDrop = () => {
    if (!lastWorkForDrop) return;
    const e: SetEntry = { ...duplicateEntry(lastWorkForDrop), drop: true, state: "reported" };
    onLog(e);
    const before = logged;
    showToast({ message: "Logged a Drop \u00b7 Tap It to Set the Weight", actionLabel: "Undo", onAction: () => onSetLogged(before, idx) });
  };

  /** THE MORE SHEET'S LINES (2026-09-26): every secondary move on this lift,
   *  in one place, in the order they are reached for mid-set. Each is the
   *  same handler the old red line called; only the door moved. The superset
   *  is not here: its chip stays in the header (Dave, 2026-09-21 and
   *  2026-09-26), and Skip is offered only while nothing is logged, since
   *  skipping discards the sets that were done. */
  const moreActions: SheetAction[] = [
    ...(lastWorkForDrop && !cond ? [{ label: "Log a Drop", onClick: logDrop }] : []),
    ...(loadCalcFor(style) && !cond ? [{ label: loadCalcFor(style)!, onClick: () => setPlatesOpen(true) }] : []),
    // REST BY HAND (2026-10-17, defect J): with the rest preset Off nothing
    // ever started a timer. One line, four picks, the same deadline the
    // automatic rest writes.
    ...(!cond && restEndsAt == null ? [{ label: "Start Rest", onClick: () => setRestPickOpen(true) }] : []),
    // LOG BY VOICE (the Logging Standard, addendum 5): a deliberate "Log"
    // phrase, the set read back, his confirm, then the same receipt and Undo
    // as the big button. A test beside the button, never in its place.
    ...(showNow && !cond ? [{ label: "Log by Voice", onClick: () => setVoiceOpen(true) }] : []),
    ...(onAdjustTime ? [{ label: "Adjust Time", onClick: onAdjustTime }] : []),
    ...(onOpenHistory ? [{ label: "Exercise History", onClick: onOpenHistory }] : []),
    { label: "Swap Exercise", onClick: () => setSwapOpen(true) },
    ...(onUpdateProgram ? [{ label: "Also Update the Program", onClick: onUpdateProgram }] : []),
    ...(logged.length === 0 ? [{ label: "Skip This Exercise", onClick: onSkip }] : []),
  ];
  /** The Superset chip's two doors. Making a pair asks where it lives; a
   *  program pair asks the same on the way out; a pair made today is
   *  released on the spot, because there is nothing else it could mean. */
  /** "Every Push Day" is offered only when every picked lift is on the day. */
  const canLinkProgram = (ids: string[]) => !!onGroupProgram && ids.every((id) => dayExercises.some((e) => e.id === id));
  const dayWord = workoutTitle(programDay?.name ?? live.dayName);
  /** Breaking this lift's group: today's own is released on the spot, a
   *  program group asks today or every day. */
  const breakUp = onUngroup && pairLabel ? () => (isLiveGroup(live.groups, exercise.id) ? onUngroup("today") : setBreakAsk(true)) : null;
  const canSuperset = !!onGroupToday && pickable.length >= 2;
  const supersetChip = canSuperset ? () => setPickOpen(true) : null;
  const pickItems: PickItem[] = pickable.map((e) => ({ id: e.exerciseId, label: liftTitle(e.name), ...(labels.get(e.exerciseId) ? { sub: `Superset ${labels.get(e.exerciseId)}` } : {}) }));
  const nameOf = (id: string) => liftTitle(live.exercises.find((e) => e.exerciseId === id)?.name ?? "");
  const pickDone = (ids: string[]) => {
    setPickOpen(false);
    if (ids.length < 2) return;
    if (canLinkProgram(ids)) setScopeAsk(ids);
    else onGroupToday?.(ids);
  };
  /** The Set sheet's target and its writes, all through changeSets so a
   *  delete gets the app's standard receipt and Undo. */
  const openSet = openSetId ? logged.find((e) => e.id === openSetId) ?? null : null;
  const openSetNo = openSet ? workNumbers(logged)[logged.indexOf(openSet)] ?? 1 : 0;
  const patchSet = (id: string, p: Partial<SetEntry>) => changeSets(logged.map((e) => (e.id === id ? { ...e, ...p } : e)));
  /** THE SESSION'S PLAN, EDITED FROM A DASHED ROW (defect C). `exercise.sets`
   *  is this session's plan (GymFlow reads WorkoutExercise.plan into it), so
   *  the write goes back to that field on the live entry, and the program
   *  stays as it was. */
  const openPlan = openPlanId ? exercise.sets.find((e) => e.id === openPlanId) ?? null : null;
  const openPlanNo = openPlan ? planEx.sets.filter((e) => !e.warmup && !e.skipped).indexOf(openPlan) + 1 : 0;
  const writePlan = (next: SetEntry[]) => onFit({ exercises: live.exercises.map((e, i) => (i === idx ? { ...e, plan: next } : e)) });
  /** A dashed row's strip position, back to the planned set it stands for:
   *  the Now row is ghost[0] (and on the Warm-Up side is a warm-up, so the
   *  plan's rows sit one further down). */
  const openGhostAt = (pos: number) => {
    const g = pos - logged.length;
    const planned = planGhosts[warm ? g - 1 : g];
    if (planned) setOpenPlanId(planned.id);
  };
  /** The suggestion, folded into the Now row (2026-09-26). */
  const [whyOpen, setWhyOpen] = useState(false);
  /** The published rule (brief section 7), one tap from Why. */
  const [howOpen, setHowOpen] = useState(false);
  // THE OFFER AND ITS REASON (section 10, 2026-10-17). The reason is the line,
  // as facts: what he did last time, what that meant against the range, and
  // the step, plus the reps to expect after a jump. Use fills the fields and
  // hides once they already say it; under "prefill" they already do.
  const showSugg = !warm && !!suggestion && showNow;
  const suggests = showSugg && !((suggestion.next.w ?? 0) === (pending?.w ?? 0) && (suggestion.next.r ?? 0) === (pending?.r ?? 0));
  // FILLED IN, THE LINE SAYS WHY (2026-10-17, item 6 behind Dave's prefill
  // answer). With the step already in the fields, "Suggested 280 Lb × 6"
  // would say the fields twice. The line carries the because-clause and the
  // reps to expect instead, after Last and its Use Last, which is the one-tap
  // way back to what he did last time. Change the numbers and the line goes
  // back to Suggested with Use. Behind Why: his own last sets and the step.
  const filledIn = showSugg && prefillStep && !suggests;
  const because = filledIn ? suggestion.reason[1] : undefined;
  // WITH NO LAST LINE, THE WAY BACK IS STILL ONE TAP (Show Last off): Use and
  // the numbers the set would have opened at without the step.
  const revertTo = filledIn && !lastHit && seededWork && ((seededWork.w ?? 0) !== (suggestion.next.w ?? 0) || (seededWork.r ?? 0) !== (suggestion.next.r ?? 0)) ? seededWork : null;
  const nowExtra = suggestion && showSugg ? (
    <>
      {filledIn
        ? <>
            {because && <span className="fact est">{because}</span>}
            {suggestion.expect && <span className="fact est">{suggestion.expect}</span>}
            {revertTo && (
              <button type="button" className="set-last-act se-sugg-act" aria-label={`Use ${lineCase(formatSet(exercise, revertTo))}, without the step`}
                onClick={(e) => { e.stopPropagation(); putDraft({ ...fieldsOf(revertTo), warm: false }); }}><span className="act">{`Use ${lineCase(formatSet(exercise, revertTo))}`}</span></button>
            )}
          </>
        : <span className="fact est">{`Suggested ${lineCase(formatSet(exercise, suggestion.next))}`}</span>}
      {suggests && (
        <button type="button" className="set-last-act se-sugg-act" aria-label={`Use ${lineCase(formatSet(exercise, suggestion.next))}, the suggested set`}
          onClick={(e) => { e.stopPropagation(); putDraft({ ...fieldsOf({ id: "", ...suggestion.next }), warm: false }); }}><span className="act">Use</span></button>
      )}
      <button type="button" className="set-last-act se-sugg-act" aria-expanded={whyOpen} onClick={(e) => { e.stopPropagation(); setWhyOpen((o) => !o); }}><span className="act">{whyOpen ? "Hide Why" : "Why"}</span></button>
      {whyOpen && suggestion.basis && (
        // THE REASON, BEHIND WHY (section 10): his own last sets, what they
        // meant against the range, the step, and the reps to expect.
        <div className="ins-rows ins-ev se-sugg-why">
          <div className="facts">
            {suggestion.reason.filter((part) => part !== because).map((part) => <span className="fact est" key={part}>{part}</span>)}
            {suggestion.expect && !filledIn && <span className="fact est">{suggestion.expect}</span>}
            {suggestion.sets !== undefined && <span className="fact est">{lineCase(`${suggestion.sets} ${suggestion.sets === 1 ? "set" : "sets"}`)}</span>}
            {suggestion.addSet && <span className="fact est">Room for One More Set This Week</span>}
            {suggestion.addSet && suggestion.addSetWhy?.map((part) => <span className="fact est" key={part}>{part}</span>)}
          </div>
          <div className="ins-row"><span className="ins-k">Why</span><span className="ins-sub">{suggestion.why}</span></div>
          <div className="ins-row"><span className="ins-k">Exercise</span><span className="ins-sub">{suggestion.basis.variant}</span></div>
          <div className="ins-row"><span className="ins-k">Read</span><span className="ins-sub">{suggestion.basis.source}</span></div>
          <div className="ins-row"><span className="ins-k">Sets</span><span className="ins-sub">{suggestion.basis.role}</span></div>
          <div className="ins-row"><span className="ins-k">Range</span><span className="ins-sub">{suggestion.basis.range}</span></div>
          <div className="ins-row"><span className="ins-k">Increment</span><span className="ins-sub">{suggestion.basis.increment}</span></div>
          <div className="ins-row"><span className="ins-k">Marks</span><span className="ins-sub">{suggestion.basis.marks}</span></div>
          {/* THE RULE ITSELF (brief section 7): the same words every session, one tap away from the reason. */}
          <button type="button" className="set-last-act se-sugg-act" aria-haspopup="dialog" onClick={(e) => { e.stopPropagation(); setHowOpen(true); }}><span className="act">How Suggestions Work</span></button>
        </div>
      )}
    </>
  ) : warm && warmComputed && showNow && warmSeed ? (
    // A COMPUTED WARM-UP SAYS SO (defect I): with no warm-ups of his own to
    // open on, the ramp's step is a suggestion, in the suggestion's own ink.
    <span className="fact est">{`Suggested ${lineCase(formatSet(exercise, warmSeed))}`}</span>
  ) : null;
  // THE CURSOR IN THE NOW CARD (Dave, 2026-10-17, answers 1 and 6): focused
  // and ready to type on every new set, lift and side, the number selected
  // while it is still the app's, so changing it is type and Return; numbers
  // he was already typing (a draft brought back after a kill) keep the
  // cursor without being selected. Not while any sheet of this screen is up.
  const untouched = !draft || (["w", "r", "v", "t"] as const).every((k) => (draft[k] ?? "") === (fieldsOf(seed)[k] ?? ""));
  const sheetUp = openSetId !== null || openPlanId !== null || restPickOpen || addPickOpen || addName !== null || pickOpen || scopeAsk !== null || breakAsk || cancelAsk || swapOpen || platesOpen || clockOpen || howOpen || voiceOpen || moreOpen || loadAt !== null || muscleRole !== null;
  const nowFocus = showNow && !sheetUp ? { key: `${exercise.id}:${logged.length}:${warm ? "warm" : "work"}`, select: untouched } : undefined;
  /** Match hides once the fields already say what last time did. */
  const nowLast = lastHit && !warm ? lastAt(logged.length) : undefined;
  const nowMatchesLast = !!nowLast && (nowLast.w ?? 0) === (pending?.w ?? 0) && (nowLast.r ?? 0) === (pending?.r ?? 0);

  return (
    // .wo-screen: the board's geometry (Dave's approved board 2026-10-16; the 2026-10-17 correction "the spacing and
    // format is all messed up"), scoped to the six workout screens in ruled.css.
    <div className="screen ruled health-ruled screen-session wo-screen">
      <div className="nav-bar">
        {/* CANCEL WORKOUT IS AS FAR FROM LOG AS THE SCREEN ALLOWS (Dave
            2026-10-09, pass-off item 12: "Cancel Workout sits right above the
            Log button"). It is the top bar's leading word, as on mockup 4,
            and still asks first; Pause beside Finish is the way out that
            keeps the workout, which is all the back chevron here ever did. */}
        {onCancel
          ? <button type="button" className="nav-action-text nav-action-quiet" aria-label="Cancel Workout" onClick={() => setCancelAsk(true)}>Cancel</button>
          : <button className="nav-back" aria-label="Back" onClick={onBack}></button>}
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

      {/* .se-head: on the board this is no card at all, the progress line and the name sit on the page (screen 1); the
          .wo-screen rules take the card's chrome off it. */}
      <div className="pad-x"><div className="card pad se-head">
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
          {/* ONE PROGRESS LINE (Dave's board, 2026-10-17; defect O): the dots,
              the position, the clock and the sets, once each. The "1/3"
              count and the meter that said the same things again are gone.
              H-52: the clock is time actually in the gym; parked time is
              excluded, and once there is any the position fact says so on
              screen, not only in the clock's VoiceOver label. */}
          <span className="facts se-elapsed">
            <span className="fact">{`Exercise ${idx + 1} of ${live.exercises.length}`}{(live.pausedMs ?? 0) > 0 ? ", Paused Time Excluded" : ""}</span>
            <ElapsedClock live={live} />
            {plannedTotal > 0 && <span className="fact lime">{lineCase(`${loggedTotal} of ${plannedTotal} sets`)}</span>}
          </span>
          {pairLabel && <span className="se-chip se-chip-pair">{pairLabel}</span>}
          {gameLine && <span className="se-chip se-chip-game">{gameLine}</span>}
        </div>
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
        {/* THE SUPERSET, ONE TAP BETWEEN ITS LIFTS (2026-09-27, Dave: "or at
            least have a button to easily swap"). Every member of this lift's
            group, labelled and named, the one on screen filled; tap another
            and the session goes there. The rotation does this on its own
            after each set; this is for when he wants to go out of turn. */}
        {members.length > 1 && (
          <div className="se-chips se-turns" role="group" aria-label="Superset">
            {members.map((m) => {
              const li = live.exercises.findIndex((x) => x.exerciseId === m.id);
              const on = m.id === exercise.id;
              return (
                <button type="button" key={m.id} className={"se-chip se-chip-pair se-chip-door" + (on ? " on" : "")} aria-pressed={on}
                  onClick={() => { if (!on && li >= 0) onMove(li); }}>
                  <em>{labels.get(m.id) ?? ""}</em>{liftTitle(m.name)}
                </button>
              );
            })}
          </div>
        )}
      </div></div>

      {/* THE CATCH-UP BANNER (D5-C): "Fall behind and one quiet banner
          offers the next lever." One offer, one loosener, no ceremony. */}
      {over != null && over >= 3 && (
        <div className="pad-x"><div className="catchup banner-warn">
          <div className="grow">
            <div className="catchup-t">{lineCase(`${spanLabel(over)} over`)}</div>
            {lever && (
              <div className="facts">
                <span className="fact">{leverName}</span>
                {leverSave > 0 && <span className="fact est">{`Saves ${spanLabel(leverSave)}`}</span>}
              </div>
            )}
          </div>
          {lever && <button className="pill-act" onClick={applyLever}>{leverVerb}</button>}
          <button className="pill-act pill-quiet" onClick={() => onFit({ budgetMin: (live.budgetMin ?? 0) + 5 })}>+5 Min</button>
        </div></div>
      )}

      {/* THE SUGGESTION (D6-A) rides inside the Now row now (2026-09-26,
          `nowExtra` above): never a silent edit, the offer still names its
          evidence behind Why, and Use only fills the fields. */}

      {/* GROUPS (catalog §4.2) and SUPERSET FLOW (D8-C): whose turn it is
          rides the log bar's own Next button now ("Next · A2", 2026-09-26),
          not a red line of its own up here. */}

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
        {!cond && !current.skipped && planEx.sets.length > 0 && <span className="n">{lineCase(`${count.done} of ${count.target} ${noun}`)}</span>}
        {/* ONE OVERFLOW FOR THE LIFT'S OTHER MOVES (2026-09-26). The head
            action slot every gym page already uses (Manage on the program
            page), the capsule rung, and the app's own row-action sheet. */}
        {!current.skipped && moreActions.length > 0 && (
          <button type="button" className="pill-act se-more" aria-haspopup="dialog" onClick={() => setMoreOpen(true)}>More</button>
        )}</div>
      <div className="pad-x">
        {current.skipped ? (
          <div className="card list-card-ruled"><div className="row"><div className="row-grow"><div className="conn-name">Skipped</div></div></div></div>
        ) : cond ? (
          <CondReceipt
            exercise={exercise}
            entries={logged}
            onChange={changeSets}
            lastLine={header ? `Last: ${header.last} on ${monthDay(header.date)}` : null}
          />
        ) : (
          <SetStrip
            kind={exercise.kind}
            unit={exercise.unit}
            timeUnit={exercise.timeUnit}
            style={style}
            entries={logged}
            ghost={ghost}
            // The Now row is the only row that logs, by the red button, and
            // that is log() (2026-09-26). A warm-up is a side of it, not a row
            // of its own (2026-09-29).
            editableGhosts
            nowDraft={fields}
            onNowDraft={(d) => putDraft({ ...d, warm })}
            // Return in a field is the Log button (Logging Standard rule 4).
            onNowLog={log}
            nowFocus={nowFocus}
            nowWarm={warm}
            onNowMode={flipMode}
            nowNo={count.nowNo}
            rack={exRack}
            nowExtra={nowExtra}
            nowMatchesLast={nowMatchesLast}
            onOpenSet={setOpenSetId}
            onOpenGhost={openGhostAt}
            canAdd={false}
            onChange={changeSets}
            prAt={celebrations ? (i) => isSessionPR(history, exercise, exercise.kind, logged, i) : undefined}
            moveTracking
            lastFor={lastHit ? (i) => { const s = lastAt(i); return s ? lineCase(formatSet(lastHit.fx, s)) : null; } : undefined}
            // Match puts last time's numbers IN THE FIELDS (2026-09-26); the
            // tick or the bar then logs them like any other set, so there is
            // one door that writes and it always shows its number first.
            onMatchLast={lastHit ? (i) => { const src = lastAt(i); if (src) putDraft({ ...fieldsOf(entryFrom(src)), warm: false }); } : undefined}
          />
        )}
      </div>

      {/* REST TIMER + FILLER (catalog §4.3, §4.2). RIGHT UNDER THE NOW CARD
          (Dave 2026-10-17, defect J; was under the whole list since
          2026-09-26). Nothing ABOVE the Now row changes height when a set
          lands, and this sits below it, so the row does not jump; it is in
          sight while he rests instead of a screen down. key={restEndsAt}
          remounts the timer clean on every new deadline instead of it trying
          to track which set it belongs to. */}
      {restEndsAt != null && (
        <RestTimer
          key={restEndsAt}
          endsAt={restEndsAt}
          fillerName={filler?.name}
          onLogFiller={filler && fillerLiveIdx >= 0 ? () => { onMove(fillerLiveIdx); endRest(); } : undefined}
          onDismiss={endRest}
          notifyLine={restNotify ? restLine : undefined}
          onExtend={() => { onFit({ restEndsAt: restEndsAt + 30_000 }); showToast({ message: "Rest Extended 30 Sec" }); }}
        />
      )}

      {/* THE LIFT'S FACTS AND DOORS, UNDER THE WORK (Dave 2026-10-17, section
          8: the working set and the Log button sit at the top, above history,
          chips and warm-up blocks). What it trains, what it loads with, the
          superset door, and last time's numbers were the header's; they are
          the card under the strip now, and the header keeps the position, the
          clock and the name. */}
      {/* THE SECONDARY ZONE (Dave's board, 2026-10-17): Details, the four
          chips, the warm-up card, then Best and Last. All of it under the
          work and the Log bar. */}
      {!current.skipped && (muscles || onSetLoad || style.equipment || header || showWarm) && (
        <div className="pad-x"><div className="eyebrow se-details">Details</div></div>
      )}
      {(muscles || onSetLoad || style.equipment) && !current.skipped && (
        <div className="pad-x"><div className="card pad se-facts">
        {/* WHAT IT TRAINS, ON THE EXERCISE (Dave 2026-10-09, mockup 3:
            "equipment selector + secondary muscles"). Neutral chips, not
            lime: on this screen lime means logged, and a muscle is not. Each
            is a door to its own picker (mockup 8). The words are the mockup's:
            Primary and Secondary. */}
        {muscles && (
          <div className="se-chips">
            {muscles.primary.length === 0 && muscles.secondary.length === 0 ? (
              <button type="button" className="se-chip se-chip-when se-chip-door" disabled={!onSetMuscles} onClick={() => setMuscleRole("primary")}>
                <em>Muscles</em>Not Set
              </button>
            ) : (
              <>
                <button type="button" className="se-chip se-chip-when se-chip-door" disabled={!onSetMuscles} onClick={() => setMuscleRole("primary")}>
                  <em>Primary</em>{muscles.primary.length ? muscles.primary.map((m) => MUSCLE_LABEL[m]).join(", ") : "Not Set"}
                </button>
                <button type="button" className="se-chip se-chip-when se-chip-door" disabled={!onSetMuscles} onClick={() => setMuscleRole("secondary")}>
                  <em>Secondary</em>{muscles.secondary.length ? muscles.secondary.map((m) => MUSCLE_LABEL[m]).join(", ") : "None"}
                </button>
              </>
            )}
          </div>
        )}
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
            <button type="button" className="se-chip se-chip-pair se-chip-door" onClick={() => setLoadAt(idx)}>
              <em>{style.equipment ? weightLabel(style) : "Equipment"}</em>
              {style.equipment ? styleSummary(style) : "Not Set"}
            </button>
            {/* The per-side reading is said by the Now row's own field
                ("Reps Per Side") and set in the Equipment sheet, so it is
                no longer a second chip here (2026-09-26). */}
            {/* SUPERSET, WHERE THE LIFT IS (Dave, 2026-09-21: "There's also
                no superset buttons anywhere in the workout pages"; kept on
                the screen 2026-09-26). One chip, two states: Add pairs this
                lift with the next in the session, Break Up undoes it, and
                each asks whether it is for today or for every one of this
                day. It is the ONLY superset door; the More sheet does not
                repeat it. */}
            {supersetChip && (
              <button type="button" className="se-chip se-chip-pair se-chip-door" onClick={supersetChip}>
                <em>Superset</em>{pairLabel ? "Edit" : "Add"}
              </button>
            )}
          </div>
        ) : style.equipment && (
          <div className="se-chips"><span className="se-chip se-chip-pair"><em>{weightLabel(style)}</em>{styleSummary(style)}</span></div>
        )}
        {/* THE HISTORY, AS FACTS RATHER THAN A PARAGRAPH. This was one grey
            run-on: every set from last time, then the date, then the best,
            all joined by middots and wrapping to three lines. Best is the
            number that matters mid-lift, so it leads, in the ramp's ink; last
            time and its date follow as their own chips. */}
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
      {/* THE SKIP IS THE GROUP'S LABEL ROW'S (Dave 2026-10-05, locked): Skip the Warm-Up and Skip the Cool-Down were rows at the
          foot of their cards. Each card's label row carries it at the right, the one capsule a group's actions wear. */}
      {showWarm && (
        <div className="pad-x"><div className="card list-card-ruled banner-warn">
          <div className="grp"><div className="eyebrow eyebrow-warn">Warm-Up{programDay?.warmUpMin ? ` · ${spanLabel(programDay.warmUpMin)}` : ""}</div>
            <button type="button" className="see-all pill-action" aria-label="Skip the Warm-Up" onClick={() => onFit({ warmSkipped: true })}>Skip</button>
          </div>
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
        </div></div>
      )}

      {/* BEST AND LAST (Dave's board, 2026-10-17): the standing best in the
          best's purple, last time's date in teal, and every set of that
          session as its own teal chip. Under the warm-up card, where history
          belongs: nothing the lifter reads mid-set. */}
      {(header || exercise.note) && !current.skipped && (
        <div className="pad-x"><div className="card pad se-hist">
          {header && (
            <div className="se-chips">
              {header.best && <span className="se-chip se-chip-best"><em>Best</em>{lineCase(header.best)}</span>}
              <span className="se-chip se-chip-last"><em>Last</em>{monthDay(header.date)}</span>
            </div>
          )}
          {header && lastHit && lastHit.sets.length > 0 && (
            <div className="se-chips">
              {lastHit.sets.map((s) => <span className="se-chip se-chip-last" key={s.id}>{lineCase(formatSet(lastHit.fx, s))}</span>)}
            </div>
          )}
          {exercise.note && <div className="se-note">{exercise.note}</div>}
        </div></div>
      )}

      {/* THE COOL-DOWN (D3-C): offered when the work is done, skippable as
          a unit. Skipping here is the same lever the fit sheet offers. */}
      {showCool && (
        <div className="pad-x"><div className="card list-card-ruled banner-cool">
          <div className="grp"><div className="eyebrow eyebrow-cool">Cool-Down{programDay?.coolDownMin ? ` · ${spanLabel(programDay.coolDownMin)}` : ""}</div>
            <button type="button" className="see-all pill-action" aria-label="Skip the Cool-Down" onClick={() => onFit({ coolSkipped: true })}>Skip</button>
          </div>
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
        </div></div>
      )}

      {/* SUPERSET, WHERE THE LIFTS ARE (2026-09-27, Dave: "It needs to be easy
          and obvious"). The list of every lift in the session carries the
          door on its own head, the capsule rung every gym page uses. */}
      {/* Superset and Add Exercise ride the Log bar's second row now (Dave's
          board, 2026-10-17), not this head. */}
      <div className="sh2 sh2-quiet"><span className="t">This Workout</span></div>
      <div className="pad-x"><div className="card list-card-ruled">
        {live.exercises.map((e, i) => (
          // RED IS A VERB: "you are here" is a fact, not an action, so the
          // current exercise marks itself with weight and a quiet Now pill,
          // never a red name (spec sweep 2026-09-01).
          <div className={"row" + (labels.has(e.exerciseId) ? " se-grp" : "")} role="button" tabIndex={0} key={e.exerciseId + i} onClick={() => onMove(i)}>
            <div className="row-grow">
              <div className="conn-name truncate">{liftTitle(e.name)}</div>
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
              {/* A SUPERSET READS AS ONE (2026-09-26, Dave: "Superset linking
                  between exercises is broken"). The list never said which
                  lifts were paired. The A1/A2 mark rides the facts line in
                  the pair hue on its own fill, and the row wears the same
                  hue as a rule down its edge, so the members read as a
                  group at a glance; the state fact stays the row's one grey. */}
              <div className="facts">
                {labels.has(e.exerciseId) && <span className="se-chip se-chip-pair">{labels.get(e.exerciseId)}</span>}
                {/* WHAT IT TRAINS AND WHAT IT IS LIFTED WITH (Dave 2026-10-09,
                    mockup 6, "Chest, Dumbbell"). The equipment is the violet
                    door the header's own equipment chip has always been, so it
                    can be answered from the list without leaving the exercise
                    on screen (item 5); the muscle is the row's one grey, after
                    the chip so the facts line draws its own dot. */}
                {onSetLoad && e.kind === "weight_reps" && (() => {
                  const st = i === idx ? style : loadStyleOf(e);
                  return (
                    <button type="button" className="se-chip se-chip-pair se-chip-door"
                      aria-label={`Equipment for ${liftTitle(e.name)}: ${st.equipment ? EQUIPMENT_LABEL[st.equipment] : "Not Set"}`}
                      onClick={(ev) => { ev.stopPropagation(); setLoadAt(i); }}>
                      {st.equipment ? EQUIPMENT_LABEL[st.equipment] : <><em>Equipment</em>Not Set</>}
                    </button>
                  );
                })()}
                {(() => { const m = rowMuscle(e); return m ? <span className="fact">{MUSCLE_LABEL[m]}</span> : null; })()}
                {/* ONLY A STATE THAT MEANS SOMETHING (Dave 2026-10-09, item
                    10: "Every row says TO DO in gray, that's noise"). Logged
                    and skipped say so; untouched says nothing. */}
                {e.skipped
                  ? <span className="fact st amber">Skipped</span>
                  : e.sets.length > 0
                    ? <span className="fact lime">{lineCase(`${e.sets.length} ${e.sets.length === 1 ? "set" : "sets"}`)}</span>
                    : null}
              </div>
            </div>
            {/* NOW is the one row you are standing on. It was .pill-subdued,
                which is the app's neutral grey pill, so it read as a disabled
                control rather than a position. It takes the ramp's cyan. */}
            {i === idx ? <span className="se-now">Now</span> : CHEV}
          </div>
        ))}
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
        // THE FIRST TOUCH ON LOG MUST NOT MOVE THE BAR (2026-10-17, defect D).
        // The bar rides the visual viewport; with the keyboard up, a press on
        // Log blurred the field first, the keys collapsed, the bar jumped
        // down, and the click landed on the stepper under where Log had been.
        // Keeping the pointer-down from taking focus keeps the keyboard, the
        // bar and the button where they were until the click lands.
        <div className="logbar" ref={logbarRef} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}>
          <div className="logbar-main">
          {/* THE SECOND HALF OF THE BAR (2026-09-17). Once the plan is done,
              logging another set is the unusual move and moving on is the
              common one, so they swap places: the extra set keeps a secondary
              button (it is still one tap, nothing is taken away) and the
              primary becomes what you actually meant. It says where it goes,
              because "Done" alone on the last exercise of a session would be
              a button that silently ends the workout. */}
          {planComplete && !extraOpen && (
            cond
              ? <button className="btn btn-secondary btn-lg" onClick={() => setClockOpen(true)}>Run It Again</button>
              : <button className="btn btn-secondary btn-lg" onClick={() => setExtraOpen(true)}>Add a Set</button>
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
              and is unchanged. Inside a superset it names the partner's
              turn ("Next · A2") and goes there (2026-09-26). */}
          {(!planComplete || extraOpen) && logged.length > 0 && !cond && (
            <button className="btn btn-secondary btn-lg" onClick={goNext}>{nextLabel}</button>
          )}
          {planComplete && !extraOpen
            ? <button className="btn btn-primary btn-launch btn-lg" onClick={goNext}>{nextLabel}</button>
            : cond
              ? <button className="btn btn-primary btn-launch btn-lg" onClick={() => setClockOpen(true)}>
                  {logged.length === 0 ? "Start the Clock" : "Run It Again"}
                </button>
              : <button className="btn btn-primary btn-launch btn-lg" onClick={log} disabled={!loggable}>
                  {loggingBlocker(exercise.kind, style, pending) ?? logButtonLabel({ ...exercise, sided: style.sided }, pending, warm)}
                </button>}
          </div>
          {/* THE ROW UNDER LOG (Dave's board, 2026-10-17): Superset and Add
              Exercise, the two moves on the whole workout, as the capsules
              every non-primary control is (§AL). "Add Exercise" on the face
              (Dave 2026-10-09, pass-off item 11). */}
          <div className="logbar-row">
            {canSuperset && <button type="button" className="pill-act se-sup" aria-haspopup="dialog" onClick={() => setPickOpen(true)}>Superset</button>}
            <button type="button" className="pill-act se-add" onClick={() => (library.length > 0 ? setAddPickOpen(true) : setAddName(""))}>Add Exercise</button>
          </div>
        </div>
      )}

      {howOpen && <HowSuggestionsSheet onClose={() => setHowOpen(false)} />}
      {voiceOpen && (
        // The sheet closes before it hands the set over, so the receipt's
        // Undo is never painted behind its scrim. The write is the big
        // button's: the set, the rest, the one receipt with Undo.
        <VoiceSetSheet name={liftTitle(exercise.name)} kind={exercise.kind} unit={exercise.unit} timeUnit={exercise.timeUnit} sided={style.sided}
          lastSet={[...logged].reverse().find((x) => !x.warmup)}
          draftScope={{ startedAt: live.startedAt, exerciseId: exercise.id }}
          onClose={() => setVoiceOpen(false)}
          onLog={(e) => { onLog(e); putDraft(null); if (!e.warmup && !e.drop) startRest(); receiptForLog(e); }} />
      )}
      {moreOpen && (
        <ActionSheet title={liftTitle(exercise.name)} actions={moreActions} onClose={() => setMoreOpen(false)} />
      )}
      {pickOpen && onGroupToday && (
        <PickSheet
          title="Superset"
          items={pickItems}
          multi
          minPick={2}
          initial={pairLabel ? members.map((m) => m.id) : [exercise.id]}
          confirmLabel={(n) => (n < 2 ? "Pick at Least Two" : n === 2 ? "Superset These Two" : lineCase(`Superset these ${n}`))}
          onPick={pickDone}
          onCancel={() => setPickOpen(false)}
          {...(breakUp ? { extraAction: { label: "Break Up the Superset", onClick: () => { setPickOpen(false); breakUp(); } } } : {})}
        />
      )}
      {scopeAsk && onGroupToday && (
        <ActionSheet
          title={lineCase(`Superset ${scopeAsk.map(nameOf).join(" + ")}`)}
          actions={[
            { label: "Just This Workout", onClick: () => onGroupToday(scopeAsk) },
            { label: `Every ${dayWord}`, onClick: () => onGroupProgram!(scopeAsk) },
          ]}
          onClose={() => setScopeAsk(null)}
        />
      )}
      {cancelAsk && onCancel && (
        <ActionSheet
          title={loggedTotal > 0 ? lineCase(`Cancel ${workoutTitle(live.dayName)}? ${loggedTotal} ${loggedTotal === 1 ? "set" : "sets"} will not be saved`) : lineCase(`Cancel ${workoutTitle(live.dayName)}?`)}
          actions={[{ label: "Cancel Workout", onClick: onCancel, destructive: true }]}
          dismissLabel="Keep Going"
          onClose={() => setCancelAsk(false)}
        />
      )}
      {breakAsk && onUngroup && (
        <ActionSheet
          title="Break Up the Superset"
          actions={[
            { label: "Just This Workout", onClick: () => onUngroup("today") },
            { label: `Every ${dayWord}`, onClick: () => onUngroup("program") },
          ]}
          onClose={() => setBreakAsk(false)}
        />
      )}
      {openSet && (
        <SetSheet
          title={openSet.warmup ? "Warm-Up" : openSet.drop ? "Drop" : `Set ${openSetNo}`}
          kind={exercise.kind}
          fields={fieldsFor(exercise.kind, { ...style, unit: exercise.unit })}
          entry={openSet}
          moveTracking
          onSave={(p) => { patchSet(openSet.id, p); setOpenSetId(null); }}
          onSkip={() => { patchSet(openSet.id, { skipped: !openSet.skipped, done: false }); setOpenSetId(null); }}
          onDuplicate={() => { const i = logged.indexOf(openSet); changeSets([...logged.slice(0, i + 1), duplicateEntry(openSet), ...logged.slice(i + 1)]); setOpenSetId(null); }}
          onDelete={() => { changeSets(logged.filter((e) => e.id !== openSet.id)); setOpenSetId(null); }}
          onCancel={() => setOpenSetId(null)}
        />
      )}
      {openPlan && (
        <SetSheet
          title={`Set ${openPlanNo}`}
          kind={exercise.kind}
          fields={fieldsFor(exercise.kind, { ...style, unit: exercise.unit, rack: exRack })}
          entry={openPlan}
          planned
          onSave={(p) => { writePlan(exercise.sets.map((e) => (e.id === openPlan.id ? { ...e, ...p } : e))); setOpenPlanId(null); }}
          onDuplicate={() => { const i = exercise.sets.indexOf(openPlan); writePlan([...exercise.sets.slice(0, i + 1), duplicateEntry(openPlan), ...exercise.sets.slice(i + 1)]); setOpenPlanId(null); }}
          onDelete={() => { writePlan(exercise.sets.filter((e) => e.id !== openPlan.id)); setOpenPlanId(null); }}
          onCancel={() => setOpenPlanId(null)}
        />
      )}
      {restPickOpen && (
        <ActionSheet
          title="Start Rest"
          actions={[60, 90, 120, 180].map((sec) => ({
            label: sec % 60 === 0 ? `${sec / 60} Min` : `${Math.floor(sec / 60)} Min ${sec % 60} Sec`,
            onClick: () => onFit({ restEndsAt: Date.now() + sec * 1000 }),
          }))}
          onClose={() => setRestPickOpen(false)}
        />
      )}
      {swapOpen && (
        <LibraryPickSheet
          title="Swap For"
          library={library}
          kindFilter={exercise.kind}
          onAdopt={onAdopt}
          // The sheet closes BEFORE the swap writes: its receipt carries an
          // Undo, and a toast raised under an open sheet is painted behind
          // the scrim where the Undo cannot be tapped.
          onPick={(entry) => { setSwapOpen(false); onSwap({ exerciseKey: entry.exerciseKey, name: entry.name, kind: entry.kind, unit: entry.unit, timeUnit: entry.timeUnit }); }}
          onFreeText={(text) => { setSwapOpen(false); onSwap({ exerciseKey: newExerciseKey(), name: text, kind: exercise.kind, unit: exercise.unit, timeUnit: exercise.timeUnit }); }}
          onCancel={() => setSwapOpen(false)}
        />
      )}
      {platesOpen && (
        <PlateSheet total={nextPlannedWeight} unit={exercise.unit} rack={rack} style={style} onClose={() => setPlatesOpen(false)} />
      )}
      {loadAt != null && onSetLoad && live.exercises[loadAt] && (
        <LoadSheet
          name={loadAt === idx ? exercise.name : live.exercises[loadAt]!.name}
          initial={loadAt === idx ? style : loadStyleOf(live.exercises[loadAt]!)}
          onSave={(next) => { onSetLoad(next, loadAt); setLoadAt(null); }}
          onCancel={() => setLoadAt(null)}
        />
      )}
      {muscleRole && muscles && onSetMuscles && (
        <MusclePickSheet
          name={exercise.name}
          role={muscleRole}
          initial={muscles}
          onSave={(next) => { onSetMuscles(next); setMuscleRole(null); }}
          onCancel={() => setMuscleRole(null)}
        />
      )}
      {/* ADD EXERCISE, THE LIBRARY FIRST (2026-10-17, defect K; the empty
          workout's own door, EmptyWorkoutScreen). A lift he has done arrives
          with its key, its unit, its convention and its last strip, so the
          sets file under the history it already has; only a name the library
          has never seen opens the full sheet, prefilled with that name. */}
      {addPickOpen && (
        <LibraryPickSheet
          title="Add Exercise"
          library={library}
          onAdopt={onAdopt}
          onPick={(entry) => {
            setAddPickOpen(false);
            const { id: _id, ...draft } = exerciseFromEntry(entry, readClassStore(gymSettings.classByKey, gymSettings.muscleByKey), (prefix) => prefix + newSetId(), { mintKey: false });
            onAddMidSession(draft, !!programDay && addToDay);
          }}
          onFreeText={(text) => { setAddPickOpen(false); setAddName(text); }}
          onCancel={() => setAddPickOpen(false)}
        />
      )}
      {addName !== null && (
        <ExerciseSheet
          mode="new"
          initial={addName ? { id: "", name: addName, kind: "weight_reps", sets: uniformStrip(3, { r: 8 }) } : undefined}
          library={library}
          history={history}
          alsoOnDay={programDay ? { dayName: programDay.name, value: addToDay, onChange: setAddToDay } : undefined}
          // Starters in its typeahead adopt through the flow's one door (Dave
          // 2026-10-17: "It should be all exercises. Stock and custom").
          onAdopt={onAdopt}
          onSave={(draft) => { onAddMidSession(draft, !!programDay && addToDay); setAddName(null); }}
          onCancel={() => setAddName(null)}
        />
      )}
    </div>
  );
}
