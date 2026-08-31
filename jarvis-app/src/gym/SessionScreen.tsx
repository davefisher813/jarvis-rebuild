import { useState } from "react";
import type { Exercise, MeasureKind, SetEntry, Workout } from "./types";
import type { LiveSession } from "./liveSession";
import { logButtonLabel, plannedEntryAt, entryNoun } from "./measures";
import { newSetId, blankEntry, duplicateEntry } from "./strip";
import { isSessionPR, lastTimeLine } from "./prs";
import { pairLabels, fillerFor } from "./pairs";
import type { LibraryEntry } from "./library";
import { newExerciseKey } from "./library";
import SetStrip from "./SetStrip";
import RestTimer from "./RestTimer";
import LibraryPickSheet from "./LibraryPickSheet";
import ExerciseSheet from "./ExerciseSheet";
import MusicChip from "../music/MusicChip";
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
  history,
  library,
  onLog,
  onSetLogged,
  onSkip,
  onMove,
  onSwap,
  onAddMidSession,
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
  onFinish: () => void;
  onBack: () => void;
}) {
  const idx = live.idx;
  const current = live.exercises[idx]!;
  const logged = current.sets;
  const noun = entryNoun(exercise.kind);
  const last = lastTimeLine(history, exercise.name, exercise.kind);
  const ghost = exercise.sets.slice(logged.length);
  const [swapOpen, setSwapOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [restTick, setRestTick] = useState(0);
  const [showRest, setShowRest] = useState(false);

  const labels = pairLabels(dayExercises);
  const pairLabel = labels.get(exercise.id);
  const partner = exercise.pairWith ? dayExercises.find((e) => e.id === exercise.pairWith) : undefined;
  const partnerLabel = partner ? labels.get(partner.id) : undefined;
  const partnerLiveIdx = partner ? live.exercises.findIndex((e) => e.exerciseId === partner.id) : -1;
  const filler = fillerFor(exercise, dayExercises);
  const fillerLiveIdx = filler ? live.exercises.findIndex((e) => e.exerciseId === filler.id) : -1;

  const startRest = () => {
    if (exercise.kind !== "done" && (exercise.restSec ?? 0) > 0) {
      setRestTick((t) => t + 1);
      setShowRest(true);
    }
  };

  const log = () => {
    if (exercise.kind === "done") { onLog({ id: newSetId(), done: true }); return; }
    const next = plannedEntryAt(exercise, logged.length);
    if (next) { onLog(duplicateEntry(next)); startRest(); return; }
    const last2 = logged[logged.length - 1];
    onLog(last2 ? duplicateEntry(last2) : blankEntry());
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
        <div className="p3-q">{exercise.name}</div>
        {last && <div className="bp-sub">{last}</div>}
        {exercise.note && <div className="bp-sub">{exercise.note}</div>}
      </div></div>

      {/* PAIRS (catalog §4.2): a one-tap way to alternate with A1/A2's other
          half, right where the exercise itself is shown. */}
      {partner && partnerLiveIdx >= 0 && (
        <div className="pad-x">
          <button className="row row-act" onClick={() => onMove(partnerLiveIdx)}>
            Switch to {partnerLabel} · {partner.name}
          </button>
        </div>
      )}

      {/* Music Tier 1 (addendum item 5): the gym context's remembered link. */}
      <div className="pad-x"><MusicChip context="gym" /></div>

      {!current.skipped && (
        <div className="pad-x gym-log">
          <button className="btn btn-primary btn-block btn-lg" onClick={log}>
            {logButtonLabel(exercise, logged.length)}
          </button>
        </div>
      )}

      {/* REST TIMER + FILLER (catalog §4.3, §4.2). key={restTick} remounts
          the timer clean on every new set instead of it trying to track
          which set it belongs to. */}
      {showRest && (
        <RestTimer
          key={restTick}
          seconds={exercise.restSec ?? 0}
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
          />
        )}
        {!current.skipped && (
          <>
            {/* SWAP (catalog §3.9): the rack is taken, the shoulder is
                cranky. The program day is never touched -- only this
                session's entry changes. */}
            <button className="row row-act" role="button" tabIndex={0} onClick={() => setSwapOpen(true)}>Swap</button>
            <button className="row row-act" role="button" tabIndex={0} onClick={onSkip}>Skip This Exercise</button>
          </>
        )}
      </div>

      <div className="sh2 sh2-quiet"><span className="t">This Session</span></div>
      <div className="pad-x"><div className="card">
        {live.exercises.map((e, i) => (
          <div className={"row" + (i === idx ? " ob-addrow" : "")} role="button" tabIndex={0} key={e.exerciseId + i} onClick={() => onMove(i)}>
            <div className="row-grow">
              <div className="conn-name truncate">{e.name}</div>
              {/* Row meta is quiet sentence case, never a shouting eyebrow
                  (gym reformat 2026-08-31). */}
              <div className="conn-meta">{e.skipped ? "Skipped" : e.sets.length > 0 ? `${e.sets.length} Logged` : "Not started"}</div>
            </div>
            {CHEV}
          </div>
        ))}
        {/* ADD MID-SESSION (catalog §3.10): an exercise that was never in
            the plan, without editing the program. */}
        <button className="row row-act" onClick={() => setAddOpen(true)}>Add Exercise</button>
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
          onSave={(draft) => { onAddMidSession(draft); setAddOpen(false); }}
          onCancel={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}
