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

// A SHEET IS NOT THE ONLY THING THAT COVERS THE SCREEN (states sweep,
// 2026-09-21). This hook keyed on .sheet-scrim alone, which is 66 of the
// app's layers and not all of them. Six were not scrims and so ignored
// Escape entirely: Search, Fresh Start, What Now (.search-overlay), the
// schedule's guard (.ag-scrim), and the two menu scrims. What Now is the one
// that proved it -- the sheet-aware audit crawler sat behind it unable to
// get out, which is exactly what a keyboard or switch-control user does.
//
// Every layer is listed here, and the TOPMOST in document order wins, so a
// sheet opened over the search overlay closes first and the overlay stays.
// Each kind says how it is dismissed:
//   menu scrims   click the scrim; that is their own dismiss
//   sheet scrims  press Cancel where there is one, else the scrim
//   full layers   press the control marked data-layer-close
// Exported because useLayerFocus has to agree with this exactly: a layer
// Escape closes but Tab can walk out of is the worse half of the same bug.
export const LAYER_SELECTOR = ".hmenu-scrim, .block-menu-scrim, .time-pop-scrim, .sheet-scrim, .ag-scrim, .search-overlay";
const LAYERS = LAYER_SELECTOR;
const LAYER_CLOSE = "[data-layer-close]";

export function useSheetEscape(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const all = document.querySelectorAll<HTMLElement>(LAYERS);
      const top = all[all.length - 1];
      if (!top) return;
      // HeadMenu has closed itself on Escape since it was written, and
      // closing the menu AND whatever is under it with one key would be a
      // surprise. Its presence on top still means "handled".
      if (top.classList.contains("hmenu-scrim")) return;
      e.preventDefault();
      if (top.classList.contains("sheet-scrim")) {
        (top.querySelector<HTMLElement>(CANCEL) ?? top).click();
        return;
      }
      // A full-screen layer has no scrim to tap, so it names its own way out.
      const close = top.querySelector<HTMLElement>(LAYER_CLOSE);
      (close ?? top).click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
