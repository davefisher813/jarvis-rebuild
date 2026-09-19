import { createPortal } from "react-dom";
import SheetBar from "../shared/SheetBar";
import { pressable } from "../shared/pressable";
import { own, rowDoor } from "../shared/rowDoor";
import { shortDate } from "../shared/dateFormat";
import { pairId, type DuplicatePair } from "./duplicates";
import { classConflicts, identityLine, valueLine, type Classification } from "./classify";
import { movesLine, remainingLine, type MergeState } from "./merge";
import type { LibraryRow } from "./libraryEdit";
import { capAfterNumber, liftTitle } from "../shared/casing";

// DUPLICATE REVIEW, OFF THE LIST AND INTO ITS OWN ROOM (handoff §6).
//
// The suggestions used to be three full cards stacked above the library, each
// with two buttons and a sentence: on a phone that is the entire first screen,
// so the page opened on a chore instead of on the thing the athlete came for.
// "Duplicate suggestions must not push the exercise library offscreen."
//
// Now the list carries ONE compact row with the real unresolved count, and
// this is what it opens.
//
// AND A MATCHING NAME IS NOT A PROOF. "Different machines or variations may
// share names." So every pair here shows what actually separates the two --
// equipment, the machine's own identity, when each one started, and how much
// is recorded under each -- before it offers to weld them together. Names are
// never truncated, because the name is the evidence.

function Side({ row, c, today }: { row: LibraryRow; c: Classification; today: string }) {
  const equip = valueLine(c, "equipment");
  const ident = identityLine(c);
  return (
    <div className="dup-side">
      {/* The name wraps. It is the one thing on this sheet that must never be
          clipped, since clipping it is how two different exercises look
          identical (acceptance criterion 12). */}
      <div className="dup-name">{liftTitle(row.name)}</div>
      <div className="facts">
        <span className="fact">{row.sessions > 0 ? `${row.sessions} ${row.sessions === 1 ? "session" : "sessions"}` : "Never done"}</span>
        {row.sets > 0 && <span className="fact">{`${row.sets} ${row.sets === 1 ? "set" : "sets"}`}</span>}
        {row.firstDate && <span className="fact cyan">{`From ${shortDate(row.firstDate)}`}</span>}
        {row.lastDate && row.lastDate !== row.firstDate && <span className="fact cyan">{`To ${shortDate(row.lastDate)}`}</span>}
      </div>
      <div className="facts">
        {equip ? <span className="fact">{equip}</span> : <span className="fact">No equipment set</span>}
        {ident && <span className="fact">{ident}</span>}
      </div>
      {valueLine(c, "muscles") && <div className="facts"><span className="fact">{valueLine(c, "muscles")}</span></div>}
      {/* The merged-away names came off every surface on 2026-09-18 (Dave:
          "also (other title) needs to be deleted and never render"). What
          separates two exercises is still all here: the name, the sessions,
          the sets, the dates, the equipment and the machine's identity. */}
      <div className="conn-meta">{today}</div>
    </div>
  );
}

/**
 * THE MERGE REVIEW, ALL EIGHT STEPS (§5).
 *
 * Both exercises in full, the survivor chosen by tap, the conflicts resolved
 * one row at a time, the summary of what moves, then one button that goes
 * pending and cannot be tapped twice. A failure stays on this sheet with a
 * Retry, because the one thing worse than a failed merge is a failed merge
 * that looks like it worked.
 */
export function MergeReviewSheet({ state, onSwap, onTake, onMerge, onCancel }: {
  state: MergeState;
  /** Choose the other exercise as the survivor; rebuilds the plan upstream. */
  onSwap: () => void;
  onTake: (field: string) => void;
  onMerge: () => void;
  onCancel: () => void;
}) {
  const { plan, stage } = state;
  const conflicts = classConflicts(plan.keep.classification, plan.fold.classification);
  const pending = stage === "pending";
  const failed = stage === "failed";
  const left = remainingLine(state);

  return createPortal(
    <div className="sheet-scrim" onClick={pending ? () => undefined : onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <SheetBar
          title="Review Merge"
          onCancel={pending ? () => undefined : onCancel}
          saveLabel={pending ? "Merging" : failed ? "Retry" : "Merge Exercises"}
          saveDisabled={pending}
          onSave={() => { if (!pending) onMerge(); }}
        />
        <div className="sheet-form">
          {failed && (
            <div className="pad-x"><div className="card pad banner-warn">
              <div className="conn-name">Merge Failed</div>
              <div className="conn-meta">{left ?? "Nothing was changed"}</div>
              {/* A HALF-WRITTEN MERGE IS NOT AN UNTOUCHED ONE. Saying "both
                  exercises are exactly as they were" after two of four writes
                  landed would be the same lie in a kinder voice, so the card
                  says which of the two it actually is. */}
              <div className="conn-meta">
                {state.applied > 0
                  ? "Some sessions already read as the kept name · Retry finishes the rest, and nothing was deleted"
                  : "Both exercises are exactly as they were"}
              </div>
              <div className="conn-meta">Retry picks up where it stopped</div>
            </div></div>
          )}

          <div className="grp xs-grp"><div className="eyebrow">Keeping</div></div>
          <div className="pad-x"><div className="card pad">
            <Side row={plan.keep.row} c={plan.keep.classification} today="This name survives" />
          </div></div>

          <div className="grp xs-grp"><div className="eyebrow">Folding In</div></div>
          <div className="pad-x"><div className="card pad">
            <Side row={plan.fold.row} c={plan.fold.classification} today="This name becomes a searchable alias" />
          </div></div>

          <div className="pad-x">
            <button type="button" className="btn btn-secondary btn-block" disabled={pending} onClick={onSwap}>
              {`Keep ${plan.fold.row.name} Instead`}
            </button>
          </div>

          {conflicts.length > 0 && (
            <>
              <div className="grp xs-grp"><div className="eyebrow">Conflicts</div></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {conflicts.map((k) => {
                  const taken = state.take.includes(k.field);
                  return (
                    // The row answers the conflict the same way its pill does
                    // (Dave 2026-09-15: "I want all rows clickable"); nothing is
                    // written until Merge.
                    <div className="row" key={k.field} {...(pending ? {} : rowDoor(() => onTake(k.field)))}>
                      <div className="row-grow">
                        <div className="conn-name">{k.label}</div>
                        <div className="facts">
                          <span className={"fact" + (taken ? "" : " lime")}>{k.keep}</span>
                          <span className={"fact" + (taken ? " lime" : "")}>{k.fold}</span>
                        </div>
                      </div>
                      <button type="button" className="pill-act" disabled={pending} onClick={own(() => onTake(k.field))}>
                        {taken ? `Use ${plan.keep.row.name}` : `Use ${plan.fold.row.name}`}
                      </button>
                    </div>
                  );
                })}
              </div></div>
              <div className="pad-x"><div className="bp-sub">
                The highlighted answer is the one the merged exercise keeps. Anything only one side answered is kept either way.
              </div></div>
            </>
          )}

          <div className="grp xs-grp"><div className="eyebrow">What Moves</div></div>
          <div className="pad-x"><div className="card pad">
            <div className="conn-name">{movesLine(plan)}</div>
            <div className="conn-meta">{`Every one of them reads as ${plan.keep.row.name} afterwards`}</div>
            <div className="conn-meta">Sets, notes, goals and program days come across exactly as they are</div>
            <div className="conn-meta">Nothing is dropped for looking like anything else</div>
          </div></div>

          <div className="xs-foot" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** THE LIST OF PAIRS. One row each, opened from the compact summary row on
 *  the library. Review opens the sheet above; Keep Separate persists a
 *  dismissal so an unchanged pair never comes back. */
export function DuplicatesSheet({ pairs, sideOf, onReview, onKeepSeparate, onClose }: {
  pairs: DuplicatePair[];
  sideOf: (row: LibraryRow) => Classification;
  onReview: (p: DuplicatePair) => void;
  onKeepSeparate: (id: string) => void;
  onClose: () => void;
}) {
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <SheetBar title="Possible Duplicates" onCancel={onClose} saveLabel="Done" onSave={onClose} />
        <div className="sheet-form">
          {pairs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-title">Nothing Left to Review</div>
              <div className="empty-sub">Every pair has been merged or kept separate</div>
            </div>
          ) : (
            <div className="pad-x"><div className="card list-card-ruled">
              {pairs.map((d) => {
                const id = pairId(d.keep.key, d.fold.key);
                const a = sideOf(d.keep);
                const b = sideOf(d.fold);
                const ea = valueLine(a, "equipment");
                const eb = valueLine(b, "equipment");
                // The one fact that most often proves they are NOT the same
                // thing, said before the suggestion rather than after it.
                const differs = ea && eb && ea !== eb;
                return (
                  // The row opens the merge review, which writes nothing until
                  // its own Merge (Dave 2026-09-15: "I want all rows clickable").
                  // Keep Separate stays button-only.
                  <div className="row dup-row" key={id} {...rowDoor(() => onReview(d))}>
                    <div className="row-grow">
                      <div className="dup-name">{liftTitle(d.fold.name)}</div>
                      <div className="dup-name">{liftTitle(d.keep.name)}</div>
                      <div className="facts">
                        <span className="fact">{d.why}</span>
                        {differs && <span className="fact amber">{`${ea} and ${eb}`}</span>}
                      </div>
                      <div className="facts">
                        <span className="fact">{`${d.fold.sessions} and ${d.keep.sessions} ${d.keep.sessions === 1 && d.fold.sessions === 1 ? "session" : "sessions"}`}</span>
                        {d.fold.firstDate && <span className="fact cyan">{`${d.fold.name} from ${shortDate(d.fold.firstDate)}`}</span>}
                        {d.keep.firstDate && <span className="fact cyan">{`${d.keep.name} from ${shortDate(d.keep.firstDate)}`}</span>}
                      </div>
                      <div className="btn-row">
                        <button type="button" className="btn btn-secondary" onClick={own(() => onReview(d))}>Review Merge</button>
                        <button type="button" className="btn btn-tertiary" onClick={own(() => onKeepSeparate(id))}>Keep Separate</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div></div>
          )}
          <div className="pad-x"><div className="bp-sub">
            A matching name is not a proof. Two machines can wear one name, and Keep Separate says so for good.
          </div></div>
          <div className="xs-foot" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The compact summary row that replaces the three stacked cards. */
export function DuplicateBar({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count <= 0) return null;
  return (
    <div className="pad-x"><div className="card list-card-ruled">
      <div className="row" {...pressable(onOpen)}>
        <div className="row-grow">
          <div className="conn-name">Possible Duplicates</div>
          <div className="facts"><span className="fact amber">{capAfterNumber(`${count} ${count === 1 ? "pair" : "pairs"}`)}</span></div>
        </div>
        <button type="button" className="pill-act" onClick={(e) => { e.stopPropagation(); onOpen(); }}>Review</button>
      </div>
    </div></div>
  );
}
