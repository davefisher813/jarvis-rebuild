import { useState, type ReactNode } from "react";
import PageHeader from "../shared/PageHeader";
import LifeHeader, { OptionsButton, type HeaderView } from "../shared/LifeHeader";
import HeadMenu from "../shared/HeadMenu";
import OptionsSheet from "../shared/OptionsSheet";
import type { Goal } from "../life/types";
import type { ProjectRow, Progress, PaceParts } from "./progress";
import { progressLabel, bucketOf, closable, projStatus, rankGoals } from "./progress";
import type { GoalReach } from "./reach";
import { reachLine, fileableGoals } from "./reach";
import ItemCard, { CardShelf } from "./ItemCard";
import { Table, List } from "../shared/icons";
import type { MeasureState } from "./measure";
import { catColor, goalTone } from "../shared/categories";
import SkeletonRows from "../shared/SkeletonRows";
import { FolderOpenGlyph, TargetGlyph, GoalMark } from "../shared/glyphs";
import GoalRowRuled, { Bar } from "./GoalRowRuled";
import ProjectRowRuled from "./ProjectRowRuled";
import RowActionSheet from "../shared/RowActionSheet";
import { nextMilestone } from "./measure";
import { capAfterNumber } from "../shared/casing";
import { fmtDay } from "../decisions/DecisionsFlow";

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

export default function BiggerPicturePage({
  goals, reachOfGoal, measureOfGoal, extraOf, statusOf, checkinOf, projectRows, sections = [], loading, offer, onAddGoal, onOpenGoal, onAddProject, onOpenProject, nextActionTextOf, holdLineOf, sizeLineOf, paceLineOf, onCloseProject, onMoveProject,
  lens = "goals", title = "Your Life", segments,
}: {
  // THE LENS (ruled 2026-09-01, "The Lens plus Lineage rows"). One tree,
  // two zoom levels on this page: the Projects lens is every open project
  // under its category, each saying the goal it is filed to; the Goals lens
  // is every live goal under its category, Working Toward last. What used
  // to be one frame (goals with their projects nested) is two lenses now,
  // each one kind of thing, which is what a segment promises.
  lens?: "projects" | "goals";
  // The head's word and the segment control under it, when this page is a
  // segment of the Life tab. Alone it is still Your Life.
  title?: string;
  segments?: ReactNode;
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
  // THE STATUS CAPSULE (Goals and Projects, Dave 2026-09-02: "One card,
  // status capsule on the right"). The Goals lens prints one word per goal
  // in a capsule: a comeback or a heavy word when there is one, else the
  // measure's own health (On Track, Behind, Idle, Done). Null when the goal
  // has no measure and no work, because then the app has nothing to claim.
  statusOf?: (id: string) => { text: string; tone: "good" | "warn" } | null;
  // C-37: the last check-in word on a goal nothing can measure yet.
  checkinOf?: (id: string) => string | null;
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
  // UP-CORE-18 (2026-09-05): how much is left and whether the date holds,
  // derived by the flow from the project's own tasks and its due date.
  // PaceParts (projectPaceParts) is the form a row can colour; a string
  // (projectPace) is the older joined sentence, still accepted.
  paceLineOf?: (projectId: string) => PaceParts | string | null;
  onAddGoal: () => void;
  onOpenGoal: (id: string) => void;
  onAddProject: () => void;
  onOpenProject: (id: string) => void;
  // Pick 6: the row offers to close itself where the work is already done.
  onCloseProject?: (id: string) => void;
  /** Move to Goal: refile a project from its row (Dave 2026-09-13). null takes it off its goal. */
  onMoveProject?: (projectId: string, goalId: string | null) => void;
}) {
  // The sealed-off half of the page: done projects fold to one quiet line.
  const [doneOpen, setDoneOpen] = useState(false);
  // ...and so do done goals now (Dave 2026-09-09: "should done tasks be in
  // their own area? Whatever the best task management apps do is what we
  // should do"). They do: Things has the Logbook, Todoist has Completed,
  // OmniFocus has Completed perspectives. A finished thing leaves the working
  // list and stays reachable. This page already worked that way for projects
  // and did not for goals, so an achieved goal sat forever in the middle of
  // the live ones under its area head.
  const [doneGoalsOpen, setDoneGoalsOpen] = useState(false);
  // Move to Goal: the project whose hold opened the sheet (Dave 2026-09-13).
  const [moveFor, setMoveFor] = useState<string | null>(null);
  // THE VIEW CHIPS (Dave 2026-09-17, Unified Headers). This replaces the
  // Projects lens's own two-chip Paused filter (2026-09-13), which was the
  // only filtering either lens had and only appeared when something was
  // actually on hold.
  //
  // WHICH CHIPS EXIST IS DECIDED BY WHAT THE DATA HAS, not by the mockup.
  // Rule 2 of the handoff: "If Paused or Achieved does not exist, map to an
  // existing status or omit the chip for launch. Do not invent a lifecycle
  // as part of this pass."
  //
  //   Projects have active | on_hold | done (projects/types.ts), so all four
  //   chips are real. The mockup calls the middle one "Paused"; this app has
  //   called that status "On Hold" everywhere since it shipped -- on the row
  //   badge, in the project sheet, in the status picker -- so the chip says
  //   On Hold. One word per state.
  //
  //   Goals have on_track | steady | at_risk | achieved (life/types.ts).
  //   There is no paused goal, so there is no Paused chip: three, not four.
  const [view, setView] = useState("active");
  const [q, setQ] = useState("");
  const [optsOpen, setOptsOpen] = useState(false);
  /** CARDS OR ROWS (Dave 2026-09-18, the approved mockup). The cards are what
   *  he approved and the default; the ruled list stays one tap away because
   *  it is the denser read and nothing about it was asked to go. Session
   *  state, like the grouping on Tasks: a view is a way of looking, not a
   *  setting. */
  const [cardView, setCardView] = useState(true);
  /** The card's overflow opens the actions the ruled row already carries --
   *  Close It and Move to Goal -- and nothing new (the handoff: "the
   *  overflow menu keeps existing actions"). */
  const [cardMenu, setCardMenu] = useState<string | null>(null);
  /** THE AREA FILTER (2026-09-17). The one secondary control these two lenses
   *  genuinely have: both already file by area -- a project by its category,
   *  a goal by the first of its tags that names a live one -- and neither had
   *  a way to look at one area at a time, which Tasks and Notes both do. */
  const [areaOnly, setAreaOnly] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="screen">
        <PageHeader title={title} />
        {segments}
        <SkeletonRows />
      </div>
    );
  }

  const projectsLens = lens === "projects";
  // lensed: this page is one segment of Life (either lens); unlensed is the
  // old single frame, kept for anything that still mounts it alone.
  const lensed = !!segments;
  const empty = projectsLens ? projectRows.length === 0
    : lensed ? goals.length === 0
    : goals.length === 0 && projectRows.length === 0;
  if (empty) {
    // Each lens names its own emptiness and offers its own first move; a
    // Goals lens that says "add a project" is the wrong door.
    return (
      <div className="screen">
        <PageHeader title={title} />
        {segments}
        <div className="empty-state">
          <div className="empty-icon">{projectsLens ? FOLDER : TARGET}</div>
          <div className="empty-title">{projectsLens ? "No Projects Yet" : "No Goals Yet"}</div>
          <div className="empty-sub">{projectsLens ? "A project is a few tasks with a finish" : "A goal is what the work is for"}</div>
          <button className="btn btn-primary" onClick={projectsLens ? onAddProject : onAddGoal}>{projectsLens ? "Add a Project" : "Add a Goal"}</button>
        </div>
      </div>
    );
  }

  const openRows = projectRows.filter((r) => bucketOf(r) !== "done");
  const doneRows = projectRows.filter((r) => bucketOf(r) === "done");
  // A GOAL HE FINISHED IS NOT LIVE WORK. It leaves the area cards and lands
  // in the Done section at the foot of the lens, newest first, exactly as a
  // done project already does. Dropped goals are a different thing (abandoned,
  // not finished) and stay hidden as they always were.
  const liveGoals = goals.filter((g) => !g.data.dropped && g.data.state !== "achieved");
  const doneGoals = goals
    .filter((g) => !g.data.dropped && g.data.state === "achieved")
    .sort((a, b) => (b.data.achievedOn ?? "").localeCompare(a.data.achievedOn ?? ""));

  const goalById = new Map(goals.map((g) => [g.id, g] as const));
  const projRow = ({ project, progress, stalled }: ProjectRow, nested: boolean) => {
    const next = nextActionTextOf?.(project.id);
    // LINEAGE ROW (ruled 2026-09-01): on the Projects lens the project says
    // the goal it is filed to, by its short name with the goal mark, the
    // same line a task row wears. Nested under its goal it says nothing,
    // because the goal is right above it.
    const filed = !nested && project.data.goalId ? goalById.get(project.data.goalId) : undefined;
    const hold = holdLineOf?.(project.id) ?? null;
    const sized = sizeLineOf?.(project.id) ?? null;
    const paced = paceLineOf?.(project.id) ?? null;
    const canClose = closable({ project, progress, stalled, lastAt: null });
    return (
      <div className={"proj-row" + (nested ? " bp-nest" : "")} role="button" tabIndex={0} key={project.id} onClick={() => onOpenProject(project.id)}>
        <div className={"row-glyph cat-fg-" + catColor(project.data.category ?? "")}>{FOLDER}</div>
        <div className="proj-meta">
          <div className="proj-title">{project.data.title}</div>
          {filed && !filed.data.dropped && (
            <div className="bp-sub r-k"><span className={"r-goal r-is-goal " + goalTone(filed.data.tags)}><GoalMark /><span className="r-goal-t">{filed.data.title}</span></span></div>
          )}
          {/* THE NEXT MOVE LEADS (pick 19): "Call Ridgeline" tells you more
              than a status word or a fraction ever will. */}
          {next && <div className="bp-sub bp-next truncate">Next: {next}</div>}
          {/* PICK 20: the date is the whole content of a hold. */}
          {hold
            ? <div className="bp-sub bp-stalled">{hold}</div>
            : <div className={"bp-sub" + (stalled ? " bp-stalled" : "")}>{progressLabel(progress, stalled)}</div>}
          {/* PICK 22: size from the planner's own learned durations, which
              makes it an estimate the app worked out: sky (§AM). */}
          {sized && <div className="bp-sub"><span className="fact est">{sized}</span></div>}
          {/* UP-CORE-18 (2026-09-05): the pace, when the project has a date.
              A client deliverable due the 30th and a school project due
              Friday are the same shape, and the row could say everything
              about a project except when it is due.
              IN ITS PARTS (§AM, 2026-09-26): each part is its own fact, so
              the date wears its meaning's colour (late red, due amber, a
              rate sky) and the stylesheet draws the dot between them. The
              count only restates the progress line above it (5 of 8 left is
              3 of 8 done), so it rides only when a hold has taken that line;
              either way the row keeps one plain grey. A plain string is the
              older sentence form, drawn as it always was. */}
          {paced && (typeof paced === "string"
            ? <div className="bp-sub">{paced}</div>
            : (
              <div className="facts">
                {hold && <span className="fact">{paced.count}</span>}
                <span className={"fact " + paced.tone}>{paced.when}</span>
              </div>
            ))}
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
    const body = ms ? ms.line : reachLine(r, g.data.state === "achieved" || !!g.data.dropped);
    const mine = openRows.filter((row) => row.project.data.goalId === g.id);
    return (
      <div key={g.id}>
        <div className="row bp-goal" role="button" tabIndex={0} onClick={() => onOpenGoal(g.id)}>
          {/* The glyph wears the goal's own area color, brand red when it
              has none (Dave 2026-08-31; goalTone applies the same first-
              live-tag rule homeOf uses below, so glyph and section always
              agree). */}
          <div className={"row-glyph " + goalTone(g.data.tags)}>{TARGET}</div>
          <div className="row-grow">
            <div className="conn-name">{g.data.title}</div>
            <div className={"bp-sub" + (extra ? (extra.tone === "good" ? " rep-good-glyph" : " bp-stalled") : "")}>{extra ? extra.text + " · " + body : body}</div>
            {(ms || r.progress) && <Bar p={ms ? { done: ms.done, total: ms.target, pct: ms.pct } : r.progress!} />}
          </div>
          {CHEV}
        </div>
        {/* The goal's own projects ride under it, indented, on the single
            frame; on the Goals lens they live one segment over, and the
            goal page lists them. */}
        {!lensed && mine.map((row) => projRow(row, true))}
      </div>
    );
  };


  // ---- THE RULED LENSES (Goals and Projects, Dave 2026-09-02) ----
  //
  // Projects lens: "The progress pie, three lines". The folder is gone. A
  // project's glyph is a ring in its category colour that fills as its tasks
  // close, sitting where a task's check sits, so a project row and a task row
  // are the same skeleton. Line two is the fraction, the open count, the
  // learned size and the goal it climbs to; line three is the next move.
  //
  // THE CATEGORY IS THE ORGANIZER (Dave 2026-09-09: "projects should be
  // organized much more like goals. The category should be the main
  // organizer. Right now it's a list of projects"). Goals group by area, so
  // projects do too, under the same catHead with the same dot: one frame, one
  // rule, and the eight areas he already thinks in are the shelf both lists
  // sit on. The goal moved off the head and onto the row as a chip, where a
  // task row already wears its parent, so nothing about lineage was lost.
  // THE PROJECTS LENS ROW IS THE GOAL ROW (Dave 2026-09-13), drawn by
  // ProjectRowRuled so the Projects lens and a goal's own page can never
  // disagree about a project. The goal chip wears its goal's home colour, or
  // the colour of the area card it sits in when the goal has none (Dave
  // 2026-09-11).
  const pieRow = ({ project, progress, stalled }: ProjectRow) => {
    const row: ProjectRow = { project, progress, stalled, lastAt: null };
    const next = nextActionTextOf?.(project.id) ?? null;
    const hold = holdLineOf?.(project.id) ?? null;
    const filed = project.data.goalId ? goalById.get(project.data.goalId) : undefined;
    const goalHue = filed
      ? (goalTone(filed.data.tags) === "cat-fg-brand"
        ? "cat-fg-" + catColor(project.data.category ?? "")
        : goalTone(filed.data.tags))
      : "";
    return (
      <ProjectRowRuled key={project.id}
        title={project.data.title}
        glyphTone={"cat-fg-" + catColor(project.data.category ?? "")}
        next={next}
        goal={filed && !filed.data.dropped ? { title: filed.data.title, hue: goalHue } : null}
        meter={progress ? capAfterNumber(`${progress.done} of ${progress.total} done`) : "No tasks yet"}
        hold={hold}
        status={projStatus(row)}
        bar={progress}
        onOpen={() => onOpenProject(project.id)}
        onClose={closable(row) && onCloseProject ? () => onCloseProject(project.id) : undefined}
        onHold={onMoveProject ? () => setMoveFor(project.id) : undefined} />
    );
  };

  // ---------------------------------------------------------------------
  // THE CARDS (approved mockup, 2026-09-18). Same data as the rows beside
  // them, same taps; what changes is the shape.
  // ---------------------------------------------------------------------
  const projCard = ({ project, progress, stalled }: ProjectRow) => {
    const row: ProjectRow = { project, progress, stalled, lastAt: null };
    const ref = project.data.category ?? "";
    return (
      <ItemCard key={project.id} kind="project"
        title={project.data.title}
        areaRef={ref}
        lead={nextActionTextOf?.(project.id) ? "Next: " + nextActionTextOf(project.id) : holdLineOf?.(project.id) ?? null}
        foot={progress ? capAfterNumber(`${progress.done} of ${progress.total} tasks`) : "No tasks yet"}
        progress={progress}
        onOpen={() => onOpenProject(project.id)}
        menuLabel={"More for " + project.data.title}
        {...(closable(row) && onCloseProject ? { onMenu: () => setCardMenu(project.id) } : onMoveProject ? { onMenu: () => setCardMenu(project.id) } : {})}
      />
    );
  };

  /** A GOAL'S BAR IS ITS MEASURE, OR THERE IS NO BAR (the handoff, in its
   *  own words: "Do not treat linked task completion as outcome progress.
   *  For example, finishing fundraising tasks does not mean money has been
   *  raised").
   *
   *  The ruled row beside this one falls back to reach.progress -- the
   *  completion of the tasks filed under the goal -- when there is no
   *  measure. On a card that reads as "$100K is 80% raised" when what is
   *  80% done is the paperwork, so the card draws nothing instead and says
   *  what it honestly has. */
  const goalCard = (g: Goal) => {
    const ms = measureOfGoal?.(g.id) ?? null;
    const finished = g.data.state === "achieved" || !!g.data.dropped;
    const ref = homeOf(g) ?? "";
    const linked = projectRows.filter((row) => row.project.data.goalId === g.id).length;
    const lead = g.data.state === "achieved"
      ? (g.data.achievedOn ? "Finished " + fmtDay(g.data.achievedOn) : null)
      : ms ? ms.line : reachLine(reachOfGoal(g.id), finished);
    return (
      <ItemCard key={g.id} kind="goal"
        title={g.data.title}
        areaRef={ref}
        lead={lead}
        foot={linked > 0 ? capAfterNumber(`${linked} linked ${linked === 1 ? "project" : "projects"}`) : null}
        progress={ms ? { done: ms.done, total: ms.target, pct: ms.pct } : null}
        onOpen={() => onOpenGoal(g.id)}
      />
    );
  };

  // Goals lens: "One card, status capsule on the right." One card per
  // category; each goal a row with the target in the goal's own category
  // colour (the mark colour rule: always the category's, never a goal
  // green), the measure line, the status capsule right-aligned, and the
  // thin bar. The same two-line skeleton as every other ruled row.
  const goalRowRuled = (g: Goal) => {
    const r = reachOfGoal(g.id);
    const ms = measureOfGoal?.(g.id) ?? null;
    const finished = g.data.state === "achieved" || !!g.data.dropped;
    // DONE IS MARKED OFF LIKE ON TRACK, AND SAID ONCE (Dave 2026-09-09:
    // "Done should be marker off like 'on track'", after "Goals says 'done'
    // twice"). Both are true at the same time and the fix is not the capsule,
    // it is the line: the capsule is the status, so the LINE has to carry
    // something else. For a goal he finished, that is when he finished it,
    // which is the fact a Logbook row exists to show. Where the record has no
    // date (goals achieved before the stamp landed) the line stays quiet
    // rather than inventing one, and the capsule says it alone.
    const body = g.data.state === "achieved"
      ? (g.data.achievedOn ? "Finished " + fmtDay(g.data.achievedOn) : "")
      : ms ? ms.line : reachLine(r, finished);
    // C-35: the projects under it that are moving, from the same rows the
    // Projects lens buckets. C-36: the next milestone. C-37: the check-in.
    const moving = projectRows.filter((row) => row.project.data.goalId === g.id && bucketOf(row) === "moving").length;
    const next = nextMilestone(g.data.measure);
    return (
      <GoalRowRuled key={g.id} title={g.data.title} tone={goalTone(g.data.tags)}
        body={body} status={statusOf?.(g.id) ?? null}
        moving={finished || g.data.measure?.kind === "projects" ? 0 : moving} next={finished ? null : next?.text ?? null}
        checkin={finished ? null : checkinOf?.(g.id) ?? null}
        bar={ms ? { done: ms.done, total: ms.target, pct: ms.pct } : r.progress} onOpen={() => onOpenGoal(g.id)} />
    );
  };

  // (The goal-as-head, .sh2.gh-goal, is gone with the goal-first grouping it
  // existed for: the Projects lens groups by area now, and a project says its
  // goal on its own row instead. Dave 2026-09-09.)
  const catHead = (c: { id: string; name: string }, n: number) => (
    <div className="sh2 sh2-quiet">
      <span className={"cat-dot cat-bg-" + catColor(c.id)} />
      <span className="t">{c.name}</span>
      <span className="n">{n}</span>
    </div>
  );
  const ruledCard = (rows: ReactNode) => <div className="pad-x"><div className="card list-card-ruled">{rows}</div></div>;

  // The page's own Add, which belongs to no one card because the lists are
  // grouped by area. Written like every other create row in the app; the
  // ruled system strips the card's ground when the row ends up alone in it
  // (see "a create row with nothing to end is not a card" in ruled.css), so
  // this reads as one line of red text rather than a slab holding one.
  // .list-tail is the breath a caps head would have given it.
  const addRow = (label: string, onClick: () => void) => (
    <div className="pad-x"><div className="card list-card-ruled list-tail">
      <button className="row-create" onClick={onClick}>{label}</button>
    </div></div>
  );

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
  // On the Projects lens every open project is loose: nothing nests, so
  // every row lands under its category with its goal on its own line.
  const looseRows = projectsLens
    ? openRows
    : openRows.filter((r) => !r.project.data.goalId || !goalIds.has(r.project.data.goalId));
  const unassigned = projectsLens ? [] : liveGoals.filter((g) => homeOf(g) === null);
  const orphanRows = looseRows.filter((r) => !sectionIds.has(r.project.data.category ?? ""));
  const showGoals = !projectsLens;
  const showProjects = !lensed || projectsLens;

  const isPaused = (r: ProjectRow) => r.project.data.status === "on_hold";
  const pausedCount = openRows.filter(isPaused).length;
  const showPausedOnly = view === "on_hold";
  /** What the header's search leaves. Titles only, which is what a project
   *  and a goal have -- the scope line says so rather than implying more
   *  (handoff rule 4). */
  const qq = q.trim().toLowerCase();
  const hit = (t: string) => !qq || t.toLowerCase().includes(qq);
  const inView = (r: ProjectRow) =>
    view === "on_hold" ? isPaused(r)
    : view === "done" ? bucketOf(r) === "done"
    : view === "all" ? true
    : bucketOf(r) !== "done" && !isPaused(r);
  const inArea = (cat: string | null) => !areaOnly || cat === areaOnly;
  const lensRows = projectRows.filter((r) => inView(r) && hit(r.project.data.title) && inArea(r.project.data.category ?? null));
  const lensOrphans = areaOnly ? [] : orphanRows.filter((r) => inView(r) && hit(r.project.data.title));
  /** The goals this view shows. Achieved goals leave the area cards on the
   *  Active view exactly as they always have; the chips are what bring them
   *  back, in place of the folded receipt at the foot. */
  const viewGoals = (view === "achieved" ? doneGoals : view === "all" ? [...liveGoals, ...doneGoals] : liveGoals)
    .filter((g) => hit(g.data.title) && inArea(homeOf(g)));
  // The four states a project can be looked at in. They were a chip row, then
  // three of them when Done came off it, and they are a menu as of
  // 2026-09-18 ("If you drop down, make the chips drop down so everything is
  // on one row directly across") -- so Done is back, because a menu's list
  // costs the line nothing. A state with nothing in it is still where you
  // look, so these stand whatever they hold.
  const PROJECT_VIEWS: HeaderView[] = [
    { key: "active", label: "Active" },
    { key: "on_hold", label: "On Hold" },
    { key: "done", label: "Done" },
    { key: "all", label: "All" },
  ];
  const GOAL_VIEWS: HeaderView[] = [
    { key: "active", label: "Active" },
    { key: "achieved", label: "Achieved" },
    { key: "all", label: "All" },
  ];
  const movingProject = moveFor ? projectRows.find((r) => r.project.id === moveFor)?.project ?? null : null;

  /* THE TAIL BELONGS TO THE LENS, NOT TO THE LIST (2026-09-18). The folded
     receipt is the only door to a finished project or goal, and the Add row
     ends the page; both were written inside the ruled list, so the card view
     silently lost them until this pass caught it. One definition, rendered
     under whichever shape is showing. The receipt still opens its rows as
     ROWS: a done project is a receipt, and a receipt is a line, not a tile. */
  const projectTail = doneRows.length > 0 && view === "active" ? (
    <div className="pad-x"><div className="card list-card-ruled list-tail">
      <button className="receipt-line" onClick={() => setDoneOpen((v) => !v)}>
        <span className="rl-t">{capAfterNumber(`${doneRows.length} Done ${doneRows.length === 1 ? "project" : "projects"}`)}</span>
        <div className="chev" />
      </button>
      {doneOpen && doneRows.map(pieRow)}
      <button className="row-create" onClick={onAddProject}>Add Project</button>
    </div></div>
  ) : addRow("Add Project", onAddProject);

  const goalTail = doneGoals.length > 0 && view === "active" ? (
    <div className="pad-x"><div className="card list-card-ruled list-tail">
      <button className="receipt-line" onClick={() => setDoneGoalsOpen((v) => !v)}>
        <span className="rl-t">{capAfterNumber(`${doneGoals.length} Done ${doneGoals.length === 1 ? "goal" : "goals"}`)}</span>
        <div className="chev" />
      </button>
      {doneGoalsOpen && doneGoals.map(goalRowRuled)}
      <button className="row-create" onClick={onAddGoal}>Add Goal</button>
    </div></div>
  ) : addRow("Add Goal", onAddGoal);

  if (lensed) {
    const goalIdsHomed = (c: { id: string }) => rankGoals(
      viewGoals.filter((g) => homeOf(g) === c.id).map((g) => { const r = reachOfGoal(g.id); return { id: g.id, progress: r.progress, openTagged: r.openTagged, goal: g }; }),
    ).map((x) => x.goal);
    // Goals in the frame's order: homed goals section by section, then the
    // ones with no home.
    const unhomed = viewGoals.filter((g) => homeOf(g) === null);
    return (
      <div className="screen ruled">
        {/* ONE HEADER, FIVE PAGES (Dave 2026-09-17, Unified Headers). Neither
            lens had a search field or a visible Add before this: the handoff
            names that directly -- "Projects and Goals lack the same obvious
            creation/search affordances as Reminders". */}
        <PageHeader title={title} headActions={<OptionsButton onClick={() => setOptsOpen(true)} label={projectsLens ? "Projects Options" : "Goals Options"} />}>
          <LifeHeader
            query={q}
            onQuery={setQ}
            placeholder={projectsLens ? "Search Projects" : "Search Goals"}
            addLabel={projectsLens ? "New Project" : "New Goal"}
            onAdd={projectsLens ? onAddProject : onAddGoal}
            views={projectsLens ? PROJECT_VIEWS : GOAL_VIEWS}
            view={view}
            onView={setView}
            scope={qq ? {
              count: projectsLens ? lensRows.length : viewGoals.length,
              where: `${(projectsLens ? PROJECT_VIEWS : GOAL_VIEWS).find((v) => v.key === view)?.label ?? "Active"} ${projectsLens ? "projects" : "goals"}`,
              ...(view !== "all" ? { onAll: () => setView("all"), allLabel: projectsLens ? "Search all projects" : "Search all goals" } : {}),
            } : undefined}
            // THE AREA, ON ITS OWN LINE (Dave 2026-09-17: "Make multiple
            // dropdown chips like areas... Stack dropdowns next to each
            // other"). One dropdown here, because the area is the only cut
            // these two lenses have that is not a status.
            drops={(
              <>
                {sections.length > 0 && (
                  <HeadMenu
                    ariaLabel="Area"
                    value={areaOnly ?? "all"}
                    label={areaOnly ? undefined : "Area"}
                    options={[{ value: "all", label: "All Areas" }, ...sections.map((c) => ({ value: c.id, label: c.name, dot: c.color }))]}
                    onPick={(v) => setAreaOnly(v === "all" ? null : v)}
                  />
                )}
                {/* CARDS OR ROWS (approved mockup, 2026-09-18), on the line
                    the cuts already own. One control, showing the mark of
                    what it switches TO. */}
                <button type="button" className="bp-viewtog"
                  aria-label={cardView ? "Show as a list" : "Show as cards"}
                  aria-pressed={cardView}
                  onClick={() => setCardView((v) => !v)}>
                  {cardView ? <List className="ic" /> : <Table className="ic" />}
                </button>
              </>
            )}
          >
            {segments}
          </LifeHeader>
        </PageHeader>
        {/* THE ASK LIVES WITH ITS OWN KIND (Dave 2026-09-09: "why is there a
            random goal at the top that I can't even click on"). The one ask is
            a stalled PROJECT; on the Goals segment it was the only project on
            screen, wearing a target, so it read as a goal he had never made.
            It shows on Projects, and on the unlensed frame that holds both. */}
        {projectsLens && offer}

        {/* THE CARD'S OVERFLOW, carrying exactly what the ruled row carries
            (approved mockup, 2026-09-18: "the overflow menu keeps existing
            actions"). Close It where the row would offer it, Move to Goal
            where the row would. Nothing new is invented here. */}
        {cardMenu && (() => {
          const row = projectRows.find((r) => r.project.id === cardMenu);
          if (!row) return null;
          return (
            <RowActionSheet title={row.project.data.title} onCancel={() => setCardMenu(null)} actions={[
              ...(closable(row) && onCloseProject ? [{ label: "Close It", onPick: () => { setCardMenu(null); onCloseProject(row.project.id); } }] : []),
              ...(onMoveProject ? [{ label: "Move to Goal", onPick: () => { setCardMenu(null); setMoveFor(row.project.id); } }] : []),
            ]} />
          );
        })()}

        {/* MOVE TO GOAL (Dave 2026-09-13): every goal a project can be filed
            to, the one it is under disabled, and No Goal to take it off. */}
        {movingProject && onMoveProject && (
          <RowActionSheet title="Move to Goal" onCancel={() => setMoveFor(null)} actions={[
            ...fileableGoals(goals, movingProject.data.goalId).map((g) => ({ label: g.data.title, onPick: () => onMoveProject(movingProject.id, g.id), disabled: g.id === movingProject.data.goalId })),
            { label: "No Goal", onPick: () => onMoveProject(movingProject.id, null), disabled: !movingProject.data.goalId },
          ]} />
        )}
        {projectsLens && cardView ? (
          <>
            {/* ONE SHELF PER AREA (Dave 2026-09-18: "They should all be
                organized by category in each row and scroll to the right hand
                of the user"). The same buckets the ruled list below uses, in
                the same order, so switching shape never reorders the page. */}
            {sections.map((c) => {
              const mine = lensRows.filter((r) => (r.project.data.category ?? "") === c.id);
              if (mine.length === 0) return null;
              return <CardShelf key={c.id} title={c.name} onOpen={() => setAreaOnly(c.id)}>{mine.map(projCard)}</CardShelf>;
            })}
            {lensOrphans.length > 0 && (
              <CardShelf title="More Work">{lensOrphans.map(projCard)}</CardShelf>
            )}
            {lensRows.length === 0 && (
              /* L7, the app's own flow law, finally enforced (2026-09-20):
                 "an empty state always carries its action". This one stated a
                 fact and gave him nowhere to go, on the card view of the page
                 whose whole job is starting work. onAddProject was already a
                 prop on this component. */
              <div className="empty-state">
                <div className="empty-title">No Projects Here</div>
                <button className="btn btn-secondary" onClick={onAddProject}>New Project</button>
              </div>
            )}
            {projectTail}
          </>
        ) : !projectsLens && cardView ? (
          <>
            {sections.map((c) => {
              const mine = goalIdsHomed(c);
              if (mine.length === 0) return null;
              return <CardShelf key={c.id} title={c.name} onOpen={() => setAreaOnly(c.id)}>{mine.map(goalCard)}</CardShelf>;
            })}
            {unhomed.length > 0 && (
              <CardShelf title="Working Toward">{unhomed.map(goalCard)}</CardShelf>
            )}
            {viewGoals.length === 0 && (
              <div className="empty-state">
                <div className="empty-title">No Goals Here</div>
                <button className="btn btn-secondary" onClick={onAddGoal}>New Goal</button>
              </div>
            )}
            {goalTail}
          </>
        ) : projectsLens ? (
          <>
            {/* One card per area, in the frame's order, exactly as the Goals
                lens above does it. A project with no live area is not forced
                into one: it lands in More Work, adoption one tap away. */}
            {sections.map((c) => {
              const mine = lensRows.filter((r) => (r.project.data.category ?? "") === c.id);
              if (mine.length === 0) return null;
              return <div key={c.id}>{catHead(c, mine.length)}{ruledCard(mine.map(pieRow))}</div>;
            })}
            {lensOrphans.length > 0 && (
              <div>
                <div className="sh2 sh2-quiet"><span className="t">More Work</span><span className="n">{lensOrphans.length}</span></div>
                {ruledCard(lensOrphans.map(pieRow))}
              </div>
            )}
            {/* ONE CARD, NOT A STACK OF PILLS (Dave 2026-09-02: "I don't want
                single pills stacking like this they don't look good"). The
                done-projects receipt and Add Project used to be two separate
                cards, each reading as its own floating pill. Now they are
                two rows of the same card, Add Project ending it the way
                .row-create already ends every gym list -- flat red text, a
                hairline only when something sits above it, no pill ground
                when it is alone (THE PREVIEW IS THE SPEC, 2026-09-01).
                ...and when there IS no receipt above it, no card either:
                see addRow below. */}
            {/* The folded receipt was the only way to reach a done project;
                the Done chip is that door now, so it belongs to the view
                where it still is the only one. */}
            {projectTail}
          </>
        ) : (
          <>
            {sections.map((c) => {
              const mine = goalIdsHomed(c);
              if (mine.length === 0) return null;
              return <div key={c.id}>{catHead(c, mine.length)}{ruledCard(mine.map(goalRowRuled))}</div>;
            })}
            {unhomed.length > 0 && (
              <div>
                <div className="sh2 sh2-quiet"><span className="t">Working Toward</span><span className="n">{unhomed.length}</span></div>
                {ruledCard(unhomed.map(goalRowRuled))}
              </div>
            )}
            {/* THE LOGBOOK (Dave 2026-09-09: "should done tasks be in their
                own area? Whatever the best task management apps do is what we
                should do"). One folded line, opened by tap, ending in Add Goal
                -- byte for byte the receipt the Projects lens above already
                uses, because a finished goal and a finished project should
                not need two different mental models. */}
            {goalTail}
          </>
        )}
        <div className="screen-foot" />
        {/* The area moved out of here and onto the header's dropdown line
            (2026-09-17). What is left is the view that came off the chip
            row, and the one control that puts everything back. */}
        {optsOpen && (
          <OptionsSheet title={projectsLens ? "Projects Options" : "Goals Options"} rows={[
            { key: "all", label: "Show Everything", onClick: () => { setOptsOpen(false); setView("all"); setAreaOnly(null); } },
          ]} onClose={() => setOptsOpen(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      <PageHeader title={title} />
      {segments}

      {offer}

      {/* THE LIFE FRAME: one section per area that HAS anything, in Brain's
          own order. An empty area renders nothing at all -- "never ship
          empty containers" (PARA), and the old per-area "Nothing Live Here
          Yet" row was exactly the guilt-rendering that rule bans. The head's
          count is items shown, a count and never a score. The dot wears the
          area's own color, the same dot every task row already wears, so
          the two tabs read as one system at a glance. */}
      {sections.map((c) => {
        const mine = showGoals ? ranked(liveGoals.filter((g) => homeOf(g) === c.id)) : [];
        const loose = showProjects ? looseRows.filter((r) => (r.project.data.category ?? "") === c.id) : [];
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
      {showProjects && orphanRows.length > 0 && (
        <div>
          <div className="sh2 sh2-quiet"><span className="t">More Work</span><span className="n">{orphanRows.length}</span></div>
          <div><div className="list-flat">{orphanRows.map((r) => projRow(r, false))}</div></div>
        </div>
      )}

      {/* Done folds to a receipt: the shelf is Insights' job, but a closed
          project must stay one tap from reachable, not vanish. */}
      {showProjects && doneRows.length > 0 && (
        <div><div className="list-flat">
          <button className="receipt-line" onClick={() => setDoneOpen((v) => !v)}>
            <span className="rl-t">{capAfterNumber(`${doneRows.length} Done ${doneRows.length === 1 ? "project" : "projects"}`)}</span>
            <div className="chev" />
          </button>
          {doneOpen && doneRows.map((r) => projRow(r, false))}
        </div></div>
      )}

      <div><div className="list-flat">
        {showProjects && <button className="row row-act" onClick={onAddProject}>Add Project</button>}
        {showGoals && <button className="row row-act" onClick={onAddGoal}>Add Goal</button>}
        {/* Manage Areas / Group Into Areas retired 2026-08-29: areas are the
            categories now, and categories are managed where they live, in
            Settings. A second admin door here was the two-taxonomy world. */}
      </div></div>
      <div className="screen-foot" />
    </div>
  );
}
