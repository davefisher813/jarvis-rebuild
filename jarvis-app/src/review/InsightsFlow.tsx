import { useCallback, useEffect, useMemo, useState } from "react";
import { useGoals, useProjects, useOptionalSeal } from "../data/NotesProvider";
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

// INSIGHTS IS PURE TIME (the Life Merge, Dave 2026-08-26: "it's stupid
// having them separate"). The life layer this surface carried for one day
// (areas, goals, the quiet card) moved into Your Life, where the work
// already lives; goals now render in exactly one place. What stays here is
// the mirror: this month still open, the sealed shelf, and the ledger that
// only grows. The mirror stays its own room so review never feels like
// being graded at the workbench.

const CHEV = <div className="chev" />;

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
    // The This Month card's one number: seen completions this month. Still a
    // local read (Still Open says so), but now off the same unified log the
    // category page counts from (2026-08-29), not the smaller sample array.
    const monthStart = new Date(today.slice(0, 7) + "-01T00:00:00").getTime();
    setLiveDone(completionSamples().filter((s) => s.t >= monthStart).length);
  }, [goalsSvc, projectsSvc, sealSvc, today]);
  useEffect(() => { void reload(); }, [reload]);

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

        {/* THIS MONTH: the living report, one tap away, honestly labeled. */}
        <div className="sh2 sh2-quiet"><span className="t">This Month</span></div>
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="row" role="button" tabIndex={0} onClick={() => setScreen({ kind: "live" })}>
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
              <div className="row" role="button" tabIndex={0} key={s.id} onClick={() => setScreen({ kind: "month", month: s.data.month })}>
                <div className="row-grow">
                  <div className="conn-name">{monthName(s.data.month)} {s.data.month.slice(0, 4)}</div>
                  <div className="r-k"><span className="r-goal r-cat"><Nums text={capAfterNumber(`${moved} moved · ${s.data.done} done`)} /></span></div>
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
          <div className="row" role="button" tabIndex={0} onClick={() => setScreen({ kind: "story" })}>
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
