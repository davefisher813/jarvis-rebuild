// THE SCHEDULE ROW'S SWIPE RAIL, one number, named once.
//
// .sched-act is a fixed 88px in components.css and .sched-strip clips, so the
// reveal width a row hands useSwipe has to be a multiple of it or the rail
// lies: whatever does not fit inside the reveal is painted and unreachable.
// It did lie. Both schedule rows carried hard-coded reveal widths (232, and
// 268 for a repeating event) that had stopped matching their button count, so
// -15m sat entirely outside the reveal and +15m was cut in half. The swipe
// audit of 2026-09-20 found it; Dave's screenshot the same day is a picture
// of it.
//
// Counting the rendered actions and multiplying is the whole fix, and this
// constant is the half of it that has to agree with the stylesheet.
// laws.test.ts holds the two together.
export const SCHED_ACT_W = 88;

// Three is the ceiling: 3 x 88 is 264 of a 358px row, the same rail width
// Mail already ships, and it leaves enough of the row on screen to see what
// is being acted on. Four hides the event behind its own actions.
export const SCHED_ACT_MAX = 3;
