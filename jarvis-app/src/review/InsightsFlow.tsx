import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAreas, useCategories, useGoals, useGym, useProjects, useTasks, useOptionalSeal } from "../data/NotesProvider";
import type { Area, Goal } from "../life/types";
import type { Project } from "../projects/types";
import type { TaskItem } from "../tasks/TasksService";
import { reachOf, liveGoals, buildGoalIndex, goalIdsForTask, byDue, reachLine, type GoalReach } from "../bigger/reach";
import { measureState, healthOf, paceLine, type MeasureContext } from "../bigger/measure";
import { openWorkOf } from "../today/goalPulse";
import { readSamples } from "../shared/timeSense";
import { todayISO } from "../tasks/grouping";
import { monthName, movedIn } from "./report";
import ReportFlow from "./ReportPage";
import type { MonthSeal } from "./seal";
import { goalEvidenceDays, areaPulse, areaWord, comebackLine, heavyWord, REST_DAYS } from "./life";
import { capAfterNumber } from "../shared/casing";
import { showToast } from "../shared/toast";
import { TargetGlyph, CheckCircleGlyph, SunriseGlyph } from "../shared/glyphs";
import { usePushDepth } from "../shared/pushNav";

// THE INSIGHTS SURFACE (Life View picks 1, 2, 3, 5, 6+11, 12, 14, 15;
// 2026-08-25). One place, three layers: this month still open, the sealed
// shelf, and the life layer where the dormant Area entity finally gets its
// picture. The laws of the catalog hold everywhere here: no score, silence
// before verdicts, resting is a chosen state, and at most ONE starved card
// ever renders, because a soothing surface never stacks its asks.

const CHEV = <div className="chev" />;

interface GoalRow {
  goal: Goal;
  line: string;
  extra: string | null; // comeback or heavy, comeback wins
  extraTone: "good" | "warn" | null;
  next: TaskItem | null;
}

function addDaysISO(base: string, n: number): string {
  const d = new Date(base + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---- the goal peek sheet: everything about one goal, no navigation ------

function GoalPeek({ row, onPlan, onClose }: { row: GoalRow; onPlan?: (id: string) => void; onClose: () => void }) {
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Goal</div></div>
        <div className="pad-x sheet-form">
          <div className="rep-question">{row.goal.data.title}</div>
          <div className="card rep-gap">
            <div className="row"><div className="row-grow"><div className="rep-title">{row.line}</div></div></div>
            {row.extra && (
              <div className="row"><div className="row-grow"><div className={"rep-title " + (row.extraTone === "good" ? "rep-good-glyph" : "")}>{row.extra}</div></div></div>
            )}
            {row.next && (
              <div className="row">
                <div className="row-grow">
                  <div className="rep-title">Next: {row.next.data.text}</div>
                </div>
                {onPlan && <button className="pill-act" onClick={() => onPlan(row.next!.id)}>Plan It</button>}
              </div>
            )}
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-secondary btn-block" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---- the areas sheet: setup as an invitation, one screen, chips ---------

function AreasSheet({ areas, goals, onCreate, onToggleChosen, onAssign, onRemove, onClose }: {
  areas: Area[];
  goals: Goal[];
  onCreate: (name: string) => void;
  onToggleChosen: (a: Area) => void;
  onAssign: (goalId: string, areaId: string | null) => void;
  onRemove: (a: Area) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [assigning, setAssigning] = useState<Area | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  if (assigning) {
    return createPortal(
      <div className="sheet-scrim" onClick={() => setAssigning(null)}>
        <div className="card" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-handle" />
          <div className="grp"><div className="eyebrow">Goals in {assigning.data.name}</div></div>
          <div className="pad-x sheet-form"><div className="card">
            {goals.map((g) => {
              const inArea = g.data.areaId === assigning.id;
              return (
                <div className="row" role="button" tabIndex={0} key={g.id}
                  onClick={() => onAssign(g.id, inArea ? null : assigning.id)}>
                  <div className={"task-check" + (inArea ? " done" : " cat-bd-green")} />
                  <div className="row-grow"><div className="conn-name truncate">{g.data.title}</div></div>
                </div>
              );
            })}
            {goals.length === 0 && (
              <div className="row"><div className="row-grow"><div className="conn-name">No Live Goals Yet</div></div></div>
            )}
          </div></div>
          <div className="pad-x sheet-actions">
            <button className="btn btn-secondary btn-block" onClick={() => setAssigning(null)}>Back</button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Your Areas</div></div>
        <div className="pad-x sheet-form">
          <div className="card">
            {areas.map((a) => {
              const n = goals.filter((g) => g.data.areaId === a.id).length;
              return (
              <div className="row" key={a.id}>
                <div className="row-grow" role="button" tabIndex={0} onClick={() => setAssigning(a)}>
                  <div className="conn-name truncate">{a.data.name}</div>
                  <div className="eyebrow">{capAfterNumber(`${n} ${n === 1 ? "goal" : "goals"} · Tap to assign`)}</div>
                </div>
                {/* Keep Alive is the balance choice: only chosen areas can
                    ever earn the quiet card. One tap each way. */}
                <button className="pill-act" onClick={() => onToggleChosen(a)}>{a.data.chosen ? "Kept Alive" : "Keep Alive"}</button>
                <button className="btn-sm btn-danger-text" onClick={() => (armed === a.id ? onRemove(a) : setArmed(a.id))}>{armed === a.id ? "Sure?" : "Remove"}</button>
              </div>
              );
            })}
          </div>
          <div className="field field-gap">
            <div className="input-label">New Area</div>
            <input className="input" placeholder="e.g. Health, Family, Music" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" disabled={!name.trim()} onClick={() => { onCreate(name.trim()); setName(""); }}>Add Area</button>
          <button className="btn btn-secondary btn-block" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---- the flow ------------------------------------------------------------

export default function InsightsFlow({ onBack, onOpenTask }: {
  onBack: () => void;
  onOpenTask?: (id: string) => void;
}) {
  const areasSvc = useAreas();
  const goalsSvc = useGoals();
  const projectsSvc = useProjects();
  const tasksSvc = useTasks();
  const catsSvc = useCategories();
  const gym = useGym();
  const sealSvc = useOptionalSeal();
  const today = todayISO();

  const [areas, setAreas] = useState<Area[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [seals, setSeals] = useState<MonthSeal[]>([]);
  const [liveDone, setLiveDone] = useState<number | null>(null);
  const [screen, setScreen] = useState<{ kind: "live" } | { kind: "month"; month: string } | { kind: "story" } | null>(null);
  const [areasOpen, setAreasOpen] = useState(false);
  const [peek, setPeek] = useState<GoalRow | null>(null);
  // Give It a Slot answers the quiet card, so the card leaves WITH the tap
  // (a card that stays after being answered reads as broken). Session-local
  // on purpose: the slot is not evidence yet, so next visit may ask again.
  const [hushed, setHushed] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [ar, gl, pj, tk, sl] = await Promise.all([
      areasSvc.list(),
      goalsSvc.list(),
      projectsSvc.list(),
      tasksSvc.listTasks(),
      sealSvc ? sealSvc.list() : Promise.resolve([] as MonthSeal[]),
    ]);
    setAreas(ar);
    setGoals(gl);
    setProjects(pj);
    setTasks(tk);
    setSeals(sl);
    // The This Month card's one number: seen completions this month. Cheap,
    // local, and honest about being the device's view (Still Open says so).
    const monthStart = new Date(today.slice(0, 7) + "-01T00:00:00").getTime();
    setLiveDone(readSamples().filter((s) => s.t >= monthStart).length);
  }, [areasSvc, goalsSvc, projectsSvc, tasksSvc, sealSvc, today]);
  useEffect(() => { void reload(); }, [reload]);

  // Sheets are overlays, not pushes; only the three drill-ins count as depth.
  const pushCls = usePushDepth(screen ? 1 : 0);

  const samples = readSamples();
  const live = useMemo(() => liveGoals(goals), [goals]);
  const goalIdx = useMemo(() => buildGoalIndex(projects, live), [projects, live]);

  const rows = useMemo(() => {
    const nowMs = Date.now();
    const out = new Map<string, GoalRow>();
    for (const g of live) {
      const reach: GoalReach = reachOf(tasks, projects, g);
      const ctx: MeasureContext = { reach, tasks, projects: projects.filter((p) => p.data.goalId === g.id), samples, today, now: nowMs };
      const ms = measureState(g.data.measure, ctx);
      const health = healthOf(g, ms, g.data.measure, ctx, openWorkOf(reach));
      const evidence = goalEvidenceDays(g, reach, samples);
      const comeback = comebackLine(evidence, today);
      const heavy = heavyWord(health, openWorkOf(reach) > 0);
      const pace = paceLine(ms, g.data.measure, g.data.by, today);
      const next = byDue(
        tasks.filter((t) => !t.data.done && goalIdsForTask(goalIdx, t).includes(g.id))
          .map((t) => ({ ...t, due: t.data.due ?? null })),
      )[0] ?? null;
      out.set(g.id, {
        goal: g,
        line: (ms ? ms.line : reachLine(reach)) + (pace ? " · " + pace : ""),
        extra: comeback ?? heavy,
        extraTone: comeback ? "good" : heavy ? "warn" : null,
        next,
      });
    }
    return out;
  }, [live, tasks, projects, samples, today, goalIdx]);

  const evidenceByArea = useMemo(() => {
    const map = new Map<string, string[][]>();
    for (const a of areas) {
      map.set(a.id, live.filter((g) => g.data.areaId === a.id)
        .map((g) => goalEvidenceDays(g, reachOf(tasks, projects, g), samples)));
    }
    return map;
  }, [areas, live, tasks, projects, samples]);

  // At most ONE quiet card: the most starved chosen area, and only that.
  const starvedArea = useMemo(() => {
    const candidates = areas
      .map((a) => ({ a, p: areaPulse(a, evidenceByArea.get(a.id) ?? [], today) }))
      .filter((x) => x.p.starved && x.a.id !== hushed)
      .sort((x, y) => (y.p.lastDays ?? 9999) - (x.p.lastDays ?? 9999));
    return candidates[0] ?? null;
  }, [areas, evidenceByArea, today, hushed]);

  const story = useMemo(() => {
    const items: { d: string; name: string; kind: "goal" | "project" }[] = [];
    for (const g of goals) if (g.data.achievedOn) items.push({ d: g.data.achievedOn, name: g.data.title, kind: "goal" });
    for (const p of projects) if (p.data.closedOn) items.push({ d: p.data.closedOn, name: p.data.title, kind: "project" });
    return items.sort((a, b) => b.d.localeCompare(a.d));
  }, [goals, projects]);

  const giveSlot = async (a: Area) => {
    const id = await tasksSvc.createTask(`Time for ${a.data.name}`, { due: addDaysISO(today, 1) });
    setHushed(a.id);
    showToast({
      message: `Planned time for ${a.data.name}`,
      actionLabel: "Undo",
      onAction: async () => { if (id) await tasksSvc.deleteTask(id); setHushed(null); await reload(); },
    });
    await reload();
  };
  const rest = async (a: Area) => {
    await areasSvc.update(a.id, { restingUntil: addDaysISO(today, REST_DAYS) });
    showToast({ message: `${a.data.name} is resting · Tap its chip to wake it` });
    await reload();
  };
  const wake = async (a: Area) => {
    await areasSvc.update(a.id, { restingUntil: undefined });
    await reload();
  };

  if (screen?.kind === "live") return <div className={pushCls} key="d-live"><ReportFlow live onBack={() => { setScreen(null); void reload(); }} onOpenTask={onOpenTask} /></div>;
  if (screen?.kind === "month") return <div className={pushCls} key={"d-" + screen.month}><ReportFlow month={screen.month} onBack={() => { setScreen(null); void reload(); }} onOpenTask={onOpenTask} /></div>;
  if (screen?.kind === "story") {
    let lastMonth = "";
    return (
      <div className={pushCls} key="d-story">
      <div className="screen">
        <div className="nav-bar">
          <button className="nav-back" aria-label="Back" onClick={() => setScreen(null)}></button>
          <div className="nav-title">The Long Story</div>
          <span className="nav-action"></span>
        </div>
        {story.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><SunriseGlyph /></div>
            <div className="empty-title">The First Crossing Starts It</div>
            <div className="empty-sub">Everything you achieve lands here, dated, forever</div>
          </div>
        ) : (
          <div className="pad-x">
            {story.map((it) => {
              const m = monthName(it.d.slice(0, 7)) + " " + it.d.slice(0, 4);
              const head = m !== lastMonth;
              lastMonth = m;
              return (
                <div key={it.kind + it.name + it.d}>
                  {head && <div className="day-divide">{m}</div>}
                  <div className="card"><div className="row">
                    <div className="row-glyph rep-good-glyph"><CheckCircleGlyph /></div>
                    <div className="row-grow">
                      <div className="conn-name truncate">{it.name}</div>
                      <div className="eyebrow">{it.kind === "goal" ? "Achieved" : "Closed"} · {it.d.slice(8, 10).replace(/^0/, "")} {monthName(it.d.slice(0, 7)).slice(0, 3)}</div>
                    </div>
                  </div></div>
                </div>
              );
            })}
          </div>
        )}
        <div className="screen-foot" />
      </div>
      </div>
    );
  }

  const unassigned = live.filter((g) => !g.data.areaId);
  const monthKey = today.slice(0, 7);

  const goalRow = (g: Goal) => {
    const r = rows.get(g.id);
    if (!r) return null;
    return (
      <div className="row" role="button" tabIndex={0} key={g.id} onClick={() => setPeek(r)}>
        <div className="row-grow">
          <div className="conn-name truncate">{g.data.title}</div>
          <div className="eyebrow">{r.extra ? r.extra + " · " + r.line : r.line}</div>
        </div>
        {r.next && onOpenTask && (
          <button className="pill-act" onClick={(e) => { e.stopPropagation(); onOpenTask(r.next!.id); }}>Plan It</button>
        )}
        {(!r.next || !onOpenTask) && CHEV}
      </div>
    );
  };

  return (
    <div className={pushCls} key="base">
      <div className="screen">
        <div className="nav-bar">
          <button className="nav-back" aria-label="Back" onClick={onBack}></button>
          <div className="nav-title">Insights</div>
          <span className="nav-action"></span>
        </div>

        {/* THIS MONTH: the living report, one tap away, honestly labeled. */}
        <div className="sec-head"><div className="sec-left"><div className="sec-ico nav-tile-green"><CheckCircleGlyph /></div><div className="sec-title">This Month</div></div></div>
        <div className="pad-x"><div className="card">
          <div className="row" role="button" tabIndex={0} onClick={() => setScreen({ kind: "live" })}>
            <div className="row-grow">
              <div className="conn-name">{monthName(monthKey)}, So Far</div>
              <div className="eyebrow">{liveDone != null ? capAfterNumber(`${liveDone} done · Still open`) : "Still open"}</div>
            </div>
            {CHEV}
          </div>
        </div></div>

        {/* YOUR LIFE: areas with their pulse, goals woven in with their next
            move. Works with zero setup; areas are an invitation. */}
        <div className="sec-head"><div className="sec-left"><div className="sec-ico nav-tile-red"><TargetGlyph /></div><div className="sec-title">Your Life</div></div></div>
        <div className="pad-x">
          {starvedArea && (
            <div className="card rep-gap">
              <div className="row">
                <div className="row-grow">
                  <div className="rep-title">{starvedArea.a.data.name} has been quiet a while</div>
                  <div className="eyebrow">You marked it one to keep alive</div>
                </div>
              </div>
              <div className="rep-btnrow">
                <button className="pill-act" onClick={() => void giveSlot(starvedArea.a)}>Give It a Slot</button>
                <button className="pill-act" onClick={() => void rest(starvedArea.a)}>It's Resting</button>
              </div>
            </div>
          )}

          {areas.map((a) => {
            const p = areaPulse(a, evidenceByArea.get(a.id) ?? [], today);
            const word = areaWord(p);
            const members = live.filter((g) => g.data.areaId === a.id);
            return (
              <div key={a.id} className="rep-gap">
                <div className="life-head">
                  <span className="day-divide">{a.data.name}</span>
                  {/* Only Resting is a control (tap wakes); Fed and Quiet are
                      states worn, not buttons, so they stay spans. */}
                  {word && p.resting && (
                    <button className="life-word life-rest" onClick={() => void wake(a)}>{word}</button>
                  )}
                  {word && !p.resting && (
                    <span className={"life-word" + (p.fed ? " life-fed" : " life-quiet")}>{word}</span>
                  )}
                </div>
                <div className="card">
                  {members.map(goalRow)}
                  {members.length === 0 && (
                    <div className="row"><div className="row-grow"><div className="conn-name">Nothing Live Here Yet</div><div className="eyebrow">{p.resting ? "Resting on purpose" : "Assign a goal, or let it rest"}</div></div></div>
                  )}
                </div>
              </div>
            );
          })}

          {unassigned.length > 0 && (
            <div className="rep-gap">
              {areas.length > 0 && <div className="life-head"><span className="day-divide">More Goals</span></div>}
              <div className="card">{unassigned.map(goalRow)}</div>
            </div>
          )}

          {live.length === 0 && (
            <div className="card"><div className="row"><div className="row-grow">
              <div className="conn-name">No Live Goals Yet</div>
              <div className="eyebrow">Bigger Picture is where one starts</div>
            </div></div></div>
          )}

          <div className="card rep-gap">
            <button className="row row-act" onClick={() => setAreasOpen(true)}>{areas.length > 0 ? "Manage Areas" : "Group Into Areas"}</button>
          </div>
        </div>

        {/* YOUR MONTHS: the shelf. Only ever grows; never re-scored. */}
        <div className="sec-head"><div className="sec-left"><div className="sec-title">Your Months</div></div></div>
        <div className="pad-x"><div className="card">
          {[...seals].reverse().map((s) => {
            const moved = movedIn(s.data.month, goals, projects).length + (s.data.saved > 0 ? 1 : 0);
            return (
              <div className="row" role="button" tabIndex={0} key={s.id} onClick={() => setScreen({ kind: "month", month: s.data.month })}>
                <div className="row-grow">
                  <div className="conn-name">{monthName(s.data.month)} {s.data.month.slice(0, 4)}</div>
                  <div className="eyebrow">{capAfterNumber(`${moved} moved · ${s.data.done} done`)}</div>
                </div>
                {CHEV}
              </div>
            );
          })}
          {seals.length === 0 && (
            <div className="row"><div className="row-grow">
              <div className="conn-name">No Month Sealed Yet</div>
              <div className="eyebrow">The first seals itself on the 1st</div>
            </div></div>
          )}
        </div></div>

        {/* THE LONG STORY: the ledger that only grows. */}
        <div className="pad-x rep-gap"><div className="card">
          <div className="row" role="button" tabIndex={0} onClick={() => setScreen({ kind: "story" })}>
            <div className="row-glyph rep-good-glyph"><CheckCircleGlyph /></div>
            <div className="row-grow">
              <div className="conn-name">The Long Story</div>
              <div className="eyebrow">{story.length > 0 ? capAfterNumber(`${story.length} ${story.length === 1 ? "crossing" : "crossings"} and counting`) : "Everything you achieve, dated, forever"}</div>
            </div>
            {CHEV}
          </div>
        </div></div>

        <div className="screen-foot" />
      </div>

      {peek && <GoalPeek row={peek} onPlan={onOpenTask ? (id) => { setPeek(null); onOpenTask(id); } : undefined} onClose={() => setPeek(null)} />}
      {areasOpen && (
        <AreasSheet
          areas={areas}
          goals={live}
          onCreate={(nm) => { void areasSvc.create({ name: nm, state: "steady" }).then(() => reload()); }}
          onToggleChosen={(a) => { void areasSvc.update(a.id, { chosen: !a.data.chosen }).then(() => reload()); }}
          onAssign={(goalId, areaId) => {
            const g = goals.find((x) => x.id === goalId);
            if (g) void goalsSvc.update(goalId, { ...g.data, areaId: areaId ?? undefined }).then(() => reload());
          }}
          onRemove={(a) => { void areasSvc.remove(a.id).then(() => reload()); }}
          onClose={() => setAreasOpen(false)}
        />
      )}
    </div>
  );
}
