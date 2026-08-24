import { useState } from "react";
import { createPortal } from "react-dom";
import type { Goal } from "../life/types";
import type { Project } from "../projects/types";
import type { GoalReach } from "./reach";
import { reachLine, byDue } from "./reach";
import { savingsLine, savingsPct, savedNewestFirst, savedTotal } from "./savings";
import { catColor } from "../shared/categories";
import { haptics } from "../shared/haptics";
import { fmtDay } from "../decisions/DecisionsFlow";
import { formatMoney } from "../money/types";
import { monthDay } from "../money/bills";
import { capAfterNumber } from "../shared/casing";
import { TargetGlyph } from "../shared/glyphs";

// Session 6.6: a goal is a PLACE, not an edit form. One glance answers "is
// this moving, and what happens next": an aggregate progress line in the hero
// (counts live here and ONLY here; project rows carry next actions instead,
// so nothing on the page repeats), the linked projects, an Add Project that
// links to this goal at birth, and at most ONE gated link suggestion.

const CHEV = (
  <div className="chev" />
);
const PLUS = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
const TARGET = (
  <TargetGlyph />
);

export interface TaggedTask { id: string; text: string; done: boolean; due?: string | null; category?: string }

export default function GoalDetailPage({
  goal,
  reach,
  projects,
  tagged = [],
  onToggleTagged,
  canTag = false,
  nextActionTextOf,
  suggestion,
  onBack,
  onEdit,
  onOpenProject,
  onAddProject,
  onLinkSuggestion,
  onDismissSuggestion,
  onAddSavings,
  onAchieve,
}: {
  goal: Goal;
  // ARCHITECTURE C: one object carries both routes into this goal's work, so
  // the page can never show a filed number and a tagged number derived from
  // two different passes over the data.
  reach: GoalReach;
  projects: Project[]; // linked to this goal
  // The open work this goal WATCHES through its areas. Never filed here, never
  // copied here: these are the same task records the Tasks tab renders.
  tagged?: TaggedTask[];
  onToggleTagged?: (id: string) => void;
  // True when the user actually has areas to pick from. Without it the empty
  // goal would be offered a door that opens onto nothing.
  canTag?: boolean;
  nextActionTextOf: (projectId: string) => string | null;
  suggestion?: Project | null; // at most one, pre-gated by the caller
  onBack: () => void;
  onEdit: () => void;
  onOpenProject: (id: string) => void;
  onAddProject: () => void;
  onLinkSuggestion?: (projectId: string) => void;
  onDismissSuggestion?: (projectId: string) => void;
  onAddSavings?: (amount: number) => void; // Money v1: append a dated entry
  // Finishing a goal was buried in the edit sheet behind a segmented control.
  // The biggest moment in the app does not live inside a form.
  onAchieve?: () => void;
}) {
  const target = goal.data.moneyTarget;
  const progress = reach.progress;
  // Derived, never asserted: every task under every project of this goal is
  // closed AND nothing it watches is still open. Before architecture C this
  // read the filed side only, so a goal could offer to finish itself while
  // eight tagged tasks sat open in the areas it covers.
  const allWorkDone = !!progress && progress.total > 0 && progress.done >= progress.total && reach.openTagged === 0;
  // At most five, nearest deadline first. A goal watching a busy area would
  // otherwise render a wall, and a wall is not a glance.
  const taggedOpen = byDue(tagged.filter((t) => !t.done));
  const shown = taggedOpen.slice(0, 5);
  const moreTagged = taggedOpen.length - shown.length;
  // Reaches NOTHING: no projects, no watched areas, no dollar target. Pick C
  // made "add a project" the wrong first move for this case. Tags are the
  // default way in ("tags by default, attach projects when big enough"), so
  // the loud offer on an empty goal is to name the areas it covers, which
  // costs two taps and usually fills the goal immediately from work that
  // already exists.
  const empty = projects.length === 0 && !target && reach.taggedIds.length === 0;
  const [savingsOpen, setSavingsOpen] = useState(false);
  const [savingsAmt, setSavingsAmt] = useState("");
  const savingsValid = Number.isFinite(Number(savingsAmt)) && Number(savingsAmt) > 0;
  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Goal</div>
        <button className="nav-action-text" onClick={onEdit}>Edit</button>
      </div>

      <div className="pad-x"><div className="card proj-detail-hero">
        <div className="proj-icon cat-bg-graphite">{TARGET}</div>
        {/* proj-detail-title, not nav-large: goal titles run long and the
            34px screen-title size wraps them badly */}
        <div className="proj-detail-title">{goal.data.title}</div>
        {/* The ONLY place counts appear on this page. Honest null: a goal
            with no tasks under it yet says so instead of claiming 0%. A
            dollar target replaces the counts line with the DERIVED savings
            line (Money v1); the bar then tracks dollars, not tasks. */}
        {target ? (
          <>
            <div className="bp-sub">{savingsLine(target, goal.data.saved)}</div>
            {savedTotal(goal.data.saved) > 0 && (
              <div className="bp-bar"><div className="bp-bar-fill" style={{ width: Math.max(2, savingsPct(target, goal.data.saved)) + "%" }} /></div>
            )}
          </>
        ) : (
          <>
            <div className="bp-sub">{reachLine(reach)}</div>
            {progress && <div className="bp-bar"><div className="bp-bar-fill" style={{ width: Math.max(2, progress.pct) + "%" }} /></div>}
          </>
        )}
      </div></div>

      {target && onAddSavings && (
        <>
          <div className="sec-head"><div className="sec-left"><div className="sec-title">Savings</div></div></div>
          <div className="pad-x"><div className="card">
            {savedNewestFirst(goal.data.saved).slice(0, 5).map((e, i) => (
              <div className="row" key={e.d + "-" + i}>
                <div className="row-grow"><div className="conn-name">{formatMoney(e.amount)}</div><div className="eyebrow">{monthDay(e.d)}</div></div>
              </div>
            ))}
            <button className="row row-act" onClick={() => { setSavingsAmt(""); setSavingsOpen(true); }}>Add to Savings</button>
          </div></div>
        </>
      )}

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Projects</div></div></div>
      <div className="pad-x"><div className="card">
        {projects.map((p) => {
          const next = nextActionTextOf(p.id);
          return (
            <div className="row" role="button" tabIndex={0} key={p.id} onClick={() => onOpenProject(p.id)}>
              <div className="row-grow">
                <div className="conn-name truncate">{p.data.title}</div>
                {/* Next action, not counts: what would move this, in one line.
                    No next action is an honest synonym for stuck. */}
                <div className="bp-sub truncate">{next ? `Next: ${next}` : "No next action"}</div>
              </div>
              {CHEV}
            </div>
          );
        })}
        <button className="row row-act" onClick={onAddProject}>Add Project</button>
      </div></div>

      {/* ARCHITECTURE C, THE HALF THAT WAS MISSING (Dave 2026-08-22, pick C).
          Everything pointed DOWN: a goal held projects, a project held tasks,
          and a task at the bottom of that chain could not say what it was for.
          Four of his seven projects were unstarted, so for most of his real
          work the chain was empty and the goal looked idle while he was
          actively doing the work, just not filing it.

          These are not copies and they were not moved. They are the same task
          records the Tasks tab renders, seen through the areas this goal
          watches, and ticking one here finishes it everywhere. Capped at five
          by due date: a goal watching a busy area would otherwise print a
          wall, and the remainder gets a count, not a button that goes
          nowhere. */}
      {shown.length > 0 && (
        <>
          <div className="sec-head"><div className="sec-left"><div className="sec-title">From Your Areas</div></div></div>
          <div className="pad-x"><div className="card">
            {shown.map((t) => (
              <div className="row proj-step" key={t.id}>
                <div
                  className="task-check-tap"
                  role="checkbox"
                  aria-checked={false}
                  aria-label="Mark done"
                  onClick={() => { haptics.selection(); onToggleTagged?.(t.id); }}
                >
                  <div className={"task-check cat-bd-" + catColor(t.category ?? "")} />
                </div>
                <div className="row-grow">
                  <div className="conn-name">{t.text}</div>
                  {t.due && <div className="conn-meta">{fmtDay(t.due)}</div>}
                </div>
              </div>
            ))}
            {moreTagged > 0 && (
              <div className="row"><div className="row-grow"><div className="conn-meta">{capAfterNumber(`${moreTagged} more in these areas`)}</div></div></div>
            )}
          </div></div>
        </>
      )}

      {suggestion && onLinkSuggestion && onDismissSuggestion && (
        <>
          <div className="sec-head">
            <div className="sec-left"><div className="sec-title">Looks Related</div></div>
            <button className="see-all quiet-action" aria-label="Dismiss suggestion" onClick={() => onDismissSuggestion(suggestion.id)}>&times;</button>
          </div>
          <div className="pad-x"><div className="card">
            <div className="suggestion-row">
              <div className="sug-title">&ldquo;{suggestion.data.title}&rdquo;</div>
              <button className="btn-sm" onClick={() => onLinkSuggestion(suggestion.id)}>Link</button>
            </div>
          </div></div>
        </>
      )}
      <div className="screen-foot" />
      {savingsOpen && onAddSavings && createPortal(
        <div className="sheet-scrim" onClick={() => setSavingsOpen(false)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="grp"><div className="eyebrow">Add to Savings</div></div>
            <div className="pad-x sheet-form">
              <div className="field">
                <div className="input-label">Amount (USD)</div>
                <input className="input" inputMode="numeric" placeholder="0" value={savingsAmt} onChange={(e) => setSavingsAmt(e.target.value)} />
              </div>
            </div>
            <div className="pad-x sheet-actions">
              <button className="btn btn-primary btn-block" onClick={() => { if (!savingsValid) return; onAddSavings(Number(savingsAmt)); setSavingsOpen(false); }}>Save</button>
              <button className="btn btn-secondary btn-block" onClick={() => setSavingsOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* WHAT THE PAGE OFFERS IS WHAT IS AVAILABLE (Dave 2026-08-22, picks 11
          and 8). Mark Achieved used to be the primary action on a goal with no
          projects, no tasks and no measure: the loudest control in the app
          inviting him to declare victory over something never started. And it
          said "Achieved" for a goal whose only evidence was task counts, which
          is a different claim: Raise 100k is not finished because a golf event
          is. So the offer follows the evidence.
            nothing under it  -> the move that exists is adding a project
            work all done     -> ask, do not assert
            work outstanding  -> the quiet tier; finishing early is allowed,
                                 it is just not the shouted move */}
      {onAchieve && goal.data.state !== "achieved" && (
        <div className="pad-x conn-action">
          {empty
            ? (canTag
              ? <button className="btn btn-primary btn-block" onClick={onEdit}>Choose Its Areas</button>
              : <button className="btn btn-primary btn-block" onClick={onAddProject}>Add a Project</button>)
            : allWorkDone
              ? <button className="btn btn-primary btn-block" onClick={onAchieve}>All Work Done, Finish It</button>
              : <button className="btn btn-block" onClick={onAchieve}>Mark Achieved</button>}
        </div>
      )}
    </div>
  );
}
