import { useState } from "react";
import { createPortal } from "react-dom";
import type { TaskItem } from "../TasksService";
import type { StartAction } from "../startAction";
import { blockerOf } from "../startAction";
import { whyStart, NO_CLOCK_LINE, type TopPick } from "../startPick";
import { pressable } from "../../shared/pressable";

// A PLACE TO BEGIN (Start Now, 2026-09-16).
//
// This is what stands where Pick One stood. The difference is the whole
// point of the change: it names the task, it says what is already ready on
// it, and it can be asked why it picked that one, out of metadata a person
// can go and check.
//
// One primary, and it says Start Now or Resume depending on which of those
// is true. Why This and Choose Another are quiet, because they are questions
// about the choice rather than competitors to it.

export interface StartCardProps {
  pick: TopPick;
  action: StartAction;
  /** Everything else that could be started, for Choose Another. */
  others: TaskItem[];
  /** The one line under each other task: what is ready on it. */
  readyFor: (t: TaskItem) => string;
  onStart: (id: string) => void;
  /** A task you can see is a task you can finish (Dave 2026-09-15, one rule
   *  everywhere). The picker draws real tasks, so it draws the real ring. */
  onToggle: (id: string) => void;
}

export default function StartCard({ pick, action, others, readyFor, onStart, onToggle }: StartCardProps) {
  const [why, setWhy] = useState(false);
  const [other, setOther] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="pad-x start-top-wrap">
      <div className="card pad start-top">
        <div className="eyebrow">A Place to Begin</div>
        <div className="start-top-name">{pick.task.data.text}</div>
        {/* What is READY, never what it promises to finish. */}
        <div className="start-top-ready">{action.ready}</div>
        <button className="btn btn-primary btn-block" onClick={() => onStart(pick.task.id)}>
          {pick.resuming ? "Resume" : "Start Now"}
        </button>
        <div className="start-top-quiet">
          <button className="quiet-action" onClick={() => setWhy(true)}>Why This</button>
          <button className="quiet-action" onClick={() => setOther(true)}>Choose Another</button>
        </div>
      </div>

      {why && (
        <ReasonSheet
          reasons={whyStart(pick, action, today)}
          onOther={() => { setWhy(false); setOther(true); }}
          onClose={() => setWhy(false)}
        />
      )}
      {other && (
        <ChooseSheet
          others={others}
          readyFor={readyFor}
          onPick={(id) => { setOther(false); onStart(id); }}
          onToggle={(id) => { setOther(false); onToggle(id); }}
          onClose={() => setOther(false)}
        />
      )}
    </div>
  );
}

/** Why this task. Reasons, then the promise the card has to keep. */
function ReasonSheet({ reasons, onOther, onClose }: {
  reasons: string[]; onOther: () => void; onClose: () => void;
}) {
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Why This Task</div></div>
        <div className="pad-x sheet-form">
          <div className="facts">
            {reasons.map((r, i) => <span className="fact" key={i}>{r}</span>)}
          </div>
          <div className="start-top-promise">{NO_CLOCK_LINE}</div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-secondary btn-block" onClick={onOther}>Choose Another Task</button>
          <button className="btn btn-tertiary btn-block" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * What would you like to work on. Every row says what is READY on it, not
 * just its name, so choosing another is a real choice between two prepared
 * things rather than a swap of one title for another.
 */
function ChooseSheet({ others, readyFor, onPick, onToggle, onClose }: {
  others: TaskItem[]; readyFor: (t: TaskItem) => string;
  onPick: (id: string) => void; onToggle: (id: string) => void; onClose: () => void;
}) {
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">What to Work On</div></div>
        <div className="pad-x sheet-form">
          {others.length === 0 ? (
            <div className="conn-meta">Nothing else is open</div>
          ) : (
            <div className="list-flat">
              {others.slice(0, 8).map((t) => {
                const blocked = blockerOf(t.data);
                return (
                  <div className="row" key={t.id} {...pressable(() => onPick(t.id))}>
                    {/* The app's own ring, so something already finished can
                        be ticked here rather than started again. */}
                    <div
                      className="task-check-tap"
                      role="checkbox"
                      aria-checked={false}
                      aria-label="Mark done"
                      onClick={(e) => { e.stopPropagation(); onToggle(t.id); }}
                    >
                      <div className="task-check" />
                    </div>
                    <div className="row-grow">
                      <div className="conn-name truncate">{t.data.text}</div>
                      <div className="facts">
                        <span className={"fact" + (blocked ? " warn" : "")}>
                          {blocked ? blocked.what : readyFor(t)}
                        </span>
                      </div>
                    </div>
                    <div className="chev" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-tertiary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
