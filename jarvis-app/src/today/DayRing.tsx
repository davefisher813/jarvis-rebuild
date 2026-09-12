// Day progress ring for the Today hero (RDB, Dave 2026-07-29): due-today
// tasks completed over due-today total. Fills as the day progresses, pops
// once full. Renders nothing on days with no due tasks, so it never nags.
// Catalog V3.1: reaching 100% fires the completion burst (the app's one
// celebration primitive) on top of the ring pop.
import type { CSSProperties } from "react";
import { Burst } from "../shared/Burst";

// TWO NUMBERS THAT MEAN TWO THINGS (Dave 2026-08-29: the ring said 7/12
// twenty pixels under a line saying "16 Done today", and they never match).
// They never should: the ring counts what you COMMITTED to today, the
// evening line counts everything you got done, due or not, plus the events
// you sat through. Both are worth saying. Neither was labelled, so they read
// as one statistic contradicting itself. The ring now names its own scope.
//
// THE ASTRA RING (Dave's picks, 2026-09-12). The 44px SVG arc with its "Due"
// caption becomes the 64px conic ring the approved harness draws: done over
// total inside, the word under the number, the arc in the completion green.
// The arc is a CSS conic gradient driven by --pct, the one inline style the
// laws allow because the arc is geometry. Same numbers, same scope, same
// burst; only the drawing changed.
export default function DayRing({ done, total }: { done: number; total: number }) {
  if (total <= 0) return null;
  const full = done >= total;
  const pct = Math.round(Math.min(1, done / total) * 100);
  return (
    <div
      className={"dring" + (full ? " done" : "")}
      role="img"
      aria-label={`${done} of ${total} tasks due today are done`}
      style={{ "--pct": `${pct}%` } as CSSProperties}
    >
      <div><b>{done}/{total}</b><span>done</span></div>
      {full && <Burst show />}
    </div>
  );
}
