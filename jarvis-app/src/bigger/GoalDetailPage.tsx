import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent } from "react";
import { onPressKey } from "../shared/pressable";
import type { Goal } from "../life/types";
import type { Project } from "../projects/types";
import type { GoalReach } from "./reach";
import { reachLine } from "./reach";
import type { MeasureState, Health, GoalPace } from "./measure";
import { HEALTH_LABEL, HEALTH_CLASS, nextMilestone } from "./measure";
import { CHECKIN_LABEL, type CheckinWord } from "./checkin";
import ProjectRowRuled from "./ProjectRowRuled";
import RowActionSheet from "../shared/RowActionSheet";
import { closable, projStatus, type ProjectRow } from "./progress";
import { savingsLine, savingsPct, savedNewestFirst, savedTotal } from "./savings";
import { catColor } from "../shared/categories";
import { haptics } from "../shared/haptics";
import { fmtDay } from "../decisions/DecisionsFlow";
import { formatMoney } from "../money/types";
import { monthDay } from "../money/bills";
import { capAfterNumber } from "../shared/casing";
import { TargetGlyph, ForkGlyph, FolderGlyph, DollarGlyph } from "../shared/glyphs";
import { FormSheet, Group, FieldRow, Note } from "../shared/FormSheet";
import { distanceFor, todayISO } from "../tasks/grouping";
import { PenLine } from "../shared/icons";
import { useOptionalDecisions } from "../data/NotesProvider";
import type { DecisionRecord } from "../decisions/types";

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
  reach,
  projects,
  measure = null,
  pace = null,
  health,
  onDrop,
  onOpenDecision,
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
  moving = 0,
  rowOf,
  holdLineOf,
  onCloseProject,
  moveTargets = [],
  onMoveProject,
  checkin = null,
  onCheckin,
  onMilestoneDone,
  onAddMilestone,
}: {
  goal: Goal;
  // ARCHITECTURE C: one object carries both routes into this goal's work, so
  // the page can never show a filed number and a tagged number derived from
  // two different passes over the data.
  reach: GoalReach;
  projects: Project[]; // linked to this goal
  // The open work this goal WATCHES through its areas. Never filed here, never
  // copied here: these are the same task records the Tasks tab renders.
  // PICKS 13/14/15, all DERIVED by the flow and passed in whole so this page
  // holds no second opinion about any of them.
  measure?: MeasureState | null;
  pace?: GoalPace | null;
  health?: Health;
  // PICK 17: putting a goal down on purpose, with the reason kept.
  onDrop?: (why: string) => void;
  // Pick 25: tapping the decision banner opens the record.
  onOpenDecision?: (id: string) => void;
  // True when the user actually has areas to pick from. Without it the empty
  // goal would be offered a door that opens onto nothing.
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
  // C-35 (Astra, 2026-09-12): projects under this goal whose bucket is moving.
  moving?: number;
  // The goal's projects, drawn with the Projects lens's own row (Dave
  // 2026-09-13: "mirror goals"): the ranked row for its count and status, the
  // hold line, and Close when the work is done.
  rowOf?: (projectId: string) => ProjectRow | undefined;
  holdLineOf?: (projectId: string) => string | null;
  onCloseProject?: (projectId: string) => void;
  // Move to Goal from a project row here too (Dave 2026-09-13).
  moveTargets?: { id: string; title: string }[];
  onMoveProject?: (projectId: string, goalId: string | null) => void;
  // C-37: the last self-reported check-in, and the tap that records one.
  // The card renders only when the derived health is unmeasured and there is
  // no work to measure; nothing here ever touches GoalData.state.
  checkin?: { word: CheckinWord; on: string } | null;
  onCheckin?: (word: CheckinWord) => void;
  // C-36: ticking and adding milestones, written by the flow.
  onMilestoneDone?: (id: string, done: boolean) => void;
  onAddMilestone?: (text: string) => void;
}) {
  const target = goal.data.moneyTarget;
  const progress = reach.progress;
  // Derived, never asserted: every task under every project of this goal is
  // closed AND nothing it watches is still open. Before architecture C this
  // read the filed side only, so a goal could offer to finish itself while
  // eight tagged tasks sat open in the areas it covers.
  const allWorkDone = !!progress && progress.total > 0 && progress.done >= progress.total;
  // Reaches NOTHING: no projects, no watched areas, no dollar target. Pick C
  // made "add a project" the wrong first move for this case. Tags are the
  // default way in ("tags by default, attach projects when big enough"), so
  // the loud offer on an empty goal is to name the areas it covers, which
  // costs two taps and usually fills the goal immediately from work that
  // already exists.
  const empty = projects.length === 0 && !target;
  // WAVE 4, DUPLICATE DOORS (2026-08-29). The page foot renders exactly one
  // primary, and on an empty untagged goal that primary IS "Add a Project".
  // Computed once, here, from the same three conditions the foot uses, so the
  // two can never drift into showing the same door twice or none at all.
  const bottomAddsProject =
    !!onAchieve && goal.data.state !== "achieved" && !goal.data.dropped && empty;
  // PICK 25 (Dave 2026-08-22): DECISIONS ATTACH TO THE GOAL. They already
  // could -- goals have been in the attach picker all along -- and the goal
  // page was the one place that never showed the result. The project page has
  // carried this banner since Screen 04: you reopen the thing six weeks later
  // and the reason is sitting there before you can second-guess it. A goal is
  // exactly where that matters most.
  //
  // Optional on purpose, matching ProjectDetailPage: outside a provider the
  // banner simply does not exist rather than crashing the page.
  const decisions = useOptionalDecisions();
  const [decision, setDecision] = useState<DecisionRecord | null>(null);
  useEffect(() => {
    if (!decisions) return;
    let on = true;
    void decisions.getByLink("goal", goal.id).then((d) => { if (on) setDecision(d); });
    return () => { on = false; };
  }, [decisions, goal.id]);
  const [dropOpen, setDropOpen] = useState(false);
  const [dropWhy, setDropWhy] = useState("");
  const [savingsOpen, setSavingsOpen] = useState(false);
  const [savingsAmt, setSavingsAmt] = useState("");
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const movingProject = moveFor ? projects.find((x) => x.id === moveFor) ?? null : null;
  // C-36
  const milestones = goal.data.measure?.kind === "milestones" ? goal.data.measure.items : null;
  const next = nextMilestone(goal.data.measure);
  const [addingMs, setAddingMs] = useState(false);
  const [msDraft, setMsDraft] = useState("");
  const msInput = useRef<HTMLInputElement>(null);
  // THE WHOLE ROW IS THE DOOR (Dave 2026-09-15: "I want all rows
  // clickable"). A milestone has no page of its own, so its row does its one
  // reversible verb, the tick; the key path only answers the row itself, so
  // Enter on an inner control is that control's.
  const tick = (id: string, done: boolean) => { haptics.selection(); onMilestoneDone?.(id, done); };
  const rowKey = (fn: () => void) => (e: RKeyboardEvent) => { if (e.target === e.currentTarget) onPressKey(fn)(e); };
  const commitMs = () => { const v = msDraft.trim(); if (v && onAddMilestone) onAddMilestone(v); setMsDraft(""); setAddingMs(false); };
  // C-37: only where nothing can be measured and nothing is being worked.
  const askCheckin = !!onCheckin && health === "unmeasured" && !target && !goal.data.measure && !progress && reach.openTagged === 0
    && goal.data.state !== "achieved" && !goal.data.dropped;
  const ringPct = target ? Math.min(100, Math.round(savingsPct(target, goal.data.saved))) : 0;
  // The hero's one grey line. Empty when there is nothing to say (no work
  // filed, an empty measure, a finished goal with no record): the status
  // already says it, and a row with nothing to say shows nothing (§AK).
  const heroLine = measure ? measure.line : reachLine(reach, health === "done");
  const savingsValid = Number.isFinite(Number(savingsAmt)) && Number(savingsAmt) > 0;
  return (
    <div className="screen ruled proj-ruled goal-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Goal</div>
        <button className="nav-action-text" onClick={onEdit}>Edit</button>
      </div>

      <div className="pad-x"><div className="card list-card-ruled proj-detail-hero">
        {/* C-35: on a dollar goal the ring shows the dollar measure, and the
            percent inside it is the one percent this page is allowed, because
            the bar below already draws the same number (G8 applies to text
            lines, not to the one ring). */}
        {target
          ? <div className="dring goal-ring" role="img" aria-label={savingsLine(target, goal.data.saved)} style={{ "--pct": `${ringPct}%` } as CSSProperties}><div><b>{ringPct}%</b><span>saved</span></div></div>
          : <div className="proj-icon cat-bg-graphite">{TARGET}</div>}
        {/* proj-detail-title, not nav-large: goal titles run long and the
            34px screen-title size wraps them badly */}
        <div className="proj-detail-title">{goal.data.title}</div>
        {/* PICK 15: HEALTH IS DERIVED, NEVER TYPED. GoalData.state has said
            "on_track" since the day each goal was made and nothing has ever
            updated it. This reads the same evidence the rest of the page
            reads, at render time, and is never written back.
            Unmeasured says nothing (§AK, 2026-09-26): "No Measure" was a
            placeholder, and the check-in card below already asks about it. */}
        {health && health !== "unmeasured" && <div className={"eyebrow " + HEALTH_CLASS[health]}>{HEALTH_LABEL[health]}</div>}
        {/* C-35: the projects moving it. Counts only. A count with no state,
            so it is white (§AM, 2026-09-26), as the goal row draws the same
            count; the grey belongs to the measure line under it, which is
            the card's one grey (§AK counts per card, not per line). Not
            green: the count includes projects that are behind. */}
        {moving > 0 && goal.data.measure?.kind !== "projects" && <div className="facts"><span className="fact"><b>{capAfterNumber(`${moving} ${moving === 1 ? "project" : "projects"}`)}</b></span></div>}
        {/* The ONLY place counts appear on this page. Honest null: a goal
            with no tasks under it yet draws no line instead of claiming 0%. A
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
            {/* A finish line outranks the task fractions: "2 of 3 This week"
                is what he asked to be measured on, and the task counts are
                the machinery under it. Without one, reachLine still says the
                honest thing about what the goal can see. */}
            {heroLine && <div className="bp-sub">{heroLine}</div>}
            {/* PICK 14: the arithmetic a date makes possible. Absent when
                there is nothing to pace. The date or the rate alone, in the
                Colour Key's tone for what it means (§AM, 2026-09-26): past
                its date red, due today or tomorrow amber, a date with room
                small caps, a rate the app worked out sky. */}
            {pace && <div className="facts"><span className={"fact " + pace.tone}>{pace.when}</span></div>}
            {(measure || progress) && (
              <div className="bp-bar"><div className="bp-bar-fill" style={{ width: Math.max(2, measure ? measure.pct : progress!.pct) + "%" }} /></div>
            )}
          </>
        )}
      </div></div>

      {/* C-37: THE CHECK-IN (Astra, 2026-09-12). Asked only because nothing
          here can be measured yet. Three words, one tap; the answer is an
          asked-rank strand linked to the goal and a goal.checkin event. It
          never writes GoalData.state and never changes derived health, so
          the moment a real measure arrives this card is gone and the
          measure speaks. */}
      {askCheckin && onCheckin && (
        <div className="pad-x"><div className="card pad goal-checkin">
          <div className="conn-name">How Is This Going?</div>
          <div className="conn-meta">Nothing here can be measured yet</div>
          <div className="dec-outcome-acts">
            {(["ahead", "on_track", "behind"] as CheckinWord[]).map((w) => (
              <button type="button" key={w} className={"pill-act" + (checkin?.word === w ? " on" : "")} aria-pressed={checkin?.word === w} onClick={() => onCheckin(w)}>{CHECKIN_LABEL[w]}</button>
            ))}
          </div>
          {/* The last answer is the pressed pill above; the line under it
              says only when, as a neutral date in small caps (§AM F5,
              2026-09-26). It was a receipt line, the tappable pile control,
              carrying the word, the date and two typed middle dots. */}
          {checkin && <div className="facts"><span className="fact date">Checked in {monthDay(checkin.on)}</span></div>}
        </div></div>
      )}

      {/* C-36: MILESTONES. The next one first, with its Done; then the list
          with the task-check anatomy; then Add Milestone. */}
      {milestones && (
        <>
          {next && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Next Milestone</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                <div className="row" role="button" tabIndex={0} aria-label={"Mark " + next.text + " done"}
                  onClick={() => tick(next.id, true)} onKeyDown={rowKey(() => tick(next.id, true))}>
                  <div className="row-grow">
                    {/* The head above says it is next; a grey "Up Next"
                        under the name said it twice (§AK, 2026-09-26). */}
                    <div className="conn-name">{next.text}</div>
                  </div>
                  {onMilestoneDone && <button type="button" className="pill-act" onClick={(e) => { e.stopPropagation(); onMilestoneDone(next.id, true); }}>Done</button>}
                </div>
              </div></div>
            </>
          )}
          <div className="sh2 sh2-quiet"><span className="t">Milestones</span>{milestones.length > 0 && <span className="n">{milestones.length}</span>}</div>
          <div className="pad-x"><div className="card list-card-ruled">
            {milestones.map((m) => (
              <div className={"task-row p2 ms-row" + (m.done ? " completed" : "")} key={m.id}
                role="button" tabIndex={0} aria-label={(m.done ? "Mark not done: " : "Mark done: ") + m.text}
                onClick={() => tick(m.id, !m.done)} onKeyDown={rowKey(() => tick(m.id, !m.done))}>
                <div
                  className="task-check-tap"
                  role="checkbox"
                  aria-checked={!!m.done}
                  aria-label={m.done ? "Mark not done" : "Mark done"}
                  onClick={(e) => { e.stopPropagation(); tick(m.id, !m.done); }}
                >
                  <div className={"task-check" + (m.done ? " done" : "")} />
                </div>
                <div className="task-title">
                  <span className="task-name">{m.text}</span>
                  {m.done && <div className="r-k"><span className="uchip u-done">Done {monthDay(m.done)}</span></div>}
                </div>
              </div>
            ))}
            {milestones.length === 0 && !addingMs && (
              <div className="row"><div className="row-grow"><div className="conn-meta">No milestones yet</div></div></div>
            )}
            {addingMs && onAddMilestone && (
              <div className="row" onClick={() => msInput.current?.focus()}>
                <input ref={msInput} className="input" placeholder="The next step · Enter adds" value={msDraft} autoFocus
                  onChange={(e) => setMsDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitMs(); } if (e.key === "Escape") { setAddingMs(false); setMsDraft(""); } }}
                  onBlur={commitMs} />
              </div>
            )}
            {onAddMilestone && !addingMs && <button className="row row-act" onClick={() => setAddingMs(true)}>Add Milestone</button>}
          </div></div>
        </>
      )}

      {target && onAddSavings && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Savings</span>{goal.data.saved && goal.data.saved.length > 0 && <span className="n">{goal.data.saved.length}</span>}</div>
          <div className="pad-x"><div className="card list-card-ruled">
            {savedNewestFirst(goal.data.saved).slice(0, 5).map((e, i) => (
              <div className="task-row p2" key={e.d + "-" + i}>
                <div className="task-check-tap gm-slot"><DollarGlyph /></div>
                {/* The day it was saved is a neutral date: small caps (§AM F5). */}
                <div className="task-title"><span className="task-name">{formatMoney(e.amount)}</span><div className="r-k"><span className="fact date">{monthDay(e.d)}</span></div></div>
              </div>
            ))}
            <button className="row row-act" onClick={() => { setSavingsAmt(""); setSavingsOpen(true); }}>Add to Savings</button>
          </div></div>
        </>
      )}

      {decision && (
        <div className="pad-x">
          <div className="promo-card" role={onOpenDecision ? "button" : undefined} tabIndex={onOpenDecision ? 0 : undefined}
            onClick={onOpenDecision ? () => onOpenDecision(decision.id) : undefined}>
            <div className="promo-head">
              <div className="promo-badge b-purple"><ForkGlyph /></div>
              <div className="promo-body">
                <div className="promo-title">{decision.data.decision}</div>
                {/* §AK/§AM (2026-09-26), as the project page's banner: the
                    reason is the card's one grey, and only when there is one
                    ("No reason recorded" stated nothing). The day it was
                    decided is a neutral date, small caps on a facts line of
                    its own, never a middle dot typed into the reason. */}
                {decision.data.why && <div className="promo-sub">Because {decision.data.why}</div>}
                <div className="facts"><span className="fact date">Decided {fmtDay(decision.data.createdAt)}</span></div>
              </div>
              {onOpenDecision && <div className="chev promo-chev" />}
            </div>
          </div>
        </div>
      )}

      <div className="sh2 sh2-quiet"><span className="t">Projects</span>{projects.length > 0 && <span className="n">{projects.length}</span>}</div>
      <div className="pad-x"><div className="card list-card-ruled">
        {projects.map((p) => {
          const row: ProjectRow = rowOf?.(p.id) ?? { project: p, progress: null, stalled: false, lastAt: null };
          return (
            <ProjectRowRuled key={p.id}
              title={p.data.title}
              glyphTone={"cat-fg-" + (p.data.category ? catColor(p.data.category) : "graphite")}
              next={nextActionTextOf(p.id)}
              meter={row.progress ? capAfterNumber(`${row.progress.done} of ${row.progress.total} done`) : ""}
              hold={holdLineOf?.(p.id) ?? null}
              status={projStatus(row)}
              bar={row.progress}
              onOpen={() => onOpenProject(p.id)}
              onClose={closable(row) && onCloseProject ? () => onCloseProject(p.id) : undefined}
              onHold={onMoveProject ? () => setMoveFor(p.id) : undefined} />
          );
        })}
        {/* WAVE 4, DUPLICATE DOORS (2026-08-29). On an untagged empty goal
            the foot of this card said "Add Project" while a filled
            "Add a Project" sat at the bottom of the page calling the same
            handler. The bottom one is the page's single primary move and is
            impossible to miss; this row is the standing door for a goal that
            already HAS projects, which is when the primary is not offering
            the trip. */}
        {!bottomAddsProject && <button className="row row-act" onClick={onAddProject}>Add Project</button>}
      </div></div>

      {movingProject && onMoveProject && (
        <RowActionSheet title="Move to Goal" onCancel={() => setMoveFor(null)} actions={[
          ...moveTargets.map((g) => ({ label: g.title, onPick: () => onMoveProject(movingProject.id, g.id), disabled: g.id === movingProject.data.goalId })),
          { label: "No Goal", onPick: () => onMoveProject(movingProject.id, null), disabled: !movingProject.data.goalId },
        ]} />
      )}

      {/* FROM YOUR AREAS IS GONE (Dave 2026-09-13: "Why are all of these random
          tasks and projects and goals combining?"). It listed every open task
          in the areas this goal watches, which is work nobody filed here and
          nothing on this page could edit, move or remove. A goal's page is its
          own projects; the tasks live on those projects and on Tasks. */}
      {suggestion && onLinkSuggestion && onDismissSuggestion && (
        <>
          <div className="sh2 sh2-quiet">
            <span className="t">Looks Related</span>
            <button className="see-all pill-action" aria-label="Dismiss suggestion" onClick={() => onDismissSuggestion(suggestion.id)}>Dismiss</button>
          </div>
          <div className="pad-x"><div className="card list-card-ruled">
            <div className="suggestion-row" role="button" tabIndex={0} aria-label={"Open " + suggestion.data.title}
              onClick={() => onOpenProject(suggestion.id)} onKeyDown={rowKey(() => onOpenProject(suggestion.id))}>
              <div className="sug-title">&ldquo;{suggestion.data.title}&rdquo;</div>
              <button className="btn-sm" onClick={(e) => { e.stopPropagation(); onLinkSuggestion(suggestion.id); }}>Link</button>
            </div>
          </div></div>
        </>
      )}
      <div className="screen-foot" />
      {savingsOpen && onAddSavings && (
        <FormSheet title="Add to Savings" onCancel={() => setSavingsOpen(false)} saveDisabled={!savingsValid}
          onSave={() => { if (!savingsValid) return; onAddSavings(Number(savingsAmt)); setSavingsOpen(false); }}>
          <Group label="Amount">
            <FieldRow tone="green" glyph={<DollarGlyph />} label="Dollars" value={savingsAmt} onChange={setSavingsAmt} placeholder="0" inputMode="decimal" ariaLabel="Amount in dollars" />
          </Group>
        </FormSheet>
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
      {onAchieve && goal.data.state !== "achieved" && !goal.data.dropped && (
        <div className="pad-x conn-action">
          {empty
            ? <button className="btn btn-primary btn-block" onClick={onAddProject}>Add a Project</button>
            : allWorkDone
              ? <button className="btn btn-primary btn-block" onClick={onAchieve}>All Work Done, Finish It</button>
              : <button className="btn btn-block" onClick={onAchieve}>Mark Achieved</button>}
        </div>
      )}

      {/* PICK 17: DROPPING A GOAL WRITES A DECISION (Dave 2026-08-22).
          Deleting one threw away the only part worth keeping. Six weeks later
          the question is never "what was that goal called", it is "why did I
          stop", and the app had no answer because there was nothing left to
          ask. Dropping now writes a Decision Record linked to the goal, and
          the goal itself is KEPT: it stops counting as live, it stops
          nagging from Today, and its reason is one tap away forever.

          Quiet tier, always: putting something down is a legitimate move and
          the app should not argue, but it is never the shouted one. */}
      {onDrop && !goal.data.dropped && goal.data.state !== "achieved" && (
        <div className="pad-x conn-action">
          <button className="btn btn-block" onClick={() => { setDropWhy(""); setDropOpen(true); }}>Drop This Goal</button>
        </div>
      )}
      {goal.data.dropped && (
        <div className="pad-x conn-action">
          {/* LIFE-F-27 (2026-09-05): the second clause was unconditional, so
              a goal dropped without a decision record (the write can come
              back empty) promised a reason that is not in Decisions. The
              drop's own toast already branches on decisionId; this line
              says the date it has and nothing it does not.
              §AM (2026-09-26): the date is a neutral date, small caps on its
              own facts line; the pointer is the one grey, on the line under
              it, never joined to the date by a typed middle dot. */}
          <div className="facts"><span className="fact date">Dropped {monthDay(goal.data.dropped.on)}</span></div>
          {goal.data.dropped.decisionId && <div className="conn-meta">The reason is in your decisions</div>}
        </div>
      )}
      {dropOpen && onDrop && (
        <FormSheet title="Drop This Goal" saveLabel="Drop It" onCancel={() => setDropOpen(false)} onSave={() => { onDrop(dropWhy.trim()); setDropOpen(false); }}>
          <Group label="Why">
            {/* Never disabled. A reason you cannot articulate at 11pm is
                still a real reason, and a Save that refuses to save is
                how a record stops getting written at all. */}
            <FieldRow tone="purple" glyph={<PenLine className="ic" />} value={dropWhy} onChange={setDropWhy} placeholder="e.g. the season ended" ariaLabel="Why" right={false} />
          </Group>
          <Note>Optional · Whatever you write is kept with the decision</Note>
        </FormSheet>
      )}

    </div>
  );
}
