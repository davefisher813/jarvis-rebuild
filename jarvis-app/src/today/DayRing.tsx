// Day progress ring for the Today hero (RDB, Dave 2026-07-29): due-today
// tasks completed over due-today total. Fills as the day progresses, and
// marks the moment it is full with one quiet halo (premium feel, 2026-10-10;
// it used to pop and fire the dots burst). Renders nothing on days with no
// due tasks, so it never nags.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { pressable } from "../shared/pressable";

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
//
// THE RING IS A DOOR (Dave 2026-10-06): given onOpen, a tap opens the day it
// counts (today/DaySheet). The evening's copy inside How Today Went is a
// receipt and takes none.
//
// THE HALO IS FOR THE TICK THAT FILLS IT (premium feel, 2026-10-10). The ring
// celebrates once, at the moment the last due task is ticked: .just-full is
// set only when the ring goes from open to full while it is on screen, and
// leaves once the halo has played. Opening Today on a day already finished
// shows the full ring at rest, the way content never re-animates on a tab
// visit (RDB, Dave 2026-07-29).
export default function DayRing({ done, total, onOpen }: { done: number; total: number; onOpen?: () => void }) {
  const full = total > 0 && done >= total;
  const wasFull = useRef(full);
  const [justFull, setJustFull] = useState(false);
  useEffect(() => {
    const filled = full && !wasFull.current;
    wasFull.current = full;
    if (!filled) return;
    setJustFull(true);
    const t = setTimeout(() => setJustFull(false), 500);
    return () => clearTimeout(t);
  }, [full]);
  if (total <= 0) return null;
  const pct = Math.round(Math.min(1, done / total) * 100);
  return (
    <div
      className={"dring" + (full ? " done" : "") + (justFull ? " just-full" : "")}
      {...(onOpen ? {} : { role: "img" })}
      aria-label={`${done} of ${total} tasks due today are done${onOpen ? ", open the list" : ""}`}
      {...(onOpen ? pressable(onOpen) : {})}
      style={{ "--pct": `${pct}%` } as CSSProperties}
    >
      <div><b>{done}/{total}</b><span>done</span></div>
    </div>
  );
}
