import { useState, type ReactNode } from "react";
import PageHeader from "../shared/PageHeader";
import type { Area, Goal } from "../life/types";
import type { ProjectRow, Progress } from "./progress";
import { progressLabel, bucketOf, closable, rankGoals } from "./progress";
import type { GoalReach } from "./reach";
import { reachLine } from "./reach";
import type { MeasureState } from "./measure";
import { catColor } from "../shared/categories";
import SkeletonRows from "../shared/SkeletonRows";
import { FolderOpenGlyph, TargetGlyph } from "../shared/glyphs";
import { capAfterNumber } from "../shared/casing";

// YOUR LIFE (the Life Merge, Dave 2026-08-26: "it's stupid having them
// separate"). Bigger Picture and the one-day-old life layer showed the same
// goals through two doors; this page is the one door now. Areas are the
// frame, goals sit under their areas, and every goal carries its projects
// with the next move right on the row. The Moving / Not Started buckets
// died here: grouping by what a project is FOR replaced grouping by how
// far along it is, which bucketOf still guards for the one split that
// stays honest, done or not. Insights keeps only time.
//
// Every number is still derived from real task completion; nothing here can
// quietly go stale, and nothing here is ever scored.

const CHEV = <div className="chev" />;
const TARGET = <TargetGlyph />;
const FOLDER = <FolderOpenGlyph />;

function Bar({ p }: { p: Progress }) {
  return <div className="bp-bar"><div className="bp-bar-fill" style={{ width: Math.max(2, p.pct) + "%" }} /></div>;
}

export default function BiggerPicturePage({
  goals, reachOfGoal, measureOfGoal, extraOf, projectRows, areas, areaWordOf, onWakeArea, onManageAreas, loading, offer, onAddGoal, onOpenGoal, onAddProject, onOpenProject, nextActionTextOf, holdLineOf, sizeLineOf, onCloseProject,
}: {
  goals: Goal[];
  // ARCHITECTURE C: both routes into a goal's work, computed once by the flow.
  reachOfGoal: (id: string) => GoalReach;
  // PICKS 13/15: the finish line, from the same derivation the goal page
  // uses. A list and a detail page that compute the same fact twice will
  // eventually disagree.
  measureOfGoal?: (id: string) => MeasureState | null;
  // The one extra word a goal row may wear (Life picks 17/18): a comeback
  // leads as a win, effort without movement reads as weight, and only then
  // does a bare Behind or Idle speak. Derived by the flow, one place.
  extraOf?: (id: string) => { text: string; tone: "good" | "warn" } | null;
  projectRows: ProjectRow[];
  // The life frame. Absent or empty = the page renders exactly as flat
  // goals + projects; areas are an invitation, never a gate.
  areas?: Area[];
  areaWordOf?: (a: Area) => { word: string; resting: boolean } | null;
  onWakeArea?: (a: Area) => void;
  onManageAreas?: () => void;
  loading?: boolean;
  offer?: ReactNode; // THE one ask: quiet area or stalled project, never both
  nextActionTextOf?: (projectId: string) => string | null;
  // PICKS 20 + 22: what a row could never say. Both derived by the flow.
  holdLineOf?: (projectId: string) => string | null;
  sizeLineOf?: (projectId: string) => string | null;
  onAddGoal: () => void;
  onOpenGoal: (id: string) => void;
  onAddProject: () => void;
  onOpenProject: (id: string) => void;
  // Pick 6: the row offers to close itself where the work is already done.
  onCloseProject?: (id: string) => void;
}) {
  // The sealed-off half of the page: done projects fold to one quiet line.
  const [doneOpen, setDoneOpen] = useState(false);

  if (loading) {
    return (
      <div className="screen">
        <PageHeader title="Your Life" />
        <SkeletonRows />
      </div>
    );
  }

  if (goals.length === 0 && projectRows.length === 0 && (areas?.length ?? 0) === 0) {
    return (
      <div className="screen">
        <PageHeader title="Your Life" />
        <div className="empty-state">
          <div className="empty-icon">{TARGET}</div>
          <div className="empty-title">Nothing Here Yet</div>
          <div className="empty-sub">Add a project · Progress fills itself</div>
          <button className="btn btn-primary" onClick={onAddProject}>Add a Project</button>
        </div>
      </div>
    );
  }

  const openRows = projectRows.filter((r) => bucketOf(r) !== "done");
  const doneRows = projectRows.filter((r) => bucketOf(r) === "done");
  const liveGoals = goals.filter((g) => !g.data.dropped);

  const projRow = ({ project, progress, stalled }: ProjectRow, nested: boolean) => {
    const next = nextActionTextOf?.(project.id);
    const hold = holdLineOf?.(project.id) ?? null;
    const sized = sizeLineOf?.(project.id) ?? null;
    const canClose = closable({ project, progress, stalled, lastAt: null });
    return (
      <div className={"proj-row" + (nested ? " bp-nest" : "")} role="button" tabIndex={0} key={project.id} onClick={() => onOpenProject(project.id)}>
        <div className={"row-glyph cat-fg-" + catColor(project.data.category ?? "")}>{FOLDER}</div>
        <div className="proj-meta">
          <div className="proj-title">{project.data.title}</div>
          {/* THE NEXT MOVE LEADS (pick 19): "Call Ridgeline" tells you more
              than a status word or a fraction ever will. */}
          {next && <div className="bp-sub bp-next truncate">Next: {next}</div>}
          {/* PICK 20: the date is the whole content of a hold. */}
          {hold
            ? <div className="bp-sub bp-stalled">{hold}</div>
            : <div className={"bp-sub" + (stalled ? " bp-stalled" : "")}>{progressLabel(progress, stalled)}</div>}
          {/* PICK 22: size from the planner's own learned durations. */}
          {sized && <div className="bp-sub">{sized}</div>}
          {progress && <Bar p={progress} />}
        </div>
        {canClose && onCloseProject
          ? <button className="pill-act" onClick={(e) => { e.stopPropagation(); onCloseProject(project.id); }}>Close It</button>
          : CHEV}
      </div>
    );
  };

  const goalRow = (g: Goal) => {
    const r = reachOfGoal(g.id);
    const ms = measureOfGoal?.(g.id) ?? null;
    const extra = extraOf?.(g.id) ?? null;
    // A finish line outranks the reach line, for the same reason it does on
    // the goal page: it is what he asked to be measured on.
    const body = ms ? ms.line : reachLine(r);
    const mine = openRows.filter((row) => row.project.data.goalId === g.id);
    return (
      <div key={g.id}>
        <div className="row bp-goal" role="button" tabIndex={0} onClick={() => onOpenGoal(g.id)}>
          <div className="row-glyph cat-fg-purple">{TARGET}</div>
          <div className="row-grow">
            <div className="conn-name">{g.data.title}</div>
            <div className={"bp-sub" + (extra ? (extra.tone === "good" ? " rep-good-glyph" : " bp-stalled") : "")}>{extra ? extra.text + " · " + body : body}</div>
            {(ms || r.progress) && <Bar p={ms ? { done: ms.done, total: ms.target, pct: ms.pct } : r.progress!} />}
          </div>
          {CHEV}
        </div>
        {/* The goal's own projects ride under it, indented: what this work
            is FOR is visible without opening anything. */}
        {mine.map((row) => projRow(row, true))}
      </div>
    );
  };

  const ranked = (gs: Goal[]) =>
    rankGoals(gs.map((g) => { const r = reachOfGoal(g.id); return { id: g.id, progress: r.progress, openTagged: r.openTagged, goal: g }; }))
      .map(({ goal: g }) => goalRow(g));

  const areaList = areas ?? [];
  const unassigned = liveGoals.filter((g) => !g.data.areaId || !areaList.some((a) => a.id === g.data.areaId));
  const goalIds = new Set(liveGoals.map((g) => g.id));
  const orphanRows = openRows.filter((r) => !r.project.data.goalId || !goalIds.has(r.project.data.goalId));

  return (
    <div className="screen">
      <PageHeader title="Your Life" />

      {offer}

      {/* THE LIFE FRAME. Each area is a section wearing at most one word
          (Fed, Resting, Quiet a while); only Resting is a control. An area
          with nothing live still renders: it is a place, not a filter. */}
      {areaList.map((a) => {
        const w = areaWordOf?.(a) ?? null;
        const mine = ranked(liveGoals.filter((g) => g.data.areaId === a.id));
        return (
          <div key={a.id}>
            <div className="sh2">
              <span className="t">{a.data.name}</span>
              {w && (w.resting
                ? <button className="life-word life-rest" onClick={() => onWakeArea?.(a)}>{w.word}</button>
                : <span className={"life-word" + (w.word === "Fed" ? " life-fed" : " life-quiet")}>{w.word}</span>)}
            </div>
            <div><div className="list-flat">
              {mine}
              {mine.length === 0 && (
                <div className="row"><div className="row-grow">
                  <div className="conn-name">Nothing Live Here Yet</div>
                  <div className="eyebrow">{w?.resting ? "Resting on purpose" : "Assign a goal, or let it rest"}</div>
                </div></div>
              )}
            </div></div>
          </div>
        );
      })}

      {/* Goals outside the frame (or all of them, when no areas exist). */}
      {unassigned.length > 0 && (
        <div>
          <div className="sh2"><span className="t">{areaList.length > 0 ? "More Goals" : "Working Toward"}</span></div>
          <div><div className="list-flat">{ranked(unassigned)}</div></div>
        </div>
      )}

      {/* Work that belongs to no goal yet. Still ranked, still one tap. */}
      {orphanRows.length > 0 && (
        <div>
          <div className="sh2"><span className="t">More Work</span><span className="n">{orphanRows.length}</span></div>
          <div><div className="list-flat">{orphanRows.map((r) => projRow(r, false))}</div></div>
        </div>
      )}

      {/* Done folds to a receipt: the shelf is Insights' job, but a closed
          project must stay one tap from reachable, not vanish. */}
      {doneRows.length > 0 && (
        <div><div className="list-flat">
          <button className="receipt-line" onClick={() => setDoneOpen((v) => !v)}>
            <span className="rl-t">{capAfterNumber(`${doneRows.length} Done ${doneRows.length === 1 ? "project" : "projects"}`)}</span>
            <div className="chev" />
          </button>
          {doneOpen && doneRows.map((r) => projRow(r, false))}
        </div></div>
      )}

      <div><div className="list-flat">
        <button className="row row-act" onClick={onAddProject}>Add Project</button>
        <button className="row row-act" onClick={onAddGoal}>Add Goal</button>
        {onManageAreas && (
          <button className="row row-act" onClick={onManageAreas}>{areaList.length > 0 ? "Manage Areas" : "Group Into Areas"}</button>
        )}
      </div></div>
      <div className="screen-foot" />
    </div>
  );
}
