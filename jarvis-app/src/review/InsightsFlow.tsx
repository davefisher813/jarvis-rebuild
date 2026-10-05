import { useCallback, useEffect, useMemo, useState } from "react";
import { useGoals, useProjects, useOptionalSeal, useOptionalSchedule, useOptionalCategories, useOptionalGym, useOptionalRoutine, useOptionalRules, useOptionalTasks, useOptionalDecisions, useOptionalPeople } from "../data/NotesProvider";
import { buildWeek, type WeekReport } from "./week";
import { hoursLabel } from "./hours";
import { readWindow, type WindowClient } from "../brain/window";
import { supabase } from "../auth/supabaseClient";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { filledIcon } from "../shared/filledIcons";
import type { Goal } from "../life/types";
import type { Project } from "../projects/types";
import { taskDone } from "../brain/derive";
import { todayISO } from "../tasks/grouping";
import { monthName, movedIn } from "./report";
import ReportFlow, { oldestWaitDays } from "./ReportPage";
import { peopleForDerivation } from "../brain/peopleFacts";
import type { MonthSeal } from "./seal";
import { lineCase } from "../shared/casing";
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

export default function InsightsFlow({ onBack, onOpenTask, onOpenEntity, onOpenMoney, onOpenEmail }: {
  onBack: () => void;
  onOpenTask?: (id: string) => void;
  /** The month report's exits (2026-09-26), passed straight through; see
   *  ReportFlow. Each optional. */
  onOpenEntity?: (kind: string, id: string) => void;
  onOpenMoney?: () => void;
  onOpenEmail?: () => void;
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
  // The life lines' sources (2026-09-26): the bills live as tasks, the
  // decisions carry their outcomes, the people list says who went quiet.
  const tasksSvc = useOptionalTasks();
  const decisionsSvc = useOptionalDecisions();
  const peopleSvc = useOptionalPeople();
  const [week, setWeek] = useState<WeekReport | null>(null);
  const [offered, setOffered] = useState(false);
  const loadWeek = useCallback(async (gl: Goal[], pj: Project[]) => {
    try {
      const now = Date.now();
      const [rows, events, workouts, categories, routine, rule, tasks, decisions] = await Promise.all([
        readWindow(supabase as unknown as WindowClient | null, now, 15),
        schedSvc ? schedSvc.listEvents().catch(() => []) : Promise.resolve([]),
        gymSvc ? gymSvc.listWorkouts().catch(() => []) : Promise.resolve([]),
        catsSvc ? catsSvc.list().catch(() => []) : Promise.resolve([]),
        routineSvc ? routineSvc.get().catch(() => null) : Promise.resolve(null),
        rulesSvc ? rulesSvc.resolve("plan.focus", "week").catch(() => null) : Promise.resolve(null),
        tasksSvc ? tasksSvc.listTasks().catch(() => []) : Promise.resolve([]),
        decisionsSvc ? decisionsSvc.listAll().catch(() => []) : Promise.resolve([]),
      ]);
      const people = await peopleForDerivation(peopleSvc, categories.map((c) => ({ id: c.id, name: c.data.name }))).catch(() => []);
      // Built for buildWeek below and for nothing else: this used to also
      // land in a `cats` state nothing on this screen ever read (audit
      // 2026-09-16), so every load re-rendered the flow to store a list it
      // then ignored.
      const cs = categories.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color }));
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
        tasks, decisions: decisions.map((d) => d.data), people, waitDays: oldestWaitDays(now),
      }));
    } catch { setWeek(null); }
  }, [schedSvc, gymSvc, catsSvc, routineSvc, rulesSvc, tasksSvc, decisionsSvc, peopleSvc, today]);
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
    // The This Month card's one number, off the SAME window read and the same fold the So Far page counts from (Dave
    // 2026-10-05, the review: the row said 1365 Done, one tap later the page said 462). It used to count the device's
    // whole completion log, workouts included; the page counts task completions in the window, so this does too.
    void (async () => {
      try {
        const rows = await readWindow(supabase as unknown as WindowClient | null, Date.now(), 35);
        setLiveDone(taskDone(rows.filter((r) => r.day.startsWith(today.slice(0, 7)))).length);
      } catch { setLiveDone(null); }
    })();
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
    showToast({ message: lineCase(`Two blocks aimed at ${area} next week`), actionLabel: "Undo", onAction: () => void (async () => {
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

  const storyGoals = story.filter((x) => x.kind === "goal").length;
  const storyProjects = story.length - storyGoals;
  const exits = { onOpenEntity, onOpenMoney, onOpenEmail };
  if (screen?.kind === "live") return <div className={pushCls} key="d-live"><ReportFlow live onBack={() => { setScreen(null); void reload(); }} onOpenTask={onOpenTask} {...exits} /></div>;
  if (screen?.kind === "month") return <div className={pushCls} key={"d-" + screen.month}><ReportFlow month={screen.month} onBack={() => { setScreen(null); void reload(); }} onOpenTask={onOpenTask} {...exits} /></div>;
  if (screen?.kind === "story") {
    return (
      <div className={pushCls} key="d-story">
      <div className="screen ruled">
        <PageHeader title="The Long Story" back="Insights" onBack={() => setScreen(null)} />
        {story.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><SunriseGlyph /></div>
            <div className="empty-title">The First Crossing Starts It</div>
            <div className="empty-sub">Everything You Achieve Lands Here, Dated, Forever</div>
          </div>
        ) : (
          storyGroups.map((g) => (
            <div key={g.month}>
              {/* The standard section head, inside the page's gutter (Dave 2026-10-05, the review: the caps month hung
                  outside the 20px margin and sat 4px off its card). */}
              <div className="sh2 sh2-quiet"><span className="t">{g.month}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {g.items.map((it) => (
                  <div className="row" key={it.kind + it.name + it.d}>
                    <div className="row-glyph rep-good-glyph"><CheckCircleGlyph /></div>
                    <div className="row-grow">
                      <div className="conn-name truncate">{it.name}</div>
                      <div className="facts">
                        <span className="fact">{it.kind === "goal" ? "Achieved" : "Closed"}</span>
                        {/* Month first, like every date in the app ("Sep 20", never "20 SEP"). */}
                        <span className="fact date">{monthName(it.d.slice(0, 7)).slice(0, 3)} {it.d.slice(8, 10).replace(/^0/, "")}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div></div>
            </div>
          ))
        )}
        {story.length > 0 && <div className="pad-x"><div className="input-hint">Everything You Achieve Lands Here, Dated, Forever</div></div>}
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
                <div className="itile itile-plain"><b>{week.tiles.moved}</b><span>goals moved</span></div>
                {/* A duration is the key's sky, and it is one line: the larger unit leads at the tile's number size and the
                    smaller rides beside it, so "37h 45m" is never two lines in a tile its neighbours fill with one. */}
                <div className="itile itile-sky"><b>{week.tiles.flexible.split(" ").map((p, i) => (i === 0 ? p : <small key={i}>{p}</small>))}</b><span>flexible</span></div>
              </div>
              {week.stack && (
                <>
                  <div className="eyebrow week-eyebrow">Where the Hours Went</div>
                  <div className="stack">
                    {week.stack.map((s) => <i key={s.id} className={s.id === "open" ? "stack-open" : "cat-bg-" + s.color} style={{ width: `${Math.max(2, s.pct)}%` }} />)}
                  </div>
                  <div className="facts week-legend">
                    {week.stack.map((s) => s.id === "open"
                      ? <span className="fact" key={s.id}>{`Open ${hoursOf(s.minutes)}`}</span>
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
                      : <span className={"fact" + (f.tone ? " " + f.tone : "")} key={f.text}>
                          {f.parts ? f.parts.map((p, i) => typeof p === "string" ? p : <b key={i}>{p.b}</b>) : f.text}
                        </span>)}
                  </span>
                </div>
              ))}
              {/* THE OFFER PAIR IS THE REPORT'S PAIR (2026-09-26, pass-off
                  item 14): the same One Change on two surfaces wore two
                  shapes, a 50px primary beside a 32px quiet dismiss here and
                  two equal 50px buttons on the month report. One offer, one
                  hierarchy: primary red and the base capsule with its red
                  label, flex 1, wrapping at type scale 1.4. The "quiet
                  dismiss" intent (components.css) keeps Today's Check In and
                  the Tasks nudge; it is retired for this card only. */}
              {week.offer && !offered && rulesSvc && week.next && (
                <>
                  {/* WHAT THE BUTTON DOES, IN WORDS (Dave 2026-10-05, the review: "Move Two Blocks without saying which
                      blocks or why"). One sentence under the lines it comes from. */}
                  <div className="input-hint week-why">{lineCase(`Two focus blocks go to ${week.next.name} next week, where this week had the fewest hours`)}</div>
                  <div className="rep-one-acts week-acts promo-actions">
                    <button type="button" className="btn btn-primary" onClick={() => void moveTwoBlocks()}>Move Two Blocks</button>
                    <button type="button" className="btn btn-tertiary" onClick={noThanks}>No Thanks</button>
                  </div>
                </>
              )}
            </div></div>
          </>
        )}

        {/* THIS MONTH: the living report, one tap away, honestly labeled. */}
        <div className="sh2 sh2-quiet"><span className="t">This Month</span></div>
        <div className="pad-x"><div className="card list-card-ruled">
          <div {...pressable(() => setScreen({ kind: "live" }))} className="row">
            {/* ONE ROW RECIPE ON THIS PAGE (the round 2 review: This Month had no glyph and its text at 41, while Your Months and The
                Ledger had one and started at 83). Every row leads with its bare glyph in its subject's tone: the month's purple (the
                Brain's own, as Insights wears it on the Brain), the ledger's done green. */}
            <div className="row-glyph cat-fg-purple">{filledIcon("month")}</div>
            <div className="row-grow">
              <div className="conn-name">{`${monthName(monthKey)}, So Far`}</div>
              {/* THE SUB IS NOT A KICKER (Dave 2026-09-03, pic 5: "too much
                  same color text"). Every row on this page wrote its second
                  line as .eyebrow, which CSS shouts in caps at the same
                  grey, the same size and nearly the same tracking as the
                  THIS MONTH / YOUR MONTHS / THE LEDGER heads above them.
                  Six caps-grey runs on one screen, so nothing had a rank.
                  Caps belong to a kicker ABOVE a title; a line UNDER a
                  title is the ruled row's quiet sub, with the number bold
                  in bright ink (the contract's inline number emphasis).
                  Same treatment gym rows got in LAW 15.
                  §AM (2026-09-26): the same facts line the sealed months
                  below wear. Done is the green fact, "Still open" the one grey,
                  and the dot between them is drawn by CSS, not typed. */}
              <div className="facts">
                {liveDone != null && <span className="fact good">{lineCase(`${liveDone.toLocaleString("en-US")} Done`)}</span>}
                <span className="fact">Still Open</span>
              </div>
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
              // C-64: the month row wears the purple glyph and one facts line.
              // §AM (2026-09-26): purple is not in the Colour Key, so done is
              // the one coloured fact (green, done) and moved is the one
              // grey, its count a white number with no state.
              <div {...pressable(() => setScreen({ kind: "month", month: s.data.month }))} className="row" key={s.id}>
                <div className="row-glyph cat-fg-purple">{filledIcon("month")}</div>
                <div className="row-grow">
                  <div className="conn-name">{`${monthName(s.data.month)} ${s.data.month.slice(0, 4)}`}</div>
                  <div className="facts">
                    {/* Goals Moved, the same words and the same count the week's tile says (a goal achieved or a project closed). */}
                    <span className="fact"><b>{moved}</b> {moved === 1 ? "Goal" : "Goals"} Moved</span>
                    <span className="fact good">{lineCase(`${s.data.done.toLocaleString("en-US")} Done`)}</span>
                  </div>
                </div>
                {CHEV}
              </div>
            );
          })}
          {seals.length === 0 && (
            <div className="row"><div className="row-grow">
              <div className="conn-name">No Month Sealed Yet</div>
              <div className="r-k"><span className="r-goal r-cat">The First Seals Itself on the 1st</span></div>
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
              {/* A row with nothing to say shows nothing (§AK): before the
                  first crossing the ledger has no line, and the page it
                  opens says what will land there. */}
              {story.length > 0 && (
                // What it holds, said once: "2 Goals Achieved, 1 Project Closed" (one grey; Dave 2026-10-05, the review: "2
                // Crossings and Counting" did not say what the row holds).
                // Two facts, the dot between them the stylesheet's (the round 2 review: a comma typed inside one run).
                <div className="facts">
                  {storyGoals > 0 && <span className="fact">{lineCase(`${storyGoals} ${storyGoals === 1 ? "goal" : "goals"} achieved`)}</span>}
                  {storyProjects > 0 && <span className="fact">{lineCase(`${storyProjects} ${storyProjects === 1 ? "project" : "projects"} closed`)}</span>}
                </div>
              )}
            </div>
            {CHEV}
          </div>
        </div></div>

        <div className="screen-foot" />
      </div>
    </div>
  );
}
