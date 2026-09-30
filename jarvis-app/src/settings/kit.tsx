import { useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import HeadMenu, { type MenuOption } from "../shared/HeadMenu";
import { haptics } from "../shared/haptics";

// THE SETTINGS KIT (the Settings sub-pages onto the rulings, 2026-09-02).
// The hub is already three cards; every page under it wears the same
// screen: the quiet caps head, the grouped card, rows with the value at
// the right (a word that opens the dropdown, a switch, a chevron). No
// glyph tiles below the hub, iOS's own way: the hub says where you are,
// the page says what you can change.

/** The quiet caps head over a group. */
export function Head({ label, count }: { label: string; count?: number }) {
  return <div className="sh2 sh2-quiet"><span className="t">{label}</span>{count !== undefined && <span className="n">{count}</span>}</div>;
}

/** The grouped card. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className="pad-x"><div className={"card list-card-ruled set-card " + className}>{children}</div></div>;
}

/** A row: the words at the left, whatever sits at the right. */
export function Row({ label, meta, metaId, value, onClick, forwardTo, chev = false, children, className = "", disabled = false, plain = false }: {
  label: ReactNode; meta?: ReactNode; value?: ReactNode; onClick?: () => void;
  /** An id for the meta line, so a control inside the row can point at it
      (aria-describedby) instead of the row repeating it as its own name. */
  metaId?: string;
  /** THE ROW HOLDS ITS OWN CONTROL (audit 2026-09-29: "Overdue and due tasks
      ... Overdue and due tasks"). A row with a tap and no role=button is
      still tappable by pointer, but a row WITH role=button takes its name
      from everything inside it, and a switch inside carries its own name, so
      a screen reader (or an accessibility snapshot) read the label twice,
      once for the row and once for the switch. When the control inside is
      the real target, the row is plain: pointer-only, no role, no tab stop,
      and the control is the one thing announced. */
  plain?: boolean;
  /** THE ROW IS THE CONTROL'S HIT AREA (audit 2026-09-26). A CSS selector
      for the control this row holds; the row then passes its own taps to
      it, as FormSheet's Row has since SHARED-F-11, so the label and the
      empty space between it and the value all open the menu. The 24px
      dropdown value bought its 44 with a ::after, and at 430 and 834 wide
      with type at 1.4 the rows at the foot of AI Control sat under the
      capture bar, which took the hit for the value's expanded edge: a row
      forwarding to it is 48px of target the bar cannot argue with. The
      selector goes into the DOM (data-forwards) so tools/visual-audit.mjs
      measures the row, exactly as the pointer handler resolves it. No role
      and no tabIndex when it forwards: the control has both already. */
  forwardTo?: string;
  chev?: boolean; children?: ReactNode; className?: string; disabled?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const semantic = !!onClick && !plain;
  const tap = onClick && !disabled ? () => { haptics.selection(); onClick(); } : undefined;
  // A tap that started INSIDE the control is the control's own; forwarding
  // it would fire the handler twice and a menu would open and shut in one
  // tap. A click that reached the row through a portal (the open menu's
  // scrim) is not a tap on the row either.
  const forward = forwardTo && !tap ? (e: MouseEvent<HTMLElement>) => {
    const ctl = box.current?.querySelector<HTMLElement>(forwardTo);
    if (!ctl || ctl.contains(e.target as Node) || !box.current?.contains(e.target as Node)) return;
    ctl.click();
  } : undefined;
  // Enter and Space on the row itself only: a key pressed in a control the
  // row holds belongs to that control.
  const key = tap ? (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    tap();
  } : undefined;
  return (
    <div ref={box} className={"row set-row " + className} role={semantic ? "button" : undefined} tabIndex={semantic ? 0 : undefined} aria-disabled={disabled || undefined}
      data-forwards={forward ? forwardTo : undefined} onClick={tap ?? forward} onKeyDown={key}>
      <div className="row-grow"><div className="conn-name">{label}</div>{meta && <div className="conn-meta" id={metaId}>{meta}</div>}</div>
      {value !== undefined && <span className="row-value">{value}</span>}
      {children}
      {chev && <div className="chev" />}
    </div>
  );
}

/** A row with the switch at the right. The whole row flips it (Dave
 *  2026-09-15, "I want all rows clickable"); a locked switch takes no tap
 *  from the row either. */
export function Switch({ label, meta, on, onToggle, ariaLabel, locked = false, onLocked }: {
  label: string; meta?: ReactNode; on: boolean; onToggle: () => void; ariaLabel?: string; locked?: boolean;
  /** A locked switch answers a tap with nothing unless it is given a reason
   *  to say (audit 2026-09-29: Edit Tabs at its cap and Alerts without OS
   *  permission both sat there dead). The caller says why, usually in a toast. */
  onLocked?: () => void;
}) {
  const metaId = useId();
  return (
    <Row label={label} meta={meta} metaId={metaId} plain onClick={locked ? onLocked : onToggle}>
      <div className={"switch" + (on ? "" : " off") + (locked ? " switch-locked" : "")} role="switch" aria-checked={on} aria-disabled={locked || undefined} aria-label={ariaLabel ?? label} aria-describedby={meta ? metaId : undefined} tabIndex={0}
        onClick={(e) => { e.stopPropagation(); if (!locked) { haptics.selection(); onToggle(); } else onLocked?.(); }}
        onKeyDown={(e) => {
          if (e.key !== " " && e.key !== "Enter") return;
          e.preventDefault();
          if (!locked) onToggle(); else onLocked?.();
        }} />
    </Row>
  );
}

/** A form row's tap: a tap on the row's bare ground focuses the field it
 *  holds; a tap on the field or another control is left to that control
 *  (Dave 2026-09-15, "I want all rows clickable"). */
export function focusField(e: MouseEvent<HTMLElement>) {
  if (e.target instanceof Element && e.target.closest("button, input, select, textarea, [role=button], [role=switch]")) return;
  e.currentTarget.querySelector<HTMLElement>("input, select, textarea")?.focus();
}

/** A row whose value opens the dropdown. The whole row is the door to it
 *  (Dave 2026-09-15, "I want all rows clickable"; the catalog's "a control
 *  a row forwards to is as big as the row"). */
export function Menu({ label, meta, value, options, onPick, ariaLabel, word, off = false }: {
  label: string; meta?: ReactNode; value: string; options: MenuOption[]; onPick: (v: string) => void; ariaLabel?: string; word?: string; off?: boolean;
}) {
  return (
    <Row label={label} meta={meta} forwardTo=".dd">
      <HeadMenu variant="value" ariaLabel={ariaLabel ?? label} value={value} label={word} off={off} options={options} onPick={onPick} />
    </Row>
  );
}

/** The destructive row, in the system red, centred. */
export function DangerRow({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="row row-signout set-row" onClick={onClick} disabled={disabled}>{label}</button>;
}

/** The quiet line under a card. */
export function Foot({ children }: { children: ReactNode }) {
  return <div className="pad-x"><div className="input-hint">{children}</div></div>;
}
