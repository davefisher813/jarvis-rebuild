import { useCallback, useEffect, useMemo, useState } from "react";
import { useGoals, useProjects, useOptionalSeal, useOptionalSchedule, useOptionalCategories, useOptionalGym, useOptionalRoutine, useOptionalRules } from "../data/NotesProvider";
import { buildWeek, type WeekReport } from "./week";
import { hoursLabel } from "./hours";
import { readWindow, type WindowClient } from "../brain/window";
import { supabase } from "../auth/supabaseClient";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { filledIcon } from "../shared/filledIcons";
import type { Goal } from "../life/types";
import type { Project } from "../projects/types";
import { completionSamples } from "../events/completions";
import { todayISO } from "../tasks/grouping";
import { monthName, movedIn } from "./report";
import ReportFlow from "./ReportPage";
import type { MonthSeal } from "./seal";
import { capAfterNumber } from "../shared/casing";
import { Nums } from "../bigger/GoalRowRuled";
import { CheckCircleGlyph, SunriseGlyph } from "../shared/glyphs";
import { usePushDepth } from "../shared/pushNav";
import PageHeader from "../shared/PageHeader";
import { pressable } from "../shared/pressable";

// INSIGHTS IS PURE TIME (the Life Merge, Dave 2026-08-26: "it's stupid
// having them separate"). The life layer this surface carried for one day
// (areas, goals, the quiet card) moved into Your Life, where the work
// already lives; goals now render in exactly one place. What stays here is
// the mirror: this month still open, the sealed shelf, and the ledger that
// only grows. The mirror stays its own room so review never feels like
// being graded at the workbench.

const CHEV = <div className="chev" />;
// "6h", "4h 30m": the legend's hours, the report's own label.
const hoursOf = (minutes: number) => hoursLabel(minutes);

export default function InsightsFlow({ onBack, onOpenTask }: {
  onBack: () => void;
  onOpenTask?: (id: string) => void;
}) {
  const goalsSvc = useGoals();
  const projectsSvc = useProjects();
  const sealSvc = useOptionalSeal();
  const today = todayISO();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [seals, setSeals] = useState<MonthSeal[]>([]);
  const [liveDone, setLiveDone] = useState<number | null>(null);
  // C-64 (Astra, 2026-09-12): THIS WEEK. The same window read the Brain
  // makes, folded by review/week.ts through computeSeal over seven days.
  // Every service is optional: a harness without one simply gets a
  // thinner card, never a broken page.
  const schedSvc = useOptionalSchedule();
  const catsSvc = useOptionalCategories();
  const gymSvc = useOptionalGym();
  const routineSvc = useOptionalRoutine();
  const rulesSvc = useOptionalRules();
  const [week, setWeek] = useState<WeekReport | null>(null);
  const [cats, setCats] = useState<{ id: string; name: string; color: string }[]>([]);
  const [offered, setOffered] = useState(false);
  const loadWeek = useCallback(async (gl: Goal[], pj: Project[]) => {
    try {
      const now = Date.now();
      const [rows, events, workouts, categories, routine, rule] = await Promise.all([
        readWindow(supabase as unknown as WindowClient | null, now, 15),
        schedSvc ? schedSvc.listEvents().catch(() => []) : Promise.resolve([]),
        gymSvc ? gymSvc.listWorkouts().catch(() => []) : Promise.resolve([]),
        catsSvc ? catsSvc.list().catch(() => []) : Promise.resolve([]),
        routineSvc ? routineSvc.get().catch(() => null) : Promise.resolve(null),
        rulesSvc ? rulesSvc.resolve("plan.focus", "week").catch(() => null) : Promise.resolve(null),
      ]);
      const cs = categories.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color }));
      setCats(cs);
      const days7 = new Set(buildWeek({ today, rows: [], events: [], workouts: [], goals: [], projects: [], categories: [] }).days);
      const work = routine ? Math.max(0, routine.workEndMin - routine.workStartMin) : undefined;
      // The rule is pre-announced by create(); the doctrine still wants the
      // consulting file to say so, and this is a no-op on an announced rule.
      if (rule && rulesSvc) await rulesSvc.announceIfFirstUse(rule);
      setOffered(!!rule);
      setWeek(buildWeek({
        today, rows: rows.filter((r) => days7.has(r.day)), prevRows: rows.filter((r) => !days7.has(r.day)),
        events, workouts, goals: gl, projects: pj, categories: cs,
        ...(work ? { workMinutesPerDay: work } : {}), alreadyOffered: !!rule,
      }));
    } catch { setWeek(null); }
  }, [schedSvc, gymSvc, catsSvc, routineSvc, rulesSvc, today]);
  const [screen, setScreen] = useState<{ kind: "live" } | { kind: "month"; month: string } | { kind: "story" } | null>(null);

  const reload = useCallback(async () => {
    const [gl, pj, sl] = await Promise.all([
      goalsSvc.list(),
      projectsSvc.list(),
      sealSvc ? sealSvc.list() : Promise.resolve([] as MonthSeal[]),
    ]);
    setGoals(gl);
    setProjects(pj);
    setSeals(sl);
    void loadWeek(gl, pj);
    // The This Month card's one number: seen completions this month. Still a
    // local read (Still Open says so), but now off the same unified log the
    // category page counts from (2026-08-29), not the smaller sample array.
    const monthStart = new Date(today.slice(0, 7) + "-01T00:00:00").getTime();
    setLiveDone(completionSamples().filter((s) => s.t >= monthStart).length);
  }, [goalsSvc, projectsSvc, sealSvc, today, loadWeek]);
  useEffect(() => { void reload(); }, [reload]);

  // C-64: the One Change. Move Two Blocks writes the plan.focus rule the way
  // the month report's cap writes plan.cap: one deliberate tap, one row in
  // What JARVIS Learned, deletable there. No Thanks leaves it for next week.
  const moveTwoBlocks = async () => {
    if (!rulesSvc || !week?.next) return;
    const area = week.next.name;
    let id: string | null = null;
    const ok = await attemptWrite(async () => { id = (await rulesSvc.create("tuning", "plan.focus", "week", "2", `Chosen from the weekly report: two focus blocks aimed at ${area}`)).id; });
    if (!ok) return;
    setOffered(true);
    const ruleId = id;
    showToast({ message: `Two blocks aimed at ${area} next week`, actionLabel: "Undo", onAction: () => void (async () => {
      if (ruleId) await attemptWrite(() => rulesSvc.delete(ruleId));
      setOffered(false);
    })() });
  };
  const noThanks = () => setOffered(true);

  const pushCls = usePushDepth(screen ? 1 : 0);

  const story = useMemo(() => {
    const items: { d: string; name: string; kind: "goal" | "project" }[] = [];
    for (const g of goals) if (g.data.achievedOn) items.push({ d: g.data.achievedOn, name: g.data.title, kind: "goal" });
    for (const p of projects) if (p.data.closedOn) items.push({ d: p.data.closedOn, name: p.data.title, kind: "project" });
    return items.sort((a, b) => b.d.localeCompare(a.d));
  }, [goals, projects]);

  // Grouped by month, one card per month (every band is one card): a run of
  // items sharing the same header collapse into a single list-card-ruled
  // instead of each wearing its own.
  const storyGroups = useMemo(() => {
    const out: { month: string; items: typeof story }[] = [];
    for (const it of story) {
      const m = monthName(it.d.slice(0, 7)) + " " + it.d.slice(0, 4);
      const g = out[out.length - 1];
      if (g && g.month === m) g.items.push(it); else out.push({ month: m, items: [it] });
    }
    return out;
  }, [story]);

  if (screen?.kind === "live") return <div className={pushCls} key="d-live"><ReportFlow live onBack={() => { setScreen(null); void reload(); }} onOpenTask={onOpenTask} /></div>;
  if (screen?.kind === "month") return <div className={pushCls} key={"d-" + screen.month}><ReportFlow month={screen.month} onBack={() => { setScreen(null); void reload(); }} onOpenTask={onOpenTask} /></div>;
  if (screen?.kind === "story") {
    return (
      <div className={pushCls} key="d-story">
      <div className="screen ruled">
        <PageHeader title="The Long Story" back="Insights" onBack={() => setScreen(null)} />
        {story.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><SunriseGlyph /></div>
            <div className="empty-title">The First Crossing Starts It</div>
            <div className="empty-sub">Everything you achieve lands here, dated, forever</div>
          </div>
        ) : (
          storyGroups.map((g) => (
            <div key={g.month}>
              <div className="day-divide">{g.month}</div>
              <div className="pad-x"><div className="card list-card-ruled">
                {g.items.map((it) => (
                  <div className="row" key={it.kind + it.name + it.d}>
                    <div className="row-glyph rep-good-glyph"><CheckCircleGlyph /></div>
                    <div className="row-grow">
                      <div className="conn-name truncate">{it.name}</div>
                      <div className="r-k"><span className="r-goal r-cat">{it.kind === "goal" ? "Achieved" : "Closed"} · {it.d.slice(8, 10).replace(/^0/, "")} {monthName(it.d.slice(0, 7)).slice(0, 3)}</span></div>
                    </div>
                  </div>
                ))}
              </div></div>
            </div>
          ))
        )}
        <div className="screen-foot" />
      </div>
      </div>
    );
  }

  const monthKey = today.slice(0, 7);

  return (
    <div className={pushCls} key="base">
      <div className="screen ruled">
        <PageHeader title="Insights" back="Brain" onBack={onBack} />

        {/* THIS WEEK (C-64): three tiles, where the hours went, five lines,
            and the One Change. Rendered only when the week has something to
            say; a quiet week has no card, not an empty one. */}
        {week && (week.lines.length > 0 || week.stack || week.tiles.done > 0 || week.tiles.moved > 0) && (
          <>
            <div className="sh2 sh2-quiet"><span className="t">This Week</span></div>
            <div className="pad-x"><div className="card pad week-card">
              <div className="tiles">
                <div className="itile itile-good"><b>{week.tiles.done}</b><span>done</span></div>
                <div className="itile itile-purp"><b>{week.tiles.moved}</b><span>goals moved</span></div>
                <div className="itile itile-sky"><b>{week.tiles.flexible}</b><span>flexible</span></div>
              </div>
              {week.stack && (
                <>
                  <div className="eyebrow week-eyebrow">Where the Hours Went</div>
                  <div className="stack">
                    {week.stack.map((s) => <i key={s.id} className={s.id === "open" ? "stack-open" : "cat-bg-" + s.color} style={{ width: `${Math.max(2, s.pct)}%` }} />)}
                  </div>
                  <div className="facts week-legend">
                    {week.stack.map((s) => s.id === "open"
                      ? <span className="fact" key={s.id}>Open {hoursOf(s.minutes)}</span>
                      : <span className="fact cat" key={s.id}><span className={"cd cat-bg-" + s.color} />{s.name} {hoursOf(s.minutes)}</span>)}
                  </div>
                </>
              )}
              {week.lines.map((l) => (
                <div className="eq" key={l.key}>
                  <span className={"eq-k eq-" + l.tone}>{l.key}</span>
                  <span className="facts">
                    {l.facts.map((f) => f.tone === "cat"
                      ? <span className="fact cat" key={f.text}><span className={"cd cat-bg-" + (f.color ?? "graphite")} />{f.text}</span>
                      : <span className={"fact" + (f.tone ? " " + f.tone : "")} key={f.text}>{f.text}</span>)}
                  </span>
                </div>
              ))}
              {week.offer && !offered && rulesSvc && (
                <div className="dec-outcome-acts week-acts">
                  <button type="button" className="btn btn-primary" onClick={() => void moveTwoBlocks()}>Move Two Blocks</button>
                  <button type="button" className="quiet-action" onClick={noThanks}>No Thanks</button>
                </div>
              )}
            </div></div>
          </>
        )}

        {/* THIS MONTH: the living report, one tap away, honestly labeled. */}
        <div className="sh2 sh2-quiet"><span className="t">This Month</span></div>
        <div className="pad-x"><div className="card list-card-ruled">
          <div {...pressable(() => setScreen({ kind: "live" }))} className="row">
            <div className="row-grow">
              <div className="conn-name">{monthName(monthKey)}, So Far</div>
              {/* THE SUB IS NOT A KICKER (Dave 2026-09-03, pic 5: "too much
                  same color text"). Every row on this page wrote its second
                  line as .eyebrow, which CSS shouts in caps at the same
                  grey, the same size and nearly the same tracking as the
                  THIS MONTH / YOUR MONTHS / THE LEDGER heads above them.
                  Six caps-grey runs on one screen, so nothing had a rank.
                  Caps belong to a kicker ABOVE a title; a line UNDER a
                  title is the ruled row's quiet sub, with the number bold
                  in bright ink (the contract's inline number emphasis).
                  Same treatment gym rows got in LAW 15. */}
              <div className="r-k"><span className="r-goal r-cat">{liveDone != null ? <Nums text={capAfterNumber(`${liveDone} done · Still open`)} /> : "Still open"}</span></div>
            </div>
            {CHEV}
          </div>
        </div></div>

        {/* YOUR MONTHS: the shelf. Only ever grows; never re-scored. */}
        <div className="sh2 sh2-quiet"><span className="t">Your Months</span></div>
        <div className="pad-x"><div className="card list-card-ruled">
          {[...seals].reverse().map((s) => {
            const moved = movedIn(s.data.month, goals, projects).length + (s.data.saved > 0 ? 1 : 0);
            return (
              // C-64: the month row wears the purple glyph and one facts line,
              // moved purple and done plain (one coloured fact per line).
              <div {...pressable(() => setScreen({ kind: "month", month: s.data.month }))} className="row" key={s.id}>
                <div className="lib-ico lib-disc strand-disc">{filledIcon("month")}</div>
                <div className="row-grow">
                  <div className="conn-name">{monthName(s.data.month)} {s.data.month.slice(0, 4)}</div>
                  <div className="facts">
                    <span className="fact purp">{capAfterNumber(`${moved} moved`)}</span>
                    <span className="fact">{capAfterNumber(`${s.data.done} done`)}</span>
                  </div>
                </div>
                {CHEV}
              </div>
            );
          })}
          {seals.length === 0 && (
            <div className="row"><div className="row-grow">
              <div className="conn-name">No Month Sealed Yet</div>
              <div className="r-k"><span className="r-goal r-cat">The first seals itself on the 1st</span></div>
            </div></div>
          )}
        </div></div>

        {/* THE LONG STORY: the ledger that only grows. */}
        <div className="sh2 sh2-quiet"><span className="t">The Ledger</span></div>
        <div className="pad-x"><div className="card list-card-ruled">
          <div {...pressable(() => setScreen({ kind: "story" }))} className="row">
            <div className="row-glyph rep-good-glyph"><CheckCircleGlyph /></div>
            <div className="row-grow">
              <div className="conn-name">The Long Story</div>
              <div className="r-k"><span className="r-goal r-cat">{story.length > 0 ? <Nums text={capAfterNumber(`${story.length} ${story.length === 1 ? "crossing" : "crossings"} and counting`)} /> : "Everything you achieve, dated, forever"}</span></div>
            </div>
            {CHEV}
          </div>
        </div></div>

        <div className="screen-foot" />
      </div>
    </div>
  );
}
