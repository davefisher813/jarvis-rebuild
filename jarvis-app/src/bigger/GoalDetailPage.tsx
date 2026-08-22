import { useState } from "react";
import { createPortal } from "react-dom";
import type { Goal } from "../life/types";
import type { Project } from "../projects/types";
import type { Progress } from "./progress";
import { savingsLine, savingsPct, savedNewestFirst, savedTotal } from "./savings";
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

export default function GoalDetailPage({
  goal,
  progress,
  projects,
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
  progress: Progress | null;
  projects: Project[]; // linked to this goal
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
            <div className="bp-sub">{progress ? capAfterNumber(`${progress.done} of ${progress.total} tasks done`) : "No tasks yet"}</div>
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

      {/* Finishing the goal, where the goal actually lives. Hidden once it is
          achieved, because the moment is not a toggle to flip back and forth. */}
      {onAchieve && goal.data.state !== "achieved" && (
        <div className="pad-x conn-action">
          <button className="btn btn-primary btn-block" onClick={onAchieve}>Mark Achieved</button>
        </div>
      )}
    </div>
  );
}
