import { useLayoutEffect, useRef } from "react";
import { ChevronLeft } from "../shared/icons";
import { useNavOrigin } from "./navOrigin";

// THE WAY HOME, FOR EVERYTHING ELSE (Dave 2026-09-22: "make sure all modals
// and screens no matter where they are get addressed").
//
// The audit of the modals came back clean on the thing it was looking for:
// all sixty render sites have BOTH a scrim tap and a Cancel, so no sheet in
// the app is a dead end. The gap is what happens after one closes.
//
// A sheet's Cancel means "close this sheet" and leave you on the page behind
// it. That is correct and must not change -- a Cancel that changed tabs would
// be a worse version of the bug we just fixed. But when a cross-tab jump is
// what opened the sheet (a search hit opening a task, a notice opening an
// event), the page behind it is a tab you never chose, and closing the sheet
// leaves you standing in it with no way back.
//
// So: one pill, drawn by the shell, while a jump is live. It covers every
// modal and every screen at once, including the ones written tomorrow, which
// is the only way "no matter where they are" can be true. A page whose own
// back already offers the way home CLAIMS the origin (navOrigin's useLeaveVia)
// and this stands down, so there are never two backs on one screen.
//
// It sits above the tab bar rather than in a nav bar, because there is no nav
// bar it could sit in that every one of these surfaces has.
// ABOVE THE CAPTURE BAR, MEASURED (2026-09-26, the post-code audit). A fixed
// 132px sat the pill 3px into the capture bar at 390x844 and deeper at type
// scale 1.4, so "< Life" covered the bar's left end on any screen with
// nothing to scroll. The dock is static chrome, so the shell reads its top
// and publishes --return-clear (the dock's height from the bottom plus a
// gap); the stylesheet keeps 132px as the fallback for a screen without one.
// CLEARANCE AT THE FOOT OF THE SCROLL BOX (Alfred 2026-10-04, "< Life" over the
// last rows of the gym screens and the Health page). The pill floats inside the
// scroll box's bottom edge, so a page's LAST row, scrolled to the end, sat
// exactly where the pill is. The pill is the way home and must not be the thing
// that hides a row, so while it is drawn the scroll box is padded by exactly the
// room the pill takes (--return-pad, read by .app-scroll): the last row scrolls
// up above it. Measured from the pill and the box rather than assumed, so it is
// right at type scale 1.4 and with or without a capture dock. Zero (and the
// property removed) the moment the pill is not drawn.
const PILL_GAP = 8;

function useDockClear(on: boolean, pill: React.RefObject<HTMLButtonElement | null>) {
  useLayoutEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    const measure = () => {
      const dock = document.querySelector<HTMLElement>(".voice-dock");
      if (!dock) root.style.removeProperty("--return-clear");
      else {
        const top = dock.getBoundingClientRect().top;
        root.style.setProperty("--return-clear", `${Math.max(0, Math.round(window.innerHeight - top) + 8)}px`);
      }
      // The pill has just been moved by --return-clear; read where it landed.
      const scroll = document.querySelector<HTMLElement>(".app-scroll");
      const p = pill.current;
      if (!scroll || !p) { root.style.removeProperty("--return-pad"); return; }
      const need = Math.round(scroll.getBoundingClientRect().bottom - p.getBoundingClientRect().top + PILL_GAP);
      if (need > 0) root.style.setProperty("--return-pad", `${need}px`);
      else root.style.removeProperty("--return-pad");
    };
    measure();
    const dock = document.querySelector<HTMLElement>(".voice-dock");
    const ro = typeof ResizeObserver !== "undefined" && dock ? new ResizeObserver(measure) : null;
    ro?.observe(dock!);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      root.style.removeProperty("--return-clear");
      root.style.removeProperty("--return-pad");
    };
  }, [on, pill]);
}

export default function ReturnPill() {
  const nav = useNavOrigin();
  const pill = useRef<HTMLButtonElement | null>(null);
  useDockClear(!!nav.origin && !nav.claimed, pill);
  if (!nav.origin || nav.claimed) return null;
  return (
    <button ref={pill} type="button" className="return-pill" onClick={() => nav.back()}>
      <ChevronLeft className="ic" />
      {nav.origin.label}
    </button>
  );
}
