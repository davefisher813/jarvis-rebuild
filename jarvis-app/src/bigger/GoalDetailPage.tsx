import { useEffect, useState } from "react";
import type { Goal } from "../life/types";
import type { Project } from "../projects/types";
import type { GoalReach } from "./reach";
import { reachLine, byDue } from "./reach";
import type { MeasureState, Health } from "./measure";
import { HEALTH_LABEL, HEALTH_CLASS } from "./measure";
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

export interface TaggedTask { id: string; text: string; done: boolean; due?: string | null; category?: string }

export default function GoalDetailPage({
  goal,
  reach,
  projects,
  tagged = [],
  onToggleTagged,
  canTag = false,
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
  // PICKS 13/14/15, all DERIVED by the flow and passed in whole so this page
  // holds no second opinion about any of them.
  measure?: MeasureState | null;
  pace?: string | null;
  health?: Health;
  // PICK 17: putting a goal down on purpose, with the reason kept.
  onDrop?: (why: string) => void;
  // Pick 25: tapping the decision banner opens the record.
  onOpenDecision?: (id: string) => void;
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
  // WAVE 4, DUPLICATE DOORS (2026-08-29). The page foot renders exactly one
  // primary, and on an empty untagged goal that primary IS "Add a Project".
  // Computed once, here, from the same three conditions the foot uses, so the
  // two can never drift into showing the same door twice or none at all.
  const bottomAddsProject =
    !!onAchieve && goal.data.state !== "achieved" && !goal.data.dropped && empty && !canTag;
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
  const savingsValid = Number.isFinite(Number(savingsAmt)) && Number(savingsAmt) > 0;
  return (
    <div className="screen ruled proj-ruled goal-ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Goal</div>
        <button className="nav-action-text" onClick={onEdit}>Edit</button>
      </div>

      <div className="pad-x"><div className="card list-card-ruled proj-detail-hero">
        <div className="proj-icon cat-bg-graphite">{TARGET}</div>
        {/* proj-detail-title, not nav-large: goal titles run long and the
            34px screen-title size wraps them badly */}
        <div className="proj-detail-title">{goal.data.title}</div>
        {/* PICK 15: HEALTH IS DERIVED, NEVER TYPED. GoalData.state has said
            "on_track" since the day each goal was made and nothing has ever
            updated it. This reads the same evidence the rest of the page
            reads, at render time, and is never written back. */}
        {health && <div className={"eyebrow " + HEALTH_CLASS[health]}>{HEALTH_LABEL[health]}</div>}
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
            {/* A finish line outranks the task fractions: "2 of 3 This week"
                is what he asked to be measured on, and the task counts are
                the machinery under it. Without one, reachLine still says the
                honest thing about what the goal can see. */}
            <div className="bp-sub">{measure ? measure.line : reachLine(reach)}</div>
            {/* PICK 14: the arithmetic a date makes possible. Absent when
                there is nothing to pace. */}
            {pace && <div className="bp-sub">{pace}</div>}
            {(measure || progress) && (
              <div className="bp-bar"><div className="bp-bar-fill" style={{ width: Math.max(2, measure ? measure.pct : progress!.pct) + "%" }} /></div>
            )}
          </>
        )}
      </div></div>

      {target && onAddSavings && (
        <>
          <div className="sh2 sh2-quiet"><span className="t">Savings</span>{goal.data.saved && goal.data.saved.length > 0 && <span className="n">{goal.data.saved.length}</span>}</div>
          <div className="pad-x"><div className="card list-card-ruled">
            {savedNewestFirst(goal.data.saved).slice(0, 5).map((e, i) => (
              <div className="task-row p2" key={e.d + "-" + i}>
                <div className="task-check-tap gm-slot"><DollarGlyph /></div>
                <div className="task-title"><span className="task-name">{formatMoney(e.amount)}</span><div className="r-k"><span className="r-goal r-cat">{monthDay(e.d)}</span></div></div>
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
                <div className="promo-sub">{decision.data.why ? <>Because {decision.data.why} · Decided {fmtDay(decision.data.createdAt)}</> : <>No reason recorded · Decided {fmtDay(decision.data.createdAt)}</>}</div>
              </div>
              {onOpenDecision && <div className="chev promo-chev" />}
            </div>
          </div>
        </div>
      )}

      <div className="sh2 sh2-quiet"><span className="t">Projects</span>{projects.length > 0 && <span className="n">{projects.length}</span>}</div>
      <div className="pad-x"><div className="card list-card-ruled">
        {projects.map((p) => {
          const next = nextActionTextOf(p.id);
          const stalled = !next && p.data.status !== "on_hold";
          return (
            <div className="task-row p2 proj-row-ruled" role="button" tabIndex={0} key={p.id} onClick={() => onOpenProject(p.id)}>
              <div className="task-check-tap"><span className={"pp-slot cat-fg-" + (p.data.category ? catColor(p.data.category) : "graphite")}><FolderGlyph /></span></div>
              <div className="task-title">
                <span className="task-name">{p.data.title}</span>
                {/* Next action, not counts: what would move this, in one line.
                    No next action is an honest synonym for stuck. */}
                <div className="r-k"><span className={"r-goal r-cat" + (stalled ? " r-stalled" : "")}>{next ? `Next: ${next}` : p.data.status === "on_hold" ? "Paused" : "Stalled · No next action"}</span></div>
              </div>
              {CHEV}
            </div>
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
          <div className="sh2 sh2-quiet"><span className="t">From Your Areas</span><span className="n">{taggedOpen.length}</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {shown.map((t) => {
              const dist = t.due ? distanceFor({ text: t.text, done: false, due: t.due, category: t.category ?? "" }, todayISO()) : null;
              return (
                <div className="task-row p2 proj-step" key={t.id}>
                  <div
                    className="task-check-tap"
                    role="checkbox"
                    aria-checked={false}
                    aria-label="Mark done"
                    onClick={() => { haptics.selection(); onToggleTagged?.(t.id); }}
                  >
                    <div className={"task-check cat-bd-" + catColor(t.category ?? "")} />
                  </div>
                  <div className="task-title">
                    <span className="task-name">{t.text}</span>
                    {t.due && (
                      <div className="r-k">
                        {dist && <span className={"uchip " + (dist.kind === "late" ? "u-late" : "u-today")}>{dist.label}</span>}
                        <span className="r-goal r-cat">{fmtDay(t.due)}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {moreTagged > 0 && (
              <div className="row"><div className="row-grow"><div className="conn-meta">{capAfterNumber(`${moreTagged} more in these areas`)}</div></div></div>
            )}
          </div></div>
        </>
      )}

      {suggestion && onLinkSuggestion && onDismissSuggestion && (
        <>
          <div className="sh2 sh2-quiet">
            <span className="t">Looks Related</span>
            <button className="see-all pill-action" aria-label="Dismiss suggestion" onClick={() => onDismissSuggestion(suggestion.id)}>Dismiss</button>
          </div>
          <div className="pad-x"><div className="card list-card-ruled">
            <div className="suggestion-row">
              <div className="sug-title">&ldquo;{suggestion.data.title}&rdquo;</div>
              <button className="btn-sm" onClick={() => onLinkSuggestion(suggestion.id)}>Link</button>
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
            ? (canTag
              ? <button className="btn btn-primary btn-block" onClick={onEdit}>Choose Its Areas</button>
              : <button className="btn btn-primary btn-block" onClick={onAddProject}>Add a Project</button>)
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
          <div className="conn-meta">Dropped {monthDay(goal.data.dropped.on)} · The reason is in your decisions</div>
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
