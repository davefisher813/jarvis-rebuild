import { useEffect } from "react";
import { Burst } from "./Burst";
import { haptics } from "./haptics";
import { Check } from "./icons";
import { lineCase } from "./casing";

// The moment you finish something big.
//
// Tasks have had a burst since the beginning. Projects and goals, the things
// that take weeks, had nothing at all: you edited a field, tapped Save, and
// the row went grey. The largest accomplishments in the app were the quietest.
//
// Rules this obeys:
//   - The line under the title is DERIVED or it does not render. No invented
//     stats, no "you crushed it".
//   - It is a moment, not a screen to manage: one way out, no decisions.
//   - No streaks, no comparisons to other weeks, no next-goal upsell. The
//     thing you finished is the whole subject.
//   - Premium, never childish (Dave 2026-10-09). A green disc whose tick
//     draws itself on, the words rising a few pixels into place behind it,
//     all at rest by 420 ms (components.css, the payoff block); Expressive
//     adds its one accent round the disc. No confetti, and the way out is
//     "Done", not a word of praise. The tap is the success tap it always was.
export default function Payoff({
  kind,
  title,
  line,
  onDone,
}: {
  kind: "project" | "goal";
  title: string;
  line?: string;
  onDone: () => void;
}) {
  useEffect(() => { haptics.success(); }, []);
  return (
    <div className="screen payoff">
      <div className="payoff-body">
        <div className="payoff-mark" aria-hidden="true"><Check className="ic" /><Burst show size="big" /></div>
        <div className="eyebrow">{kind === "goal" ? "Goal Achieved" : "Project Done"}</div>
        <div className="payoff-title">{title}</div>
        {line && <div className="payoff-line">{line}</div>}
      </div>
      <div className="pad-x conn-action">
        <button className="btn btn-primary btn-block btn-lg" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

// What it took, counted from real records only. Returns "" when there is
// nothing true to say, and then the line does not render at all. A line the
// app writes, so Title Case with no full stop ("3 Projects and 22 Tasks
// Over 12 Days"; Dave 2026-09-26).
export function payoffLine(opts: { tasksDone?: number; days?: number; projectsDone?: number }): string {
  const bits: string[] = [];
  if (opts.projectsDone && opts.projectsDone > 0) {
    bits.push(opts.projectsDone === 1 ? "1 project" : opts.projectsDone + " projects");
  }
  if (opts.tasksDone && opts.tasksDone > 0) {
    bits.push(opts.tasksDone === 1 ? "1 task" : opts.tasksDone + " tasks");
  }
  if (bits.length === 0) return "";
  const what = bits.join(" and ");
  if (opts.days && opts.days >= 1) {
    const when = opts.days === 1 ? "1 day" : opts.days + " days";
    return lineCase(what + " over " + when);
  }
  return lineCase(what);
}
