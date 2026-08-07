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
const DUR_STEP = 15;
const DUR_MIN = 15;
const DUR_MAX = 180;

// A protected range shown in the plan: gym, meals, deep work. Fed to the planner
// as busy time so proposed blocks route around it. Phase 2.
export interface PlanBlocked { s: number; e: number; label: string }
// goal (6.7): the goal this task moves, shown under the name so picking a
// task is also picking what it advances. windowS/E: work-hours placement.
export interface PlanCandidate { id: string; text: string; category: string; suggested: boolean; overdue: boolean; goal?: string | null; windowS?: number; windowE?: number }

function fromMin(t: number) {
  const m = Math.max(0, Math.min(24 * 60 - 1, t));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function toMin(hhmm: string): number {
  const p = hhmm.split(":");
  return Number(p[0] ?? 0) * 60 + Number(p[1] ?? 0);
}
function label(hhmm: string) { const t = fmtTime(hhmm); return `${t.time} ${t.ap}`; }

// Plan My Day, redesigned 2026-08-06. Dave: "still very inconvenient... needs
// to be simple and effective and flexible", specifically: no hard cap on how
// many tasks you can pick, a real way to adjust each one's length, a way to
// move a pick's time before committing (not just after, back on the grid),
// and protected/routine time that's visible instead of an invisible wall.
// So: pick as many as fit (sizing.maxBlocks still lightens an underwater day,
// nothing more); each pick gets a stepper for length and a time field that
// starts at its proposed slot. Typing a time is a deliberate placement: it
// can land inside a protected range on purpose, since overriding it by hand
// is the whole point, and it blocks that slot for anything auto-placed after
// it. "Time everything" is still the grid-lover escape hatch.
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
  // Pre-pick the top suggested tasks: capped on a light day (sizing.maxBlocks),
  // otherwise just a sane starter set; picking more is always available.
  const [picks, setPicks] = useState<string[]>(() => {
    const suggested = tasks.filter((t) => t.suggested).map((t) => t.id);
    const seedCap = sizing.maxBlocks ?? 3;
    return suggested.slice(0, seedCap);
  });
  // Per-task overrides, set 2026-08-06. durations: length in minutes, keyed by
  // task id, defaulting to DEFAULT_DUR until nudged. overrides: an exact HH:MM
  // start time the user set by hand, taking precedence over auto-placement.
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const durFor = (id: string) => durations[id] ?? DEFAULT_DUR;
  const setDur = (id: string, next: number) => setDurations((prev) => ({ ...prev, [id]: Math.max(DUR_MIN, Math.min(DUR_MAX, next)) }));
  const setOverride = (id: string, hhmm: string) => setOverrides((prev) => {
    if (!hhmm) { const n = { ...prev }; delete n[id]; return n; }
    return { ...prev, [id]: hhmm };
  });
  const clearOverride = (id: string) => setOverrides((prev) => { const n = { ...prev }; delete n[id]; return n; });

  // Brain Personalization Phase 1 (2026-08-06): an explicit, opt-in "Estimate
  // with AI" action rather than a silent call on every open, so the AI cost
  // and latency stay visible. On success it reorders the current picks by the
  // AI's judgment and fills in each one's length; the stepper and time field
  // above stay available to hand-adjust from there, same as any other pick.
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(false);
  // Brain Personalization Phase 2 (2026-08-06): the AI's last estimate per
  // task, kept separate from `durations` (which the stepper may move further
  // after this). Compared at commit time so a real hand-adjustment becomes a
  // signal, not just this session's UI state.
  const [aiEstimates, setAiEstimates] = useState<Record<string, number>>({});
  const estimateWithAI = async () => {
    if (!onAIPlan || picks.length === 0 || aiBusy) return;
    setAiBusy(true);
    setAiError(false);
    try {
      const picked = tasks
        .filter((t) => picks.includes(t.id))
        .map((t) => ({ id: t.id, text: t.text, category: t.category, overdue: t.overdue }));
      const result = await onAIPlan(picked, startMin, endMin);
      const order = result.map((r) => r.id).filter((id) => picks.includes(id));
      const leftover = picks.filter((id) => !order.includes(id));
      setPicks([...order, ...leftover]);
      setDurations((prev) => {
        const next = { ...prev };
        result.forEach((r) => { next[r.id] = r.minutes; });
        return next;
      });
      setAiEstimates((prev) => {
        const next = { ...prev };
        result.forEach((r) => { next[r.id] = r.minutes; });
        return next;
      });
    } catch {
      setAiError(true);
    } finally {
      setAiBusy(false);
    }
  };

  const toggle = (id: string) => setPicks((prev) => {
    if (prev.includes(id)) return prev.filter((x) => x !== id);
    if (sizing.maxBlocks != null && prev.length >= sizing.maxBlocks) return prev;
    return [...prev, id];
  });

  const planFor = (ids: string[]) => {
    const rank = new Map(ids.map((id, i) => [id, i] as const));
    const ordered = tasks.filter((t) => ids.includes(t.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));

    // Hand-set times are placed literally first (they're deliberate, per Dave:
    // "you can schedule anything during those times"), then everything else
    // auto-places around events, protected time, AND those manual picks, so
    // two picks never land on top of each other.
    const manual: PlanBlock[] = [];
    const auto: { id: string; text: string; category: string; durationMin: number; windowS?: number; windowE?: number }[] = [];
    for (const t of ordered) {
      const dur = durFor(t.id);
      const ov = overrides[t.id];
      if (ov) {
        const s = toMin(ov);
        manual.push({ taskId: t.id, text: t.text, category: t.category, start: fromMin(s), end: fromMin(s + dur) });
      } else {
        auto.push({ id: t.id, text: t.text, category: t.category, durationMin: dur, ...(t.windowS != null ? { windowS: t.windowS } : {}), ...(t.windowE != null ? { windowE: t.windowE } : {}) });
      }
    }
    const manualBusy = manual.map((b) => ({ s: toMin(b.start), e: toMin(b.end) }));
    const autoResult = planDay(auto, events, startMin, endMin, BUFFER + sizing.extraSlackMin, [...blocked.map((b) => ({ s: b.s, e: b.e })), ...manualBusy]);
    const blocks = [...manual, ...autoResult.blocks].sort((a, b) => a.start.localeCompare(b.start));
    return { blocks, unplaced: autoResult.unplaced };
  };

  const plan = useMemo(() => planFor(picks), [picks, tasks, events, startMin, endMin, blocked, sizing, durations, overrides]);
  const timeFor = (id: string) => plan.blocks.find((b) => b.taskId === id)?.start ?? null;

  const count = plan.blocks.length;
  const countLabel = count === 1 ? "my one" : count === 2 ? "my two" : count === 3 ? "my three" : `these ${count}`;

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Plan My Day</div></div>
        <div className="pad-x sheet-form">
          <div className="p3-q">What fits today?</div>
          <div className="plan-sub">
            {routineConfigured
              ? (sizing.maxBlocks != null
                  ? `Your anchors are set. Pick up to ${sizing.maxBlocks}; I’ll slot them into the open gaps before ${label(fromMin(endMin))}.`
                  : `Your anchors are set. Pick as many as you like; I’ll slot them into the open gaps before ${label(fromMin(endMin))}.`)
              : `Using default hours until ${label(fromMin(endMin))}.`}
            {!routineConfigured && onEditRoutine && <button type="button" className="note-fix" onClick={onEditRoutine}>Set Your Routine</button>}
          </div>
          {blocked.length > 0 && (
            <div className="plan-sub">
              Protected today: {blocked.map((b) => `${b.label} ${label(fromMin(b.s))}–${label(fromMin(b.e))}`).join(", ")}. Auto-placed picks route around these; set a time by hand if you want to schedule over one.
            </div>
          )}
          {onAIPlan && picks.length > 0 && (
            <div className="input-note">
              <button type="button" className="note-fix" disabled={aiBusy} onClick={estimateWithAI}>
                {aiBusy ? "Estimating…" : "Estimate with AI"}
              </button>
              {aiError && <span>Couldn&rsquo;t reach the AI. Lengths stay as they are.</span>}
            </div>
          )}

          {tasks.length === 0 ? (
            <div className="empty-state"><div className="t-body">Nothing in Anytime to plan. Capture a few tasks first.</div></div>
          ) : (
            <div className="p3-list">
              {tasks.map((t) => {
                const i = picks.indexOf(t.id);
                const on = i >= 0;
                const at = on ? timeFor(t.id) : null;
                return (
                  <div key={t.id}>
                    <div className={"p3-row" + (on ? " on" : "")} role="button" tabIndex={0} onClick={() => toggle(t.id)}>
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
                    {/* Per-pick length + time controls (2026-08-06): a stepper
                        for duration, and a time field pre-filled with the
                        proposed slot that becomes a fixed placement the moment
                        it's edited by hand. */}
                    {on && (
                      <div className="plan-controls" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="plan-step" aria-label={`${t.text}: shorter`} onClick={() => setDur(t.id, durFor(t.id) - DUR_STEP)}>−</button>
                        <span className="plan-dur">{durFor(t.id)}m</span>
                        <button type="button" className="plan-step" aria-label={`${t.text}: longer`} onClick={() => setDur(t.id, durFor(t.id) + DUR_STEP)}>+</button>
                        <input
                          type="time"
                          className="input input-compact"
                          aria-label={`${t.text}: time`}
                          value={overrides[t.id] ?? at ?? ""}
                          onChange={(e) => setOverride(t.id, e.target.value)}
                        />
                        {overrides[t.id] && (
                          <button type="button" className="plan-drop" onClick={() => clearOverride(t.id)}>Auto</button>
                        )}
                      </div>
                    )}
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
            // Brain Personalization Phase 2 (2026-08-06): a pick the AI
            // estimated, where the committed length ended up different, is a
            // real correction signal. Logged here (once, at the deliberate
            // commit point), not on every stepper tap, so this reflects what
            // the user actually decided to go with.
            for (const id of picks) {
              const est = aiEstimates[id];
              if (est == null) continue;
              const delta = durFor(id) - est;
              if (delta === 0) continue;
              const category = tasks.find((t) => t.id === id)?.category ?? "";
              if (!category) continue;
              emit({ type: "plan.duration_corrected", entityType: "task", entityId: id, props: { category, n: delta } });
            }
            recordPicks(day, picks);
            onCommit(plan.blocks);
          }}>
            {count === 0 ? "Pick your tasks" : `Add ${countLabel}`}
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
