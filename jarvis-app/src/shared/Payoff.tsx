import { useEffect } from "react";
import { Burst } from "./Burst";
import { haptics } from "./haptics";

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
        <div className="payoff-burst"><Burst show /></div>
        <div className="eyebrow">{kind === "goal" ? "Goal achieved" : "Project done"}</div>
        <div className="payoff-title">{title}</div>
        {line && <div className="payoff-line">{line}</div>}
      </div>
      <div className="pad-x conn-action">
        <button className="btn btn-primary btn-block btn-lg" onClick={onDone}>Nice</button>
      </div>
    </div>
  );
}

// What it took, counted from real records only. Returns "" when there is
// nothing true to say, and then the line does not render at all.
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
    return what + " over " + when + ".";
  }
  return what + ".";
}
