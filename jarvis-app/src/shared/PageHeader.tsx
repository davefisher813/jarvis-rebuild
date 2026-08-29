import { useEffect, useRef, useState, type ReactNode } from "react";

// THE LIBRARY CHASSIS (Design 2, approved 2026-08-18). One header system for
// every page: a sticky bar that is transparent at rest and condenses into
// glass with the centered page title, a hairline, and the red energy line the
// moment the large title scrolls away. Nothing ever collides with the clock
// again. Page actions live IN the bar; the large title and search live in the
// scroll below it.

// THE BAR IS TALLER THAN THE BAR (Dave 2026-08-29, from a screenshot of
// "Good Evening, Dave" with the iOS clock and battery drawn straight through
// it). .pagebar is `padding-top: var(--safe-top)` plus a 44px row, so on a
// notched iPhone it stands ~103px tall, not 45. The condense trigger was
// hardcoded to 45, which meant a ~59px band where the large title had
// scrolled under the status bar but the bar had not turned its glass on yet:
// white text on the wallpaper, straight through the clock. The app runs
// black-translucent standalone, so there is no system chrome to save it.
//
// Reading the token rather than measuring the bar keeps this a pure
// scroll-math fix with no ref plumbing; anywhere env() is unavailable
// (jsdom, older engines) it resolves to 0 and the old number stands.
const BAR_H = 45; // 44px row + hairline

function safeTopPx(): number {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return 0;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--safe-top");
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// Shared condensing logic: [probeRef, condensed, scrolled].
//
// TWO SIGNALS, NOT ONE. The bar used to earn its glass at the same moment it
// earned its title -- when the large title finished scrolling away. But the
// glass is not decoration for the title; it is what stops page content from
// being legible through the status bar. Tying it to the title left every page
// with a band, as tall as the hero, where the greeting had slid up under the
// clock and the bar was still fully transparent. That band is what Dave
// photographed.
//
//   scrolled  -> the page has moved at all, so something is under the bar:
//                glass, immediately. (What iOS actually does.)
//   condensed -> the large title is gone: show the centered title.
//
// Existing callers destructure two and keep working.
export function useCondensed(): [(el: HTMLDivElement | null) => void, boolean, boolean] {
  const [on, setOn] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const ioRef = useRef<IntersectionObserver | null>(null);
  const attach = (el: HTMLDivElement | null) => {
    ioRef.current?.disconnect();
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => { const e = entries[0]; if (e) setOn(!e.isIntersecting); },
      // The probe sits just under the large title; the title crosses beneath
      // the bar's REAL bottom edge, notch included.
      { rootMargin: `-${BAR_H + safeTopPx()}px 0px 0px 0px` },
    );
    io.observe(el);
    ioRef.current = io;
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    const read = () => setScrolled(window.scrollY > 0);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);
  useEffect(() => () => ioRef.current?.disconnect(), []);
  return [attach, on, scrolled];
}

export default function PageHeader({ title, back, onBack, actions, hero, children }: {
  title: string;
  back?: string;
  onBack?: () => void;
  // Bar-resident controls (circular accent buttons, filters). Never floating.
  actions?: ReactNode;
  // Replaces the default large title block (Today's greeting hero).
  hero?: ReactNode;
  // Rendered under the large title: search, chips.
  children?: ReactNode;
}) {
  const [probe, on, scrolled] = useCondensed();
  return (
    <>
      <div className={"pagebar" + (on ? " on" : "") + (scrolled ? " solid" : "")}>
        <div className="pagebar-row">
          {back && onBack ? <button className="nav-back" onClick={onBack}>{back}</button> : <span />}
          <div className="pagebar-title">{title}</div>
          <div className="pagebar-acts">{actions}</div>
        </div>
      </div>
      <div className="pagehead">
        {hero ?? <div className="pagehead-title">{title}</div>}
        <div ref={probe} />
        {children}
      </div>
    </>
  );
}

// Circular bar action (the pencil, the plus): 32pt, accent glyph on press-3.
export function BarAction({ label, onClick, children }: { label: string; onClick?: () => void; children: ReactNode }) {
  return (
    <button className="barbtn" aria-label={label} onClick={onClick}>{children}</button>
  );
}

// The word version of BarAction (2026-08-24, bulk select). Select, Done and
// Cancel are verbs with no honest glyph: a checklist icon for "Select" is a
// guess the user has to decode, and Done as a tick is the same tick that
// means "complete this task" three rows below. Words, in the bar, the way
// every list on this platform does it.
//
// Its own component rather than a bare <button className="barbtn"> at each
// call site, so the two cannot drift and so the hit area lives in one place.
export function BarText({ label, onClick, strong }: { label: string; onClick?: () => void; strong?: boolean }) {
  return (
    <button className={"bar-text" + (strong ? " strong" : "")} onClick={onClick}>{label}</button>
  );
}
