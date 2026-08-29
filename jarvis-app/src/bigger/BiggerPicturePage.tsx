import { useState, type ReactNode } from "react";
import PageHeader from "../shared/PageHeader";
import type { Goal } from "../life/types";
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
// separate"; THE UNIFICATION, Dave 2026-08-29: "there's just too much
// disconnect between the life, the areas of the life, the categories, the
// tasks... the way you would imagine folders are organized").
//
// THE CATEGORY IS THE AREA NOW. The app ran two taxonomies for one concept:
// Categories, which every task, project, note, event and person already
// pointed at by id, and a separate life_area entity that nothing pointed at
// except an optional field on goals -- an entity GoalSheet's own comment
// called "retired (state nobody maintained)", that no onboarding ever
// created, while four screens labelled the CATEGORY picker "Area". The
// research pass (Things 3, PARA, Todoist, Linear, 2026-08-29) was
// unanimous: never run two taxonomies for the same concept, keep the spine
// shallow (Area -> Project -> Task), make parents optional but orphans
// conspicuous, and let every section render only when it has contents.
//
// So the frame here is the user's own categories -- the same nine things
// the Brain tab lists -- with goals homed by their first tag, each goal
// carrying its filed projects, and goalless projects riding under their
// category directly. One tree, two lenses: Brain is the stuff in an area,
// this page is the direction of it.
//
// Every number is still derived from real task completion; nothing here can
// quietly go stale, and nothing here is ever scored. Section heads carry
// COUNTS, never percentages: a life is never scored is already a law.

const CHEV = <div className="chev" />;
const TARGET = <TargetGlyph />;
const FOLDER = <FolderOpenGlyph />;

function Bar({ p }: { p: Progress }) {
  return <div className="bp-bar"><div className="bp-bar-fill" style={{ width: Math.max(2, p.pct) + "%" }} /></div>;
}

export default function BiggerPicturePage({
  goals, reachOfGoal, measureOfGoal, extraOf, projectRows, sections = [], loading, offer, onAddGoal, onOpenGoal, onAddProject, onOpenProject, nextActionTextOf, holdLineOf, sizeLineOf, onCloseProject,
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
  // THE FRAME: the user's categories, ordered as the Brain tab orders them.
  // Same ids everything on this page already carries; no second taxonomy.
  sections?: { id: string; name: string; color: string }[];
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

  if (goals.length === 0 && projectRows.length === 0) {
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

  // ONE HOME PER ITEM (the research consensus, and Todoist's rule). A goal
  // is HOMED by the first of its tags that names a live section; the rest of
  // its tags stay what they always were, a watch list. A project is homed by
  // its category. Anything with no home is not forced into one -- it floats
  // in a visible band below, adoption one tap away through its own sheet,
  // which is Things 3's answer to orphans and the ADHD answer to
  // categorization-at-capture.
  const sectionIds = new Set(sections.map((c) => c.id));
  const homeOf = (g: Goal) => (g.data.tags ?? []).find((t) => sectionIds.has(t)) ?? null;
  const goalIds = new Set(liveGoals.map((g) => g.id));
  // A project filed to a live goal renders nested under that goal (goalRow
  // already carries its own filter); everything else with a category renders
  // under the category directly.
  const looseRows = openRows.filter((r) => !r.project.data.goalId || !goalIds.has(r.project.data.goalId));
  const unassigned = liveGoals.filter((g) => homeOf(g) === null);
  const orphanRows = looseRows.filter((r) => !sectionIds.has(r.project.data.category ?? ""));

  return (
    <div className="screen">
      <PageHeader title="Your Life" />

      {offer}

      {/* THE LIFE FRAME: one section per area that HAS anything, in Brain's
          own order. An empty area renders nothing at all -- "never ship
          empty containers" (PARA), and the old per-area "Nothing Live Here
          Yet" row was exactly the guilt-rendering that rule bans. The head's
          count is items shown, a count and never a score. The dot wears the
          area's own color, the same dot every task row already wears, so
          the two tabs read as one system at a glance. */}
      {sections.map((c) => {
        const mine = ranked(liveGoals.filter((g) => homeOf(g) === c.id));
        const loose = looseRows.filter((r) => (r.project.data.category ?? "") === c.id);
        if (mine.length === 0 && loose.length === 0) return null;
        return (
          <div key={c.id}>
            <div className="sh2 sh2-quiet">
              <span className={"cat-dot cat-bg-" + catColor(c.id)} />
              <span className="t">{c.name}</span>
              <span className="n">{mine.length + loose.length}</span>
            </div>
            <div><div className="list-flat">
              {mine}
              {loose.map((r) => projRow(r, false))}
            </div></div>
          </div>
        );
      })}

      {/* Goals with no home yet. Visible, never forced: opening one lands on
          its page, whose empty-state primary is already Choose Its Areas. */}
      {unassigned.length > 0 && (
        <div>
          <div className="sh2 sh2-quiet"><span className="t">Working Toward</span><span className="n">{unassigned.length}</span></div>
          <div><div className="list-flat">{ranked(unassigned)}</div></div>
        </div>
      )}

      {/* Work with no goal AND no area: the true orphans float here, at the
          bottom but never hidden. */}
      {orphanRows.length > 0 && (
        <div>
          <div className="sh2 sh2-quiet"><span className="t">More Work</span><span className="n">{orphanRows.length}</span></div>
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
        {/* Manage Areas / Group Into Areas retired 2026-08-29: areas are the
            categories now, and categories are managed where they live, in
            Settings. A second admin door here was the two-taxonomy world. */}
      </div></div>
      <div className="screen-foot" />
    </div>
  );
}
