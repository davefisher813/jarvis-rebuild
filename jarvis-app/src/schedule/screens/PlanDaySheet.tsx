import { createPortal } from "react-dom";
import { Fragment, useMemo, useState } from "react";
import type { EventItem } from "../types";
import { planDay, type PlanBlock } from "../planDay";
import { fmtTime } from "../calendar";
import { catColor } from "../../shared/categories";
import { FULL_DAY, type DaySizing } from "../daySizing";

const BUFFER = 10;
const DEFAULT_DUR = 45;

// A protected range shown in the plan: gym, meals, deep work. Rendered like a
// fixed event and fed to the planner as busy time. Phase 2.
export interface PlanBlocked { s: number; e: number; label: string }

function fromMin(t: number) {
  const m = Math.max(0, Math.min(24 * 60 - 1, t));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function toMin(hhmm: string) { const p = hhmm.split(":"); return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0); }
function label(hhmm: string) { const t = fmtTime(hhmm); return `${t.time} ${t.ap}`; }

export interface PlanCandidate { id: string; text: string; category: string; suggested: boolean; overdue: boolean }

// Two-step planner: pick what to do, then review the auto-built day before it
// becomes real events. Designed to remove planning friction: smart pre-selects,
// auto-placement around existing events, realistic durations, gentle limits.
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
  onAIPlan,
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
  const [phase, setPhase] = useState<"pick" | "preview">("pick");
  // On a lighter day (yesterday felt underwater), pre-select fewer tasks. The
  // user can still add more: this is a gentle default, not a cap.
  const [selected, setSelected] = useState<Set<string>>(() => {
    const suggested = tasks.filter((t) => t.suggested).map((t) => t.id);
    const seed = sizing.maxBlocks != null ? suggested.slice(0, sizing.maxBlocks) : suggested;
    return new Set(seed);
  });
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [start, setStart] = useState(startMin);
  const [order, setOrder] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiUsed, setAiUsed] = useState(false);

  const dur = (id: string) => durations[id] ?? DEFAULT_DUR;
  const toggle = (id: string) => { if (aiLoading) return; setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const bump = (id: string, delta: number) => setDurations((d) => ({ ...d, [id]: Math.max(10, Math.min(180, dur(id) + delta)) }));
  const remove = (id: string) => setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });

  const orderedTasks = useMemo(() => {
    if (!order.length) return tasks;
    const rank = new Map(order.map((id, i) => [id, i] as const));
    return [...tasks].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  }, [tasks, order]);

  const plan = useMemo(() => {
    const picks = orderedTasks.filter((t) => selected.has(t.id)).map((t) => ({ id: t.id, text: t.text, category: t.category, durationMin: dur(t.id) }));
    return planDay(picks, events, start, endMin, BUFFER + sizing.extraSlackMin, blocked.map((b) => ({ s: b.s, e: b.e })));
  }, [orderedTasks, selected, durations, start, events, blocked, sizing]);

  const runAI = async () => {
    if (!onAIPlan) return;
    const picks = tasks.filter((t) => selected.has(t.id)).map((t) => ({ id: t.id, text: t.text, category: t.category, overdue: t.overdue }));
    setAiLoading(true);
    setAiError(null);
    try {
      const items = await onAIPlan(picks, start, endMin);
      setDurations(Object.fromEntries(items.map((it) => [it.id, it.minutes])));
      setOrder(items.map((it) => it.id));
      setAiUsed(true);
      setPhase("preview");
    } catch {
      setAiError("AI couldn't plan just now, so I built it the simple way.");
      setAiUsed(false);
      setPhase("preview");
    } finally {
      setAiLoading(false);
    }
  };

  const buildManually = () => { setAiUsed(false); setOrder([]); setDurations({}); setAiError(null); setPhase("preview"); };

  // Existing events + protected time + proposed blocks, merged in time order
  // for the preview. Protected time renders like a fixed event: not editable.
  const rows = useMemo(() => {
    const fixed = events.map((e) => ({ kind: "fixed" as const, start: e.data.start, title: e.data.title, category: e.data.category, end: e.data.end }));
    const prot = blocked.map((b) => ({ kind: "protected" as const, start: fromMin(b.s), title: b.label, category: "", end: fromMin(b.e) }));
    const made = plan.blocks.map((b) => ({ kind: "block" as const, start: b.start, title: b.text, category: b.category, end: b.end, taskId: b.taskId }));
    return [...fixed, ...prot, ...made].sort((a, b) => a.start.localeCompare(b.start));
  }, [events, plan, blocked]);

  const selCount = selected.size;

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />

        {phase === "pick" ? (
          <>
            <div className="grp"><div className="eyebrow">Plan Your Day</div></div>
            <div className="pad-x sheet-form">
              <div className="plan-sub">Pick what you want to get done. I'll fit it around what's already on your schedule.</div>
              {sizing.note && <div className="input-note">{sizing.note}</div>}
              {routineConfigured ? (
                <div className="input-help">Planning within your active hours, until {label(fromMin(endMin))}.</div>
              ) : (
                <div className="input-note">
                  Using default hours, until {label(fromMin(endMin))}.
                  {onEditRoutine && <button type="button" className="note-fix" onClick={onEditRoutine}>Set Your Routine</button>}
                </div>
              )}

              <div className="field">
                <label className="input-label">Start At</label>
                <input type="time" className="input" value={fromMin(start)} onChange={(e) => setStart(toMin(e.target.value))} />
              </div>

              {tasks.length === 0 ? (
                <div className="empty-state"><div className="t-body">No tasks to plan yet. Add a few first.</div></div>
              ) : (
                <div className="plan-list">
                  {tasks.map((t, i) => {
                    const showDivider = !t.suggested && (i === 0 || !!tasks[i - 1]?.suggested);
                    return (
                      <Fragment key={t.id}>
                        {showDivider && <div className="plan-divider">Other Tasks</div>}
                        <div className="plan-pick" role="button" tabIndex={0} onClick={() => toggle(t.id)}>
                          <div className="task-check-tap">
                            <div className={"task-check " + (selected.has(t.id) ? "done" : "cat-bd-" + catColor(t.category))} />
                          </div>
                          <div className="task-title">{t.text}</div>
                          {t.overdue && <span className="plan-overdue">Overdue</span>}
                        </div>
                      </Fragment>
                    );
                  })}
                </div>
              )}

              {selCount > 6 && <div className="input-note">That's a full day. It's fine to start with just a few.</div>}
            </div>
            <div className="pad-x sheet-actions">
              {aiLoading ? (
                <button className="btn btn-primary btn-block" disabled>Planning your day...</button>
              ) : onAIPlan ? (
                <>
                  <button className="btn btn-primary btn-block" disabled={selCount === 0} onClick={runAI}>Let AI Plan It</button>
                  <button className="btn btn-secondary btn-block" disabled={selCount === 0} onClick={buildManually}>Build It Myself</button>
                </>
              ) : (
                <button className="btn btn-primary btn-block" disabled={selCount === 0} onClick={buildManually}>Build It</button>
              )}
              {!aiLoading && <button className="btn btn-secondary btn-block" onClick={onClose}>Cancel</button>}
            </div>
          </>
        ) : (
          <>
            <div className="grp"><div className="eyebrow">Your Day</div></div>
            <div className="pad-x sheet-form">
              <div className="plan-sub">
                {plan.blocks.length === 0
                  ? "No room left in the day for these. Try an earlier start or fewer tasks."
                  : aiUsed
                    ? `AI ordered and sized these ${plan.blocks.length} ${plan.blocks.length === 1 ? "block" : "blocks"}. Adjust anything, then add to your day.`
                    : `${plan.blocks.length} ${plan.blocks.length === 1 ? "block" : "blocks"} added. Adjust anything, then add it to your day.`}
              </div>
              {aiError && <div className="input-note">{aiError}</div>}

              <div className="plan-timeline">
                {rows.map((r, i) => (
                  <div className={"plan-row" + (r.kind === "block" ? "" : " plan-row-fixed")} key={i}>
                    <div className="plan-time">{label(r.start)}</div>
                    <div className="plan-body">
                      <div className="plan-title">{r.title}</div>
                      {r.kind === "block" ? (
                        <div className="plan-controls">
                          <button className="plan-step" onClick={() => bump(r.taskId, -15)} aria-label="Shorter">−</button>
                          <span className="plan-dur">{toMin(r.end) - toMin(r.start)}m</span>
                          <button className="plan-step" onClick={() => bump(r.taskId, 15)} aria-label="Longer">+</button>
                          <button className="plan-drop" onClick={() => remove(r.taskId)}>Remove</button>
                        </div>
                      ) : (
                        <div className="plan-tag">{r.kind === "protected" ? "Protected" : "Already scheduled"}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {plan.unplaced.length > 0 && (
                <div className="input-note">Didn't fit, still on your list: {plan.unplaced.map((t) => t.text).join(", ")}.</div>
              )}
            </div>
            <div className="pad-x sheet-actions">
              <button className="btn btn-primary btn-block" disabled={plan.blocks.length === 0} onClick={() => onCommit(plan.blocks)}>Add to my day</button>
              <button className="btn btn-secondary btn-block" onClick={() => setPhase("pick")}>Back</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
