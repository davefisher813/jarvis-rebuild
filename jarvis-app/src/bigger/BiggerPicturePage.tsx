import type { ReactNode } from "react";
import PageHeader from "../shared/PageHeader";
import type { Goal } from "../life/types";
import type { ProjectRow, Progress } from "./progress";
import { progressLabel } from "./progress";
import { catColor, catName } from "../shared/categories";
import SkeletonRows from "../shared/SkeletonRows";

// Bigger Picture (roadmap v2, Session 6): Goals and Projects on one surface,
// replacing the separate Life Map and Projects pages. Every number shown is
// derived from real task completion, so nothing here can quietly go stale.
// Leads with what is moving, because that is the useful half.

const CHEV = <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>;
const PLUS = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const TARGET = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></svg>;

const initialOf = (s: string) => (s.trim()[0] ?? "?").toUpperCase();

function Bar({ p }: { p: Progress }) {
  return <div className="bp-bar"><div className="bp-bar-fill" style={{ width: Math.max(2, p.pct) + "%" }} /></div>;
}

export default function BiggerPicturePage({
  goals, goalProgressOf, projectRows, loading, offer, onAddGoal, onOpenGoal, onAddProject, onOpenProject, nextActionTextOf,
}: {
  goals: Goal[];
  goalProgressOf: (id: string) => Progress | null;
  projectRows: ProjectRow[];
  loading?: boolean;
  offer?: ReactNode; // the one stalled-project First Step card (6.7)
  nextActionTextOf?: (projectId: string) => string | null;
  onAddGoal: () => void;
  onOpenGoal: (id: string) => void;
  onAddProject: () => void;
  onOpenProject: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="screen">
        <PageHeader title="Bigger Picture" />
        <SkeletonRows />
      </div>
    );
  }

  if (goals.length === 0 && projectRows.length === 0) {
    return (
      <div className="screen">
        <PageHeader title="Bigger Picture" />
        <div className="empty-state">
          <div className="empty-icon">{TARGET}</div>
          <div className="empty-title">Nothing Here Yet</div>
          <div className="empty-sub">Add a project · progress fills itself</div>
          <button className="btn btn-primary" onClick={onAddProject}>Add a Project</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <PageHeader title="Bigger Picture" />

      {offer}

      <div className="sh2"><span className="t">Moving Now</span>{projectRows.length > 0 && <span className="n">{projectRows.filter((r) => r.project.data.status === "active").length} ACTIVE</span>}</div>
      <div><div className="list-flat">
        {projectRows.map(({ project, progress, stalled }) => {
          const tag = project.data.category ? catName(project.data.category) : "";
          return (
            <div className="proj-row" role="button" tabIndex={0} key={project.id} onClick={() => onOpenProject(project.id)}>
              <div className={"proj-icon cat-bg-" + catColor(project.data.category ?? "")}>{initialOf(tag || project.data.title)}</div>
              <div className="proj-meta">
                {tag && <div className="proj-tag">{tag}</div>}
                <div className="proj-title">{project.data.title}</div>
                <div className={"bp-sub" + (stalled ? " bp-stalled" : "")}>{progressLabel(progress, stalled)}</div>
                {/* The one thing that would move this project (Session 6.6).
                    Derived; a project with no next action is stuck by
                    definition, and the counts line above already says so. */}
                {(() => { const next = nextActionTextOf?.(project.id); return next ? <div className="bp-sub bp-next truncate">Next: {next}</div> : null; })()}
                {progress && <Bar p={progress} />}
              </div>
              {CHEV}
            </div>
          );
        })}
        <div className="proj-row ob-addrow" role="button" tabIndex={0} onClick={onAddProject}>
          <div className="sec-ico ico-accent">{PLUS}</div>
          <div className="row-grow"><div className="conn-name">Add Project</div></div>
        </div>
      </div></div>

      <div className="sh2"><span className="t">Working Toward</span></div>
      <div><div className="list-flat">
        {goals.map((g) => {
          const p = goalProgressOf(g.id);
          return (
            <div className="row bp-goal" role="button" tabIndex={0} key={g.id} onClick={() => onOpenGoal(g.id)}>
              <div className="row-grow">
                <div className="conn-name">{g.data.title}</div>
                <div className="bp-sub">{p ? `${p.done} of ${p.total} done` : "No projects yet"}</div>
                {p && <Bar p={p} />}
              </div>
              {CHEV}
            </div>
          );
        })}
        <div className="row ob-addrow" role="button" tabIndex={0} onClick={onAddGoal}>
          <div className="sec-ico ico-accent">{PLUS}</div>
          <div className="row-grow"><div className="conn-name">Add Goal</div></div>
        </div>
      </div></div>
      <div className="screen-foot" />
    </div>
  );
}
