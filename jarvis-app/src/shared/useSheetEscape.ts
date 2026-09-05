import { useEffect } from "react";

// ESCAPE CLOSES THE TOP SHEET (BROWSER-F-15, 2026-09-05).
//
// On an iPad, a Mac Catalyst window or the web build, a hardware keyboard is
// the normal way in, and Escape did nothing anywhere in the app: Plan My Day,
// Add a Metric, Edit Task, Reminder, New Event and Add Block all sat there
// until a mouse found Cancel. Verified by running it on 2026-09-05: Escape
// left every sheet open.
//
// ONE listener, not thirty-four. The 34 sheet call sites share one thing, the
// `.sheet-scrim` element, so the app can find the topmost open sheet and
// dismiss it without every sheet growing its own effect (and without the next
// sheet somebody writes forgetting to).
//
// Escape presses CANCEL, not the scrim, wherever the sheet has a Cancel. That
// matters after SHARED-F-13: a sheet with unsaved typing ignores a scrim tap
// on purpose (a thumb resting above the card must not throw work away), and a
// deliberate Escape is not a thumb. Where there is no Cancel, the scrim's own
// dismiss is the sheet's only exit and Escape takes it.
//
// A dropdown inside a sheet owns Escape first: HeadMenu has closed its own
// menu on Escape since it was written, and closing the menu AND the sheet
// under it with one key would be a surprise. Its portal is `.hmenu-scrim`,
// so its presence is the check.
const CANCEL = ".sheet-bar-cancel, .action-sheet .cancel, [data-sheet-cancel]";

export function useSheetEscape(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".hmenu-scrim")) return; // the menu takes it
      const scrims = document.querySelectorAll<HTMLElement>(".sheet-scrim");
      const top = scrims[scrims.length - 1];
      if (!top) return;
      e.preventDefault();
      (top.querySelector<HTMLElement>(CANCEL) ?? top).click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
