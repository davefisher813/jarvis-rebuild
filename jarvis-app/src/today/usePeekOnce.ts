import { createContext, useContext, useEffect } from "react";
import { markPeeked, shouldPeek } from "../shared/swipeTeach";

// THE ONE-TIME PEEK, WIRED TO TODAY (Dave 2026-10-05, locked; ROW-ACTIONS-SPEC section 4). A swipe nobody knows about
// is useless, so on the first launch of the Today list ONE swipeable row slides open a little and closes. Once, ever.
//
// Every swipeable row on Today calls this with its own `peek` from useSwipe; the rows do not know about each other.
// What makes it ONE row is the claim below: the first timer to fire takes it, writes the once-ever flag, and every other
// row finds the flag set. The delay lets the page's first batch of rows mount, so the claim goes to the row nearest the
// top rather than to whichever happened to render first. shouldPeek already says no under Reduced Motion and after any
// real swipe or a dismissed tip.
//
// The context is Today's: TodayPage provides it, so a NoticeCard on Brain or a reminder row on another screen never
// peeks. A row outside Today reads the default and does nothing.
export const TodayPeek = createContext(false);

const PEEK_DELAY_MS = 900;
let claimed = false;

/** Test hook: a fresh page load has not claimed the peek yet. */
export const resetPeekClaim = (): void => { claimed = false; };

export function usePeekOnce(peek: () => void, can: boolean): void {
  const onToday = useContext(TodayPeek);
  useEffect(() => {
    if (!onToday || !can) return;
    const id = setTimeout(() => {
      if (claimed || !shouldPeek()) return;
      claimed = true;
      markPeeked();
      peek();
    }, PEEK_DELAY_MS);
    return () => clearTimeout(id);
    // The row's own `peek` changes identity on every render; the claim is what makes this run once.
     
  }, [onToday, can]);
}
