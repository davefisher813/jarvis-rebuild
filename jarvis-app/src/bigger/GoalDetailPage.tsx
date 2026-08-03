import type { Goal } from "../life/types";
import type { Project } from "../projects/types";
import type { Progress } from "./progress";

// Session 6.6: a goal is a PLACE, not an edit form. One glance answers "is
// this moving, and what happens next": an aggregate progress line in the hero
// (counts live here and ONLY here; project rows carry next actions instead,
// so nothing on the page repeats), the linked projects, an Add Project that
// links to this goal at birth, and at most ONE gated link suggestion.

const CHEV = (
  <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
);
const PLUS = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
const TARGET = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></svg>
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
}) {
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
            with no tasks under it yet says so instead of claiming 0%. */}
        <div className="bp-sub">{progress ? `${progress.done} of ${progress.total} tasks done` : "No tasks under this goal yet"}</div>
        {progress && <div className="bp-bar"><div className="bp-bar-fill" style={{ width: Math.max(2, progress.pct) + "%" }} /></div>}
      </div></div>

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
        <div className="row ob-addrow" role="button" tabIndex={0} onClick={onAddProject}>
          <div className="sec-ico ico-accent">{PLUS}</div>
          <div className="row-grow"><div className="conn-name">Add Project</div></div>
        </div>
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
    </div>
  );
}
