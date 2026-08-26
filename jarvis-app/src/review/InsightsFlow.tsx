import { useCallback, useEffect, useMemo, useState } from "react";
import { useGoals, useProjects, useOptionalSeal } from "../data/NotesProvider";
import type { Goal } from "../life/types";
import type { Project } from "../projects/types";
import { readSamples } from "../shared/timeSense";
import { todayISO } from "../tasks/grouping";
import { monthName, movedIn } from "./report";
import ReportFlow from "./ReportPage";
import type { MonthSeal } from "./seal";
import { capAfterNumber } from "../shared/casing";
import { CheckCircleGlyph, SunriseGlyph } from "../shared/glyphs";
import { usePushDepth } from "../shared/pushNav";

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
    // The This Month card's one number: seen completions this month. Cheap,
    // local, and honest about being the device's view (Still Open says so).
    const monthStart = new Date(today.slice(0, 7) + "-01T00:00:00").getTime();
    setLiveDone(readSamples().filter((s) => s.t >= monthStart).length);
  }, [goalsSvc, projectsSvc, sealSvc, today]);
  useEffect(() => { void reload(); }, [reload]);

  const pushCls = usePushDepth(screen ? 1 : 0);

  const story = useMemo(() => {
    const items: { d: string; name: string; kind: "goal" | "project" }[] = [];
    for (const g of goals) if (g.data.achievedOn) items.push({ d: g.data.achievedOn, name: g.data.title, kind: "goal" });
    for (const p of projects) if (p.data.closedOn) items.push({ d: p.data.closedOn, name: p.data.title, kind: "project" });
    return items.sort((a, b) => b.d.localeCompare(a.d));
  }, [goals, projects]);

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

  const monthKey = today.slice(0, 7);

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
    </div>
  );
}
