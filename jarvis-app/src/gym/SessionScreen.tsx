import { useEffect, useState } from "react";
import type { Exercise, MeasureKind, ProgramDay, SetEntry, Workout } from "./types";
import type { LiveSession } from "./liveSession";
import { overBudgetMin, nextLever, projectFinishMs } from "./fit";
import { REST_FLOOR_SEC } from "./pacing";
import { logButtonLabel, plannedEntryAt, entryNoun, formatSet } from "./measures";
import { newSetId, blankEntry, duplicateEntry, entryFrom } from "./strip";
import { isSessionPR, lastHeader, lastSessionFor } from "./prs";
import { readGymSettings, rackFrom } from "./settings";
import { rampFor } from "./ramp";
import { suggestFor, type Suggestion } from "./progression";
import { pairLabels, fillerFor, nextInPair } from "./pairs";
import type { LibraryEntry } from "./library";
import { newExerciseKey } from "./library";
import SetStrip from "./SetStrip";
import RestTimer from "./RestTimer";
import LibraryPickSheet from "./LibraryPickSheet";
import ExerciseSheet from "./ExerciseSheet";
import MusicChip from "../music/MusicChip";
import { showToast } from "../shared/toast";
import { monthDay } from "../money/bills";

const CHEV = (
  <div className="chev" />
);

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
  onSwap,
  onAddMidSession,
  onAcceptSuggestion,
  onFit,
  onFinish,
  onBack,
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
  onSetLogged: (sets: SetEntry[]) => void;
  onSkip: () => void;
  onMove: (idx: number) => void;
  onSwap: (sub: { exerciseKey?: string; name: string; kind: MeasureKind; unit?: string; timeUnit?: string }) => void;
  onAddMidSession: (draft: Omit<Exercise, "id">) => void;
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
  onFinish: () => void;
  onBack: () => void;
}) {
  const idx = live.idx;
  const current = live.exercises[idx]!;
  const logged = current.sets;
  const noun = entryNoun(exercise.kind);
  // LAST TIME, ALWAYS IN SIGHT -- D2 (Training Catalog V2, approved
  // 2026-08-31). One header line (whole last session, date, all-time best)
  // plus a per-position reference under every chip, with tap-to-match on
  // the ghosts. Defaults ON; the switch lives in Settings → Training.
  const showLast = readGymSettings().showLast;
  const header = showLast ? lastHeader(history, exercise.name, exercise.kind) : null;
  const lastHit = showLast ? lastSessionFor(history, exercise.name, exercise.kind) : null;
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
  const workLogged = logged.filter((s) => !s.warmup).length;
  const rampLeft = ramp.slice(rampLogged);
  const ghost = [...rampLeft, ...planEx.sets.slice(workLogged)];
  const [keptPlan, setKeptPlan] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [restTick, setRestTick] = useState(0);
  const [showRest, setShowRest] = useState(false);
  // THE PROGRESSION ENGINE (D6-A): a ghost with its reason, offered once,
  // before the first working set. Accepting logs it AND moves the plan;
  // Keep dismisses it and changes nothing at all.
  const suggestion = workLogged === 0 && !keptPlan ? suggestFor(history, exercise) : null;

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
  const applyLever = () => {
    if (!lever) return;
    if (lever.key === "restCut") { onFit({ restCut: true }); showToast({ message: "Rests shortened toward 45s" }); }
    else if (lever.key === "trim") { onFit({ trims: { ...(live.trims ?? {}), [lever.exerciseId]: (live.trims?.[lever.exerciseId] ?? 0) + 1 } }); showToast({ message: `${lever.name} trimmed by a set · This session only` }); }
    else { onFit({ skipCool: true }); showToast({ message: "Cool-down skipped" }); }
  };

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
      if (logged[i]!.warmup) return null;
      return logged.slice(0, i).filter((s) => !s.warmup).length;
    }
    const g = i - logged.length;
    if (g < rampLeft.length) return null;
    return workLogged + (g - rampLeft.length);
  };
  const lastAt = (i: number): SetEntry | undefined => {
    const pos = workPosAt(i);
    return pos === null ? undefined : lastHit?.sets[pos];
  };

  const labels = pairLabels(dayExercises);
  const pairLabel = labels.get(exercise.id);
  const partner = exercise.pairWith ? dayExercises.find((e) => e.id === exercise.pairWith) : undefined;
  const partnerLabel = partner ? labels.get(partner.id) : undefined;
  const partnerLiveIdx = partner ? live.exercises.findIndex((e) => e.exerciseId === partner.id) : -1;
  const filler = fillerFor(exercise, dayExercises);
  const fillerLiveIdx = filler ? live.exercises.findIndex((e) => e.exerciseId === filler.id) : -1;

  // D5-C: the rest-cut lever shortens every stated rest toward the floor,
  // live, without touching the program's own number.
  const restSecEff = (() => {
    const stated = exercise.restSec ?? 0;
    if (stated <= 0) return 0;
    return live.restCut ? Math.max(REST_FLOOR_SEC, stated - 30) : stated;
  })();
  const startRest = () => {
    if (exercise.kind !== "done" && restSecEff > 0) {
      setRestTick((t) => t + 1);
      setShowRest(true);
    }
  };

  // SUPERSET FLOW (D8-C). A true A1/A2 pair alternates, so once this half is
  // ahead the session offers the other one and the rest belongs to the pair.
  // Counts come from the LIVE log, not the plan, and warm-ups do not count
  // as a turn.
  const loggedByExerciseId: Record<string, number> = {};
  for (const e of live.exercises) {
    loggedByExerciseId[e.exerciseId] = e.sets.filter((x) => !x.warmup && !x.skipped).length;
  }
  const pairNextId = nextInPair(exercise, dayExercises, loggedByExerciseId);
  const pairNext = pairNextId ? dayExercises.find((e) => e.id === pairNextId) : undefined;
  const pairNextLiveIdx = pairNext ? live.exercises.findIndex((e) => e.exerciseId === pairNext.id) : -1;

  const log = () => {
    if (exercise.kind === "done") { onLog({ id: newSetId(), done: true }); return; }
    // The plan is the WORK, so it is indexed by working sets logged. Warm-ups
    // sit in the same strip and must never advance the athlete's place in it.
    const next = plannedEntryAt(planEx, workLogged);
    if (next) { onLog(duplicateEntry(next)); startRest(); return; }
    const lastWork = [...logged].reverse().find((x) => !x.warmup);
    onLog(lastWork ? duplicateEntry(lastWork) : blankEntry());
    startRest();
  };

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title truncate">{live.dayName}</div>
        <button className="nav-action-text" onClick={onFinish}>Finish</button>
      </div>

      {/* LOG IT LATER (catalog §3.8): a backdated session says so, plainly,
          so there is never a doubt about which day this is landing on. */}
      {live.backdated && (
        <div className="pad-x"><div className="eyebrow">Logging for {monthDay(live.date)}</div></div>
      )}

      <div className="pad-x"><div className="card pad">
        <div className="eyebrow">
          Exercise {idx + 1} of {live.exercises.length}
          {pairLabel && ` · ${pairLabel}`}
        </div>
        {/* D5-C: the projected finish rides the header the whole session --
            amber only when actually over, never red (time pressure is a
            warning, not a verb). */}
        {finishMs != null && (
          <div className="conn-meta">
            Finish {over != null && over >= 3 ? <span className="fit-over">~{clock(finishMs)}</span> : <>~{clock(finishMs)}</>} · budget {clock(live.startedAt + (live.budgetMin ?? 0) * 60_000)}
          </div>
        )}
        <div className="p3-q">{exercise.name}</div>
        {header && (
          <div className="bp-sub">
            {`Last: ${header.last} · ${monthDay(header.date)}`}{header.best ? ` · Best: ${header.best}` : ""}
          </div>
        )}
        {exercise.note && <div className="bp-sub">{exercise.note}</div>}
      </div></div>

      {/* THE CATCH-UP BANNER (D5-C): "Fall behind and one quiet banner
          offers the next lever." One offer, one loosener, no ceremony. */}
      {over != null && over >= 3 && (
        <div className="pad-x"><div className="catchup banner-warn">
          <div className="grow">
            {`Running ${over} over`}
            {lever ? ` · ${lever.key === "restCut" ? "Shorten rests to catch up?" : lever.key === "trim" ? `Trim a ${lever.name} set to catch up?` : "Skip the cool-down to catch up?"}` : ""}
          </div>
          {lever && <button className="pill-act" onClick={applyLever}>Do It</button>}
          <button className="pill-act pill-quiet" onClick={() => onFit({ budgetMin: (live.budgetMin ?? 0) + 5 })}>+5 Min</button>
        </div></div>
      )}

      {/* THE WARM-UP, in session (D3-C): the day's own checklist, checked
          off block by block, skippable as one unit. Shows on the first
          exercise until it is done or waved off. */}
      {showWarm && (
        <div className="pad-x"><div className="card">
          <div className="grp"><div className="eyebrow">Warm-Up{programDay?.warmUpMin ? ` · ${programDay.warmUpMin} Min` : ""}</div></div>
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
            <button className="pill-act pill-quiet" onClick={() => setKeptPlan(true)}>Keep {formatSet(exercise, suggestion.from)}</button>
          </div>
        </div></div>
      )}

      {/* PAIRS (catalog §4.2) and SUPERSET FLOW (D8-C). One row, two states:
          while the pair is mid-round it says whose turn it actually is, and
          otherwise it is the plain switch it always was. */}
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

      {!current.skipped && (
        <div className="pad-x gym-log">
          <button className="btn btn-primary btn-launch btn-block btn-lg" onClick={log}>
            {logButtonLabel(planEx, workLogged)}
          </button>
        </div>
      )}

      {/* REST TIMER + FILLER (catalog §4.3, §4.2). key={restTick} remounts
          the timer clean on every new set instead of it trying to track
          which set it belongs to. */}
      {showRest && (
        <RestTimer
          key={restTick}
          seconds={restSecEff}
          fillerName={filler?.name}
          onLogFiller={filler && fillerLiveIdx >= 0 ? () => { onMove(fillerLiveIdx); setShowRest(false); } : undefined}
          onDismiss={() => setShowRest(false)}
        />
      )}

      {/* One head grammar across the gym pages (reformat 2026-08-31): the
          quiet sh2, same as the program page's Days and Recent. */}
      <div className="sh2 sh2-quiet"><span className="t">{noun}</span></div>
      <div className="pad-x">
        {current.skipped ? (
          <div className="card"><div className="row"><div className="row-grow"><div className="conn-name">Skipped</div></div></div></div>
        ) : (
          <SetStrip
            kind={exercise.kind}
            unit={exercise.unit}
            timeUnit={exercise.timeUnit}
            entries={logged}
            ghost={ghost}
            onLogGhost={(i) => { onLog(duplicateEntry(ghost[i]!)); startRest(); }}
            onChange={onSetLogged}
            prAt={(i) => isSessionPR(history, exercise.name, exercise.kind, logged, i)}
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
            <button className="row-create" role="button" tabIndex={0} onClick={() => setSwapOpen(true)}>Swap</button>
            <button className="row-create" role="button" tabIndex={0} onClick={onSkip}>Skip This Exercise</button>
          </>
        )}
      </div>

      {/* THE COOL-DOWN (D3-C): offered when the work is done, skippable as
          a unit. Skipping here is the same lever the fit sheet offers. */}
      {showCool && (
        <div className="pad-x"><div className="card">
          <div className="grp"><div className="eyebrow">Cool-Down{programDay?.coolDownMin ? ` · ${programDay.coolDownMin} Min` : ""}</div></div>
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
      <div className="pad-x"><div className="card">
        {live.exercises.map((e, i) => (
          // RED IS A VERB: "you are here" is a fact, not an action, so the
          // current exercise marks itself with weight and a quiet Now pill,
          // never a red name (spec sweep 2026-09-01).
          <div className="row" role="button" tabIndex={0} key={e.exerciseId + i} onClick={() => onMove(i)}>
            <div className="row-grow">
              <div className="conn-name truncate">{e.name}</div>
              {/* Row meta is quiet sentence case, never a shouting eyebrow
                  (gym reformat 2026-08-31). */}
              <div className="conn-meta">{e.skipped ? "Skipped" : e.sets.length > 0 ? `${e.sets.length} Logged` : "Not started"}</div>
            </div>
            {i === idx ? <span className="pill pill-subdued">Now</span> : CHEV}
          </div>
        ))}
        {/* ADD MID-SESSION (catalog §3.10): an exercise that was never in
            the plan, without editing the program. */}
        <button className="row-create" onClick={() => setAddOpen(true)}>Add Exercise</button>
      </div></div>
      <div className="screen-foot" />

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
      {addOpen && (
        <ExerciseSheet
          mode="new"
          library={library}
          history={history}
          onSave={(draft) => { onAddMidSession(draft); setAddOpen(false); }}
          onCancel={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}
