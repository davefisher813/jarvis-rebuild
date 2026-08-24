import type { ReactNode } from "react";
import PageHeader from "../shared/PageHeader";
import type { Goal } from "../life/types";
import type { ProjectRow, Progress } from "./progress";
import { progressLabel, bucketOf, closable, rankGoals, BUCKETS, BUCKET_LABEL } from "./progress";
import type { GoalReach } from "./reach";
import { reachLine } from "./reach";
import { catColor } from "../shared/categories";
import SkeletonRows from "../shared/SkeletonRows";
import { FolderOpenGlyph, TargetGlyph } from "../shared/glyphs";

// Bigger Picture (roadmap v2, Session 6): Goals and Projects on one surface,
// replacing the separate Life Map and Projects pages. Every number shown is
// derived from real task completion, so nothing here can quietly go stale.
// Leads with what is moving, because that is the useful half.

const CHEV = <div className="chev" />;
const TARGET = <TargetGlyph />;
const FOLDER = <FolderOpenGlyph />;

function Bar({ p }: { p: Progress }) {
  return <div className="bp-bar"><div className="bp-bar-fill" style={{ width: Math.max(2, p.pct) + "%" }} /></div>;
}

export default function BiggerPicturePage({
  goals, reachOfGoal, projectRows, loading, offer, onAddGoal, onOpenGoal, onAddProject, onOpenProject, nextActionTextOf, onCloseProject,
}: {
  goals: Goal[];
  // ARCHITECTURE C: both routes into a goal's work, computed once by the flow.
  reachOfGoal: (id: string) => GoalReach;
  projectRows: ProjectRow[];
  loading?: boolean;
  offer?: ReactNode; // the one stalled-project First Step card (6.7)
  nextActionTextOf?: (projectId: string) => string | null;
  onAddGoal: () => void;
  onOpenGoal: (id: string) => void;
  onAddProject: () => void;
  onOpenProject: (id: string) => void;
  // Pick 6: the row offers to close itself where the work is already done.
  onCloseProject?: (id: string) => void;
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
          <div className="empty-sub">Add a project · Progress fills itself</div>
          <button className="btn btn-primary" onClick={onAddProject}>Add a Project</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <PageHeader title="Bigger Picture" />

      {offer}

      {/* SECTIONS ARE A CLAIM ABOUT REALITY (Dave 2026-08-22, pick 9). The old
          head counted projects whose STATUS said active while the list below
          rendered all of them, so it read "Moving Now 5" over seven rows, one
          of which carried a card saying nothing was moving there. Each section
          is now derived by bucketOf, and an empty section does not render.
          Spacing and heads are the existing .sh2 and .list-flat, so this
          invents no new rhythm. */}
      {BUCKETS.map((b) => {
        const rows = projectRows.filter((r) => bucketOf(r) === b);
        if (rows.length === 0) return null;
        return (
          <div key={b}>
            <div className="sh2"><span className="t">{BUCKET_LABEL[b]}</span><span className="n">{rows.length}</span></div>
            <div><div className="list-flat">
              {rows.map(({ project, progress, stalled }) => {
                const next = nextActionTextOf?.(project.id);
                const canClose = closable({ project, progress, stalled, lastAt: null });
                return (
                  <div className="proj-row" role="button" tabIndex={0} key={project.id} onClick={() => onOpenProject(project.id)}>
                    <div className={"row-glyph cat-fg-" + catColor(project.data.category ?? "")}>{FOLDER}</div>
                    <div className="proj-meta">
                      <div className="proj-title">{project.data.title}</div>
                      {/* THE NEXT MOVE LEADS (pick 19). "Call Ridgeline" tells
                          you more than a status word or a fraction ever will,
                          so it goes first and the counts become the evidence
                          under it. */}
                      {next && <div className="bp-sub bp-next truncate">Next: {next}</div>}
                      <div className={"bp-sub" + (stalled ? " bp-stalled" : "")}>{progressLabel(progress, stalled)}</div>
                      {progress && <Bar p={progress} />}
                    </div>
                    {canClose && onCloseProject
                      ? <button className="pill-act" onClick={(e) => { e.stopPropagation(); onCloseProject(project.id); }}>Close It</button>
                      : CHEV}
                  </div>
                );
              })}
            </div></div>
          </div>
        );
      })}
      <div><div className="list-flat">
        <button className="row row-act" onClick={onAddProject}>Add Project</button>
      </div></div>

      <div className="sh2"><span className="t">Working Toward</span></div>
      <div><div className="list-flat">
        {rankGoals(goals.map((g) => { const r = reachOfGoal(g.id); return { id: g.id, progress: r.progress, openTagged: r.openTagged, goal: g, reach: r }; }))
          .map(({ goal: g, progress: p, reach: r }) => {
          return (
            <div className="row bp-goal" role="button" tabIndex={0} key={g.id} onClick={() => onOpenGoal(g.id)}>
              <div className="row-glyph cat-fg-purple">{TARGET}</div>
              <div className="row-grow">
                <div className="conn-name">{g.data.title}</div>
                {/* "No projects yet" was the wrong sentence for most of his
                    goals: they had work, nobody had filed it. reachLine says
                    what is actually true, in fractions where a real
                    denominator exists and in open counts where it does not. */}
                <div className="bp-sub">{reachLine(r)}</div>
                {p && <Bar p={p} />}
              </div>
              {CHEV}
            </div>
          );
        })}
        <button className="row row-act" onClick={onAddGoal}>Add Goal</button>
      </div></div>
      <div className="screen-foot" />
    </div>
  );
}
