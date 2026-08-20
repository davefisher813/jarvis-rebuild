// THE CLOCK CHECK (my addition, from Dave's 2026-08-20 screenshot).
//
// He opened the planner at 10:54 PM. Planning "today" at that hour is
// planning a dead day: the window is thirty minutes wide and every task he
// owns is longer than that. The sheet cheerfully asked "What fits today?"
//
// When the remaining day cannot hold the shortest thing he might pick, the
// sheet says so and points at tomorrow, which is the only useful answer.

export const SHORTEST_USEFUL = 15;
// Under an hour left is not a day you plan, it is a day you finish. Past this
// the sheet says nothing: an afternoon is still an afternoon.
export const WARN_UNDER = 60;

export interface ClockVerdict {
  spent: boolean;
  leftMin: number;
  title: string;
  sub: string;
}

export function dayClock(startMin: number, endMin: number, shortest = SHORTEST_USEFUL): ClockVerdict | null {
  const left = Math.max(0, endMin - startMin);
  if (left >= WARN_UNDER) return null; // room for something real: say nothing
  return {
    spent: left < shortest,
    leftMin: left,
    title: left < shortest ? "Today Is Done" : `Only ${left} Minutes Left Today`,
    sub: "Plan tomorrow instead?",
  };
}
