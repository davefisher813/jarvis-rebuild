import { useEffect } from "react";
import { LAYER_SELECTOR } from "./useSheetEscape";

// A LAYER THAT COVERS THE SCREEN HAS TO HOLD THE FOCUS TOO (2026-09-21).
//
// Escape got fixed first and it was only half the keyboard story. Measured on
// the built app, driving it rather than reading it:
//
//   New Event sheet   focus stayed on the trigger; 10 of 14 tabs landed
//                     OUTSIDE the sheet, in the Day/Week/Month control
//                     behind it; Escape left focus nowhere at all.
//   What Now          the same, 13 of 14, straight into the tab bar.
//
// So a keyboard or switch-control user opens a sheet and tabs through the
// page underneath it, pressing things they cannot see. That is worse than
// the sheet being unreachable; it is the sheet being a lie.
//
// ONE hook, mounted once beside useSheetEscape, for the same reason that one
// is one listener: thirty-four sheets cannot each remember to do this, and
// the thirty-fifth would forget.
//
// Three jobs, in the order a person meets them:
//   1. ON OPEN, put focus in the layer, and remember what had it so it can go
//      back. The first focusable, not the layer itself, so the first Tab
//      moves forward rather than jumping to the start.
//   2. WHILE OPEN, keep Tab inside. Wrapping at both ends, so Shift+Tab off
//      the first control lands on the last rather than on the page behind.
//   3. ON CLOSE, give focus back to whatever opened it. A control that has
//      left the DOM gets nothing rather than a guess.
//
// An input the sheet itself autofocuses wins: if focus is already inside the
// layer when this notices it, it is left alone.

const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

function visibleFocusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => {
    if (e.hasAttribute("disabled") || e.getAttribute("aria-hidden") === "true") return false;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(e);
    return cs.visibility !== "hidden" && cs.display !== "none";
  });
}

/** The topmost open layer, by the same roster Escape uses. */
function topLayer(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(LAYER_SELECTOR);
  return all[all.length - 1] ?? null;
}

export function useLayerFocus(): void {
  useEffect(() => {
    if (typeof window === "undefined" || typeof MutationObserver === "undefined") return;

    let current: HTMLElement | null = null;
    let returnTo: HTMLElement | null = null;

    const enter = (layer: HTMLElement) => {
      current = layer;
      const active = document.activeElement as HTMLElement | null;
      // Only remember something that can be focused again later.
      returnTo = active && active !== document.body ? active : null;
      if (active && layer.contains(active)) return; // the sheet autofocused; leave it
      const first = visibleFocusables(layer)[0];
      first?.focus();
    };

    const leave = () => {
      current = null;
      const back = returnTo;
      returnTo = null;
      // A trigger that unmounted with its screen gets nothing; focusing a
      // detached node silently sends focus to the body anyway.
      if (back && back.isConnected) back.focus();
    };

    const sync = () => {
      const top = topLayer();
      if (top === current) return;
      if (top) enter(top);
      else leave();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !current || !current.isConnected) return;
      const items = visibleFocusables(current);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      // Focus already escaped (a click behind, or the layer opened without
      // this seeing it): pull it back rather than letting Tab walk away.
      if (!active || !current.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    };

    const mo = new MutationObserver(sync);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("keydown", onKey, true);
    sync();
    return () => {
      mo.disconnect();
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
}
