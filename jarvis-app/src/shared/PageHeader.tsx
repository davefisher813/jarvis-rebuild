import { useEffect, useRef, useState, type ReactNode } from "react";

// THE LIBRARY CHASSIS (Design 2, approved 2026-08-18). One header system for
// every page: a sticky bar that is transparent at rest and condenses into
// glass with the centered page title, a hairline, and the red energy line the
// moment the large title scrolls away. Nothing ever collides with the clock
// again. Page actions live IN the bar; the large title and search live in the
// scroll below it.

// Shared condensing logic: [probeRef, condensed]. Place the probe where the
// large title starts; when it leaves the viewport top, the bar turns on.
export function useCondensed(): [(el: HTMLDivElement | null) => void, boolean] {
  const [on, setOn] = useState(false);
  const ioRef = useRef<IntersectionObserver | null>(null);
  const attach = (el: HTMLDivElement | null) => {
    ioRef.current?.disconnect();
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => { const e = entries[0]; if (e) setOn(!e.isIntersecting); },
      // The probe sits just under the large title; the bar turns on as the
      // title crosses beneath it (45 = bar height + hairline).
      { rootMargin: "-45px 0px 0px 0px" },
    );
    io.observe(el);
    ioRef.current = io;
  };
  useEffect(() => () => ioRef.current?.disconnect(), []);
  return [attach, on];
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
  const [probe, on] = useCondensed();
  return (
    <>
      <div className={"pagebar" + (on ? " on" : "")}>
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
