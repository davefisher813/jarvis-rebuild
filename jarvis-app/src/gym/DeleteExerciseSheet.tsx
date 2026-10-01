import { createPortal } from "react-dom";
import { liftTitle } from "../shared/casing";
import { goesLines, historyLine, programLine, staysLine, type DeletePlan } from "./deleteExercise";

// DELETE EXERCISE, THE CONFIRM (2026-10-01).
//
// The athlete is told exactly what leaves, from the records, before anything
// is written: the sessions and sets under it, the program days it is planned
// in, the sessions that would be left empty, the saved details that go with
// it. When there is history the question is asked in so many words, with two
// real answers (delete it with its history, or archive it instead) and a way
// out, because "delete the exercise" and "delete my training log" are not the
// same sentence and this app does not decide which one was meant.
//
// It writes nothing. GymFlow runs the delete, and offers Undo once it lands.

export type DeleteStage = "asking" | "pending";

export default function DeleteExerciseSheet({ plan, stage, note, onDelete, onArchive, onCancel }: {
  plan: DeletePlan;
  stage: DeleteStage;
  /** Set when a write failed partway: what landed, and that Delete finishes
   *  the rest. The sheet stays, so a half-done delete is never left to guess. */
  note?: string | null;
  onDelete: () => void;
  onArchive: () => void;
  onCancel: () => void;
}) {
  const pending = stage === "pending";
  const history = plan.tier === "history";
  const logged = historyLine(plan);
  const used = programLine(plan);
  const stays = staysLine(plan);
  return createPortal(
    <div className="sheet-scrim" onClick={pending ? () => undefined : onCancel}>
      <div className="card" role="dialog" aria-label={`Delete ${liftTitle(plan.row.name)}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Delete Exercise</div></div>
        {note && (
          <div className="pad-x"><div className="card pad banner-warn">
            <div className="conn-name">Not Everything Saved</div>
            <div className="conn-meta">{note}</div>
          </div></div>
        )}
        <div className="pad-x"><div className="card pad">
          {/* The name wraps: it is the one thing on this sheet that must never
              be clipped, since clipping it is how two different exercises look
              the same. */}
          <div className="dup-name">{liftTitle(plan.row.name)}</div>
          {(logged || used) && (
            <div className="facts">
              {logged && <span className="fact lime">{logged}</span>}
              {used && <span className="fact">{used}</span>}
            </div>
          )}
        </div></div>

        <div className="grp xs-grp"><div className="eyebrow">What Goes</div></div>
        <div className="pad-x"><div className="card pad">
          {goesLines(plan).map((l) => <div className="conn-meta" key={l}>{l}</div>)}
        </div></div>
        {stays && <div className="pad-x"><div className="input-hint">{stays}</div></div>}

        <div className="pad-x sheet-actions">
          <button
            type="button"
            className="btn btn-block btn-secondary destructive"
            disabled={pending}
            onClick={onDelete}
          >
            {pending ? "Deleting" : history ? "Delete Exercise and Its History" : "Delete Exercise"}
          </button>
          {history && (
            <button type="button" className="btn btn-block btn-secondary" disabled={pending} onClick={onArchive}>Archive Instead</button>
          )}
          <button type="button" className="btn btn-tertiary btn-block" disabled={pending} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
