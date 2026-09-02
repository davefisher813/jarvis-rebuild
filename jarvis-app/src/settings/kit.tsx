import type { ReactNode } from "react";
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
export function Row({ label, meta, value, onClick, chev = false, children, className = "", disabled = false }: {
  label: ReactNode; meta?: ReactNode; value?: ReactNode; onClick?: () => void; chev?: boolean; children?: ReactNode; className?: string; disabled?: boolean;
}) {
  const tap = onClick && !disabled ? () => { haptics.selection(); onClick(); } : undefined;
  return (
    <div className={"row set-row " + className} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} aria-disabled={disabled || undefined} onClick={tap}>
      <div className="row-grow"><div className="conn-name">{label}</div>{meta && <div className="conn-meta">{meta}</div>}</div>
      {value !== undefined && <span className="row-value">{value}</span>}
      {children}
      {chev && <div className="chev" />}
    </div>
  );
}

/** A row with the switch at the right. */
export function Switch({ label, meta, on, onToggle, ariaLabel, locked = false }: {
  label: string; meta?: ReactNode; on: boolean; onToggle: () => void; ariaLabel?: string; locked?: boolean;
}) {
  return (
    <Row label={label} meta={meta}>
      <div className={"switch" + (on ? "" : " off") + (locked ? " switch-locked" : "")} role="switch" aria-checked={on} aria-label={ariaLabel ?? label} tabIndex={0}
        onClick={() => { if (!locked) { haptics.selection(); onToggle(); } }}
        onKeyDown={(e) => { if (!locked && (e.key === " " || e.key === "Enter")) { e.preventDefault(); onToggle(); } }} />
    </Row>
  );
}

/** A row whose value opens the dropdown. */
export function Menu({ label, meta, value, options, onPick, ariaLabel, word, off = false }: {
  label: string; meta?: ReactNode; value: string; options: MenuOption[]; onPick: (v: string) => void; ariaLabel?: string; word?: string; off?: boolean;
}) {
  return (
    <Row label={label} meta={meta}>
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
  return <div className="pad-x set-foot">{children}</div>;
}
