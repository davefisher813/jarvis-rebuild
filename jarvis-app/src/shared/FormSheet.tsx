import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import SheetBar from "./SheetBar";
import HeadMenu, { type MenuOption } from "./HeadMenu";

// THE FORM SHEET KIT (the sheets onto the sheet bar, 2026-09-02). Every sheet
// that makes or edits a thing wears the exercise sheet's anatomy: the
// handle, Cancel and Save in the bar, groups with a caps label, rows with a
// glyph tile and the value on the right. The parts here are the parts those
// sheets share; each sheet keeps its own fields and its own words.

/** The glyph tile a grouped row leads with (shared/anatomy's .row-ico and
    the nav-tile palette), one hue per row so the eye finds a field by
    colour before it reads the word. */
export function Tile({ tone, children }: { tone: string; children: ReactNode }) {
  return <div className={"row-ico nav-tile-" + tone}>{children}</div>;
}

export function FormSheet({ title, onCancel, onSave, saveDisabled = false, saveLabel, children, className = "" }: {
  title: string;
  onCancel: () => void;
  onSave: () => void;
  saveDisabled?: boolean;
  saveLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className={"card xs form-sheet " + className} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <SheetBar title={title} onCancel={onCancel} onSave={onSave} saveDisabled={saveDisabled} saveLabel={saveLabel} />
        <div className="sheet-form">
          {children}
          <div className="xs-foot" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A caps label and the card under it. */
export function Group({ label, children, className = "" }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <>
      {label && <div className="grp xs-grp"><div className="eyebrow">{label}</div></div>}
      <div className={"pad-x " + className}><div className="card xs-group">{children}</div></div>
    </>
  );
}

/** A row: the tile, the words, whatever sits at the right. */
export function Row({ tone, glyph, label, meta, children, onClick, chev = false, className = "" }: {
  tone?: string; glyph?: ReactNode; label?: ReactNode; meta?: ReactNode; children?: ReactNode;
  onClick?: () => void; chev?: boolean; className?: string;
}) {
  return (
    <div className={"row xs-row " + className} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick}>
      {tone && glyph && <Tile tone={tone}>{glyph}</Tile>}
      {label !== undefined && (meta
        ? <div className="row-grow"><div className="conn-name">{label}</div><div className="conn-meta">{meta}</div></div>
        : <div className="conn-name">{label}</div>)}
      {children}
      {chev && <div className="chev"></div>}
    </div>
  );
}

/** The row that IS an input: a typed value, at the right when it has a
    label beside it, filling the row when it is the row's only thing. */
export function FieldRow({ tone, glyph, label, value, onChange, placeholder, type = "text", inputMode, ariaLabel, error = false, right = true, onEnter }: {
  tone?: string; glyph?: ReactNode; label?: string; value: string; onChange: (v: string) => void; placeholder?: string;
  type?: "text" | "date" | "time" | "url" | "email" | "tel"; inputMode?: "text" | "numeric" | "decimal"; ariaLabel: string; error?: boolean; right?: boolean;
  /** Enter in the field saves, for the sheets that are one name long. */
  onEnter?: () => void;
}) {
  return (
    <div className="row xs-row">
      {tone && glyph && <Tile tone={tone}>{glyph}</Tile>}
      {label && <div className="conn-name">{label}</div>}
      <input
        className={"xs-input" + (label && right ? " xs-field" : "") + (error ? " input-error" : "")}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onEnter ? (e) => { if (e.key === "Enter") onEnter(); } : undefined}
      />
    </div>
  );
}

/** The row that is a paragraph: a few lines of the user's own words. */
export function TextRow({ value, onChange, placeholder, ariaLabel, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel: string; rows?: number;
}) {
  return (
    <div className="row xs-row xs-textrow">
      <textarea className="xs-input xs-textarea" rows={rows} placeholder={placeholder} aria-label={ariaLabel} value={value}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** A strip of chips as a row of the group: the pick that wants every
    option in view at once (a day of the week, a nudge, a colour). */
export function Strip({ children, className = "", plain = false }: { children: ReactNode; className?: string; plain?: boolean }) {
  return <div className={"row xs-strip " + className}>{plain ? children : <div className="chip-row">{children}</div>}</div>;
}

/** The quiet line under a group. */
export function Note({ children }: { children: ReactNode }) {
  return <div className="xs-note">{children}</div>;
}

/** A row whose value opens the dropdown. */
export function MenuRow({ tone, glyph, label, meta, value, options, onPick, ariaLabel, off = false, word }: {
  tone: string; glyph: ReactNode; label: string; meta?: ReactNode; value: string; options: MenuOption[];
  onPick: (v: string) => void; ariaLabel: string; off?: boolean; word?: string;
}) {
  return (
    <Row tone={tone} glyph={glyph} label={label} meta={meta}>
      <HeadMenu variant="value" ariaLabel={ariaLabel} value={value} label={word} off={off} options={options} onPick={onPick} />
    </Row>
  );
}

/** A row with the switch at the right. */
export function SwitchRow({ tone, glyph, label, meta, on, onToggle, ariaLabel }: {
  tone: string; glyph: ReactNode; label: string; meta?: ReactNode; on: boolean; onToggle: () => void; ariaLabel: string;
}) {
  return (
    <Row tone={tone} glyph={glyph} label={label} meta={meta}>
      <div className={"switch" + (on ? "" : " off")} role="switch" aria-checked={on} aria-label={ariaLabel} tabIndex={0}
        onClick={onToggle} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); onToggle(); } }} />
    </Row>
  );
}

/** The destructive row, in the system red, centred, iOS's own way. */
export function DeleteRow({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="row xs-row xs-del" onClick={onClick}>{label}</button>;
}

/** The line under a group that says what is wrong. */
export function ErrorLine({ text }: { text: string | null | undefined }) {
  return text ? <div className="input-error xs-error">{text}</div> : null;
}
