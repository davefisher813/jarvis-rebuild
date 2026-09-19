import type { ReactNode } from "react";
import { Timer } from "../shared/icons";

// FOCUS, THE ONE PLACE (Dave 2026-09-18: "why don't we combine focus and
// pick one and roll it all under focus (which needs a major facelift as
// well)... that massive pick one chip looks terrible").
//
// There were two surfaces answering the same question. Focus dealt one card
// with Start Now / Focus 15 Minutes / Done / Not This One. Pick One, a
// full-width red slab on the Tasks list, opened a Do This sheet with Just
// Fifteen / Just This One / Something Else / Not Now. Same pick, same four
// answers, two vocabularies and two shapes:
//
//   Just Fifteen   = Focus 15 Minutes
//   Something Else = Not This One
//   Not Now        = Close
//
// So the sheet is gone and this screen is what both doors open. Just This
// One was the only answer with no twin; it is a mode of the Tasks LIST, not
// of this screen, so it moved to that list's own options sheet.
//
// THE FACELIFT, and what was wrong:
//   - The card floated in the vertical middle of an empty screen, so the
//     first thing on it sat two thirds of the way down the phone. It starts
//     at the top now, under the control, where a screen starts.
//   - Next and Quick Wins were chips, and Music was a third chip that wrapped
//     onto its own row. They are a segmented control and a trailing chip on
//     ONE line.
//   - The card was centre-aligned, which nothing else in the app is.
//   - Three verbs of equal loudness. One filled primary, two quiet capsules
//     of equal width, one text button.
//   - The screen said nothing about the deck, so it read as empty. It now
//     says what is behind this card.
// ---------------------------------------------------------------------------

export interface FocusFace {
  /** The area's name and its colour slot, for the dot. */
  areaName: string;
  areaSlot: string;
  /** Why this one, in the app's own clock words. */
  reason: string;
  text: string;
}

export interface FocusRunning {
  text: string;
  line: string;
  over: boolean;
}

export interface FocusScreenProps {
  mode: "next" | "wins";
  onMode: (m: "next" | "wins") => void;
  onClose: () => void;
  /** The card's face, or null when there is nothing to deal. */
  face: FocusFace | null;
  /** How many more are behind this one. Zero says so rather than lying. */
  waiting: number;
  /** Start Now leads only when there is a working surface to open. */
  onStartNow?: (() => void) | undefined;
  onFifteen?: (() => void) | undefined;
  onDone: () => void;
  doneBusy?: boolean;
  onSkip: () => void;
  /** The block on the clock right now, with its three answers. */
  running?: FocusRunning | null;
  onRunDone?: (() => void) | undefined;
  onRunAgain?: (() => void) | undefined;
  onRunStop?: (() => void) | undefined;
  /** Quick Wins state. */
  winsLine?: string | null;
  /** The end of a Quick Wins run, or the end of the deck. */
  finale?: { title: string; sub: string } | null;
  onBackToNext: () => void;
  /** MusicChip, passed in so this screen stays free of storage. */
  music?: ReactNode;
  /** The guard's line, when it has one. */
  guard?: ReactNode;
}

export default function FocusScreen({
  mode, onMode, onClose, face, waiting, onStartNow, onFifteen, onDone, doneBusy,
  onSkip, running, onRunDone, onRunAgain, onRunStop, winsLine, finale, onBackToNext,
  music, guard,
}: FocusScreenProps) {
  const leadsWithStart = mode === "next" && !!onStartNow;
  return (
    <div className="search-overlay ruled focus-screen">
      <div className="nav-bar">
        <div className="nav-large">Focus</div>
        <button className="nav-action-text" onClick={onClose}>Close</button>
      </div>

      {/* ONE LINE: the two ways to work, and the music. It was two rows,
          because Music was a chip in a wrapping chip row. */}
      <div className="pad-x focus-controls">
        <div className="segmented" role="group" aria-label="Focus views">
          <button type="button" className={"seg" + (mode === "next" ? " active" : "")}
            aria-pressed={mode === "next"} onClick={() => onMode("next")}>Next</button>
          <button type="button" className={"seg" + (mode === "wins" ? " active" : "")}
            aria-pressed={mode === "wins"} onClick={() => onMode("wins")}>Quick Wins</button>
        </div>
        {mode === "next" && music}
      </div>

      {winsLine && <div className="focus-run-line">{winsLine}</div>}

      {/* WHAT IS ON THE CLOCK. It stays above the card, because a block that
          is running outranks a card proposing another one. */}
      {running && (
        <div className="pad-x">
          <div className="card focus-live">
            <div className="row">
              <div className="row-ico cat-bg-brand"><Timer className="ic" /></div>
              <div className="row-stack">
                <div className="conn-name truncate">{running.text}</div>
                <div className={"conn-meta" + (running.over ? " warn" : "")}>{running.line}</div>
              </div>
            </div>
            <div className="focus-acts three">
              {onRunDone && <button className="btn btn-secondary" onClick={onRunDone}>Done</button>}
              {onRunAgain && <button className="btn btn-secondary" onClick={onRunAgain}>Another 15</button>}
              {onRunStop && <button className="btn btn-secondary" onClick={onRunStop}>Stop</button>}
            </div>
          </div>
        </div>
      )}

      <div className="pad-x focus-body">
        {finale ? (
          <div className="card pad focus-card">
            <div className="focus-task">{finale.title}</div>
            <div className="conn-meta">{finale.sub}</div>
            <div className="focus-acts">
              <button className="btn btn-secondary" onClick={onBackToNext}>Back to Next</button>
              <button className="btn btn-secondary" onClick={onClose}>Back to Today</button>
            </div>
          </div>
        ) : face ? (
          <>
            <div className="card pad focus-card">
              <div className="facts">
                <span className="fact cat"><span className={"cd cat-bg-" + face.areaSlot} />{face.areaName}</span>
                <span className="fact">{face.reason}</span>
              </div>
              <div className="focus-task">{face.text}</div>
              {guard}
              {/* ONE FILLED ACTION. Next leads with the first step; Quick
                  Wins is a run of Done taps and leads with Done. */}
              {leadsWithStart
                ? <button className="btn btn-primary btn-block focus-go" onClick={onStartNow}>Start Now</button>
                : <button className="btn btn-primary btn-block focus-go" onClick={onDone} disabled={doneBusy}>Done</button>}
              {mode === "next" && (
                <div className="focus-acts">
                  {onFifteen && <button className="btn btn-secondary" onClick={onFifteen}><Timer className="ic" />15 Minutes</button>}
                  {leadsWithStart && <button className="btn btn-secondary" onClick={onDone} disabled={doneBusy}>Done</button>}
                </div>
              )}
              {mode === "next" && <button className="focus-skip" onClick={onSkip}>Not This One</button>}
            </div>
            {/* The screen used to say nothing about the rest, so one card in
                the middle of a black page read as the whole app being empty. */}
            <div className="focus-rest">
              {waiting > 0 ? `${waiting} more waiting` : "Last one open"}
            </div>
          </>
        ) : (
          <div className="card pad focus-card">
            <div className="focus-task">Nothing waiting.</div>
            <div className="conn-meta">Enjoy it</div>
            <div className="focus-acts">
              <button className="btn btn-secondary" onClick={onClose}>Back to Today</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
