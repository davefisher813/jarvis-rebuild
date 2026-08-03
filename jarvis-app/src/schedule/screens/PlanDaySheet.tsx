import { createPortal } from "react-dom";
import { useMemo, useState } from "react";
import type { EventItem } from "../types";
import { planDay, type PlanBlock } from "../planDay";
import { fmtTime } from "../calendar";
import { catColor } from "../../shared/categories";
import { FULL_DAY, type DaySizing } from "../daySizing";
import { emit } from "../../events";
import { recordPicks } from "../../events/planOutcome";
import { todayISO } from "../../tasks/grouping";

const BUFFER = 10;
const DEFAULT_DUR = 45;
const MAX_THREE = 3;

// A protected range shown in the plan: gym, meals, deep work. Fed to the planner
// as busy time so proposed blocks route around it. Phase 2.
export interface PlanBlocked { s: number; e: number; label: string }
// goal (6.7): the goal this task moves, shown under the name so picking your
// three is also picking what they advance. windowS/E: work-hours placement.
export interface PlanCandidate { id: string; text: string; category: string; suggested: boolean; overdue: boolean; goal?: string | null; windowS?: number; windowE?: number }

function fromMin(t: number) {
  const m = Math.max(0, Math.min(24 * 60 - 1, t));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function label(hhmm: string) { const t = fmtTime(hhmm); return `${t.time} ${t.ap}`; }

// Roadmap v2 Plan My Day, rebuilt small. Your anchors are already set; the one
// question is "what are today's three?". Pick up to three from Anytime and they
// drop into the open gaps at a proposed time (tap-editable later on the grid).
// "Time everything" is the grid-lover escape hatch. No sliders, no AI step.
export default function PlanDaySheet({
  events,
  tasks,
  startMin,
  endMin,
  routineConfigured = true,
  blocked = [],
  sizing = FULL_DAY,
  onEditRoutine,
  onCommit,
  onClose,
}: {
  events: EventItem[];
  tasks: PlanCandidate[];
  startMin: number;
  endMin: number;
  routineConfigured?: boolean;
  blocked?: PlanBlocked[];
  sizing?: DaySizing;
  onEditRoutine?: () => void;
  onCommit: (blocks: PlanBlock[]) => void;
  onClose: () => void;
  onAIPlan?: (picks: { id: string; text: string; category: string; overdue: boolean }[], startMin: number, endMin: number) => Promise<{ id: string; minutes: number }[]>;
}) {
  // Pre-pick the top suggested tasks, capped at three (or fewer on a light day).
  const [picks, setPicks] = useState<string[]>(() => {
    const suggested = tasks.filter((t) => t.suggested).map((t) => t.id);
    const cap = sizing.maxBlocks != null ? Math.min(sizing.maxBlocks, MAX_THREE) : MAX_THREE;
    return suggested.slice(0, cap);
  });

  const toggle = (id: string) => setPicks((prev) => {
    if (prev.includes(id)) return prev.filter((x) => x !== id);
    if (prev.length >= MAX_THREE) return prev; // up to three
    return [...prev, id];
  });

  const planFor = (ids: string[]) => {
    const rank = new Map(ids.map((id, i) => [id, i] as const));
    const picked = tasks
      .filter((t) => ids.includes(t.id))
      .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
      .map((t) => ({ id: t.id, text: t.text, category: t.category, durationMin: DEFAULT_DUR, ...(t.windowS != null ? { windowS: t.windowS } : {}), ...(t.windowE != null ? { windowE: t.windowE } : {}) }));
    return planDay(picked, events, startMin, endMin, BUFFER + sizing.extraSlackMin, blocked.map((b) => ({ s: b.s, e: b.e })));
  };

  const plan = useMemo(() => planFor(picks), [picks, tasks, events, startMin, endMin, blocked, sizing]);
  const timeFor = (id: string) => plan.blocks.find((b) => b.taskId === id)?.start ?? null;

  const count = plan.blocks.length;
  const countWord = count === 1 ? "one" : count === 2 ? "two" : "three";

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Plan My Day</div></div>
        <div className="pad-x sheet-form">
          <div className="p3-q">What are today&rsquo;s three?</div>
          <div className="plan-sub">
            {routineConfigured
              ? `Your anchors are set. Pick up to three; I’ll slot them into the open gaps before ${label(fromMin(endMin))}.`
              : `Using default hours until ${label(fromMin(endMin))}.`}
            {!routineConfigured && onEditRoutine && <button type="button" className="note-fix" onClick={onEditRoutine}>Set Your Routine</button>}
          </div>

          {tasks.length === 0 ? (
            <div className="empty-state"><div className="t-body">Nothing in Anytime to plan. Capture a few tasks first.</div></div>
          ) : (
            <div className="p3-list">
              {tasks.map((t) => {
                const i = picks.indexOf(t.id);
                const on = i >= 0;
                const at = on ? timeFor(t.id) : null;
                return (
                  <div key={t.id} className={"p3-row" + (on ? " on" : "")} role="button" tabIndex={0} onClick={() => toggle(t.id)}>
                    <div className="p3-num">{on ? i + 1 : ""}</div>
                    <span className={"cat-dot cat-bg-" + catColor(t.category)} />
                    <div className="row-grow">
                      <div className="p3-name truncate">{t.text}</div>
                      {/* What this pick MOVES (6.7): the goal at the end of
                          the task -> project -> goal chain, right where the
                          choice is being made. Derived; absent when unlinked. */}
                      {t.goal && <div className="bp-sub truncate">Moves {t.goal}</div>}
                    </div>
                    {on ? (
                      <span className="p3-time">{at ? label(at) : "No room"}</span>
                    ) : t.overdue ? (
                      <span className="plan-overdue">Overdue</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {picks.length > 0 && plan.unplaced.length > 0 && (
            <div className="input-note">Not enough open time for all of them. {plan.unplaced.map((t) => t.text).join(", ")} stays in Anytime.</div>
          )}
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" disabled={count === 0} onClick={() => {
            // Plan-vs-done (Session 6.5): record WHICH tasks were picked and in
            // what order, so tomorrow's open can score whether they happened.
            // Only the deliberate picks path; "Time everything" is not a plan
            // in this sense and is not scored.
            const day = todayISO();
            picks.forEach((id, i) => emit({ type: "plan.picked", entityType: "task", entityId: id, props: { n: i + 1 } }));
            recordPicks(day, picks);
            onCommit(plan.blocks);
          }}>
            {count === 0 ? "Pick your three" : `Add my ${countWord}`}
          </button>
          {tasks.length > 0 && (
            <button className="btn btn-secondary btn-block" onClick={() => onCommit(planFor(tasks.map((t) => t.id)).blocks)}>Time everything instead</button>
          )}
          <button className="btn btn-tertiary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
