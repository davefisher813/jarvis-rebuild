import type { Exercise, SetEntry, Workout } from "./types";
import type { LiveSession } from "./liveSession";
import { logButtonLabel, plannedEntryAt, entryNoun } from "./measures";
import { newSetId, blankEntry, duplicateEntry } from "./strip";
import { isSessionPR, lastTimeLine } from "./prs";
import SetStrip from "./SetStrip";
import MusicChip from "../music/MusicChip";

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
  history,
  onLog,
  onSetLogged,
  onSkip,
  onMove,
  onFinish,
  onBack,
}: {
  live: LiveSession;
  exercise: Exercise;
  history: Workout[];
  onLog: (s: SetEntry) => void;
  onSetLogged: (sets: SetEntry[]) => void;
  onSkip: () => void;
  onMove: (idx: number) => void;
  onFinish: () => void;
  onBack: () => void;
}) {
  const idx = live.idx;
  const current = live.exercises[idx]!;
  const logged = current.sets;
  const noun = entryNoun(exercise.kind);
  const last = lastTimeLine(history, exercise.name, exercise.kind);
  const ghost = exercise.sets.slice(logged.length);

  const log = () => {
    if (exercise.kind === "done") { onLog({ id: newSetId(), done: true }); return; }
    const next = plannedEntryAt(exercise, logged.length);
    if (next) { onLog(duplicateEntry(next)); return; }
    const last2 = logged[logged.length - 1];
    onLog(last2 ? duplicateEntry(last2) : blankEntry());
  };

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title truncate">{live.dayName}</div>
        <button className="nav-action-text" onClick={onFinish}>Finish</button>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="eyebrow">Exercise {idx + 1} of {live.exercises.length}</div>
        <div className="p3-q">{exercise.name}</div>
        {last && <div className="bp-sub">{last}</div>}
        {exercise.note && <div className="bp-sub">{exercise.note}</div>}
      </div></div>

      {/* Music Tier 1 (addendum item 5): the gym context's remembered link. */}
      <div className="pad-x"><MusicChip context="gym" /></div>

      {!current.skipped && (
        <div className="pad-x gym-log">
          <button className="btn btn-primary btn-block btn-lg" onClick={log}>
            {logButtonLabel(exercise, logged.length)}
          </button>
        </div>
      )}

      <div className="sec-head"><div className="sec-left"><div className="sec-title">{noun}</div></div></div>
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
            onLogGhost={(i) => onLog(duplicateEntry(ghost[i]!))}
            onChange={onSetLogged}
            prAt={(i) => isSessionPR(history, exercise.name, exercise.kind, logged, i)}
          />
        )}
        {!current.skipped && (
          <button className="row row-act" role="button" tabIndex={0} onClick={onSkip}>Skip This Exercise</button>
        )}
      </div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">This Session</div></div></div>
      <div className="pad-x"><div className="card">
        {live.exercises.map((e, i) => (
          <div className={"row" + (i === idx ? " ob-addrow" : "")} role="button" tabIndex={0} key={e.exerciseId + i} onClick={() => onMove(i)}>
            <div className="row-grow">
              <div className="conn-name truncate">{e.name}</div>
              <div className="eyebrow">{e.skipped ? "Skipped" : e.sets.length > 0 ? `${e.sets.length} Logged` : "Not started"}</div>
            </div>
            {CHEV}
          </div>
        ))}
      </div></div>
      <div className="screen-foot" />
    </div>
  );
}
