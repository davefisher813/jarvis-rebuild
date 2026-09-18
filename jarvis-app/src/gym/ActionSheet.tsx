import { useState } from "react";
import { createPortal } from "react-dom";

export interface SheetAction {
  label: string;
  onClick: () => void;
}

/**
 * LONG-PRESS = THE WHOLE MENU (catalog §3.12). One long-press gesture on a
 * day or exercise row opens this: Duplicate / Move / Copy To / Delete,
 * whichever apply. No edit-mode chrome, no pencil icons -- the same idea as
 * the app's existing long-press-to-rename pattern in Tasks
 * (shared/useLongPress.ts), just opening a menu instead of an inline editor.
 */
export default function ActionSheet({ title, actions, onClose }: {
  title: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{title}</div></div>
        <div className="pad-x sheet-actions">
          {actions.map((a) => (
            <button
              key={a.label}
              // GYM-F-28 (2026-09-05): the `danger` flag went. No caller ever
              // set it, so every row here has always drawn the same, and a
              // half-built styling seam is worse than none.
              className="btn btn-block btn-secondary"
              onClick={() => { onClose(); a.onClick(); }}
            >
              {a.label}
            </button>
          ))}
          <button className="btn btn-tertiary btn-block" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export interface PickItem { id: string; label: string; sub?: string }

/**
 * A generic single- or multi-select list sheet: Move to Day, Copy to Days,
 * Move to Program, Switch Program, Pair With. One primitive, configured, per
 * the app's own rule against a second implementation of a shared shape.
 */
export function PickSheet({ title, items, multi, initial, allowEmpty, confirmLabel, onPick, onCancel, emptyText, searchLabel }: {
  title: string;
  items: PickItem[];
  multi?: boolean;
  /** Pre-checked ids, for editors (pin days) as opposed to one-shot moves. */
  initial?: string[];
  /** Confirming with nothing picked is a legal answer (unpin everything). */
  allowEmpty?: boolean;
  /** The confirm button's words, by count. Default keeps the copy-to-days
   *  label this sheet grew up with. */
  confirmLabel?: (count: number) => string;
  onPick: (ids: string[]) => void;
  onCancel: () => void;
  emptyText?: string;
  /** What the search field says when the list is long enough to get one:
   *  "Search Exercises", "Search Programs". Defaults to "Search". */
  searchLabel?: string;
}) {
  const [chosen, setChosen] = useState<string[]>(initial ?? []);
  const toggle = (id: string) => {
    if (!multi) { onPick([id]); return; }
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  };
  /** A SEARCH ONCE THE LIST IS LONGER THAN A GLANCE (Dave 2026-09-18: "There
   *  also needs to be a search in these modals").
   *
   *  Not on every sheet: Move to Day offers four days and a field above them
   *  is furniture. Eight is where a list stops being something you read and
   *  starts being something you look through -- a real Exercises library is
   *  twenty or thirty rows deep, which is the sheet he was holding. */
  const [q, setQ] = useState("");
  const searchable = items.length >= 8;
  const needle = q.trim().toLowerCase();
  const shown = searchable && needle
    ? items.filter((it) => it.label.toLowerCase().includes(needle) || (it.sub ?? "").toLowerCase().includes(needle))
    : items;
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{title}</div></div>
        {searchable && (
          /* The search field the Exercises page uses, not a bare bordered
             input: same control, same shape, one search bar in the app. No
             autofocus -- the keyboard would cover the list you came to look
             at, and the field is right there when you want it. */
          <div className="pad-x ex-search">
            <input
              className="xs-input" type="search" placeholder={searchLabel ?? "Search"}
              aria-label={searchLabel ?? "Search"}
              value={q} onChange={(e) => setQ(e.target.value)}
            />
          </div>
        )}
        {items.length === 0 ? (
          <div className="pad-x"><div className="bp-sub">{emptyText ?? "Nothing to choose from."}</div></div>
        ) : shown.length === 0 ? (
          /* Never "no results": the rows are not missing, the search is
             narrow, and it says what it searched. */
          <div className="pad-x"><div className="bp-sub">{`Nothing here matches \u201C${q.trim()}\u201D`}</div></div>
        ) : (
          /* THE LIST IS THE SCROLLER, OR THE SHEET IS A TRAP (Dave 2026-09-18,
             on a sheet with no way out that kept freezing his screen; the
             same defect and the same fix as the Add from Your Lifts sheet on
             2026-09-16).

             .sheet-scrim > .card is a flex column capped at 92% of the
             visible band, and every child of it declares how it behaves in
             that column -- except this list, which was a bare <div>. A flex
             item defaults to min-height: auto, so it cannot shrink below its
             own content: with seventeen exercises in it the list grew past
             the cap and pushed Cancel off the bottom of the screen, with
             nothing scrollable because nothing had been told it was the
             scroller. Every exit was below the fold.

             .sheet-list carries the three rules .sheet-form has always had,
             and .sheet-actions below it is flex-shrink: 0, so the way out
             cannot be pushed anywhere. */
          <div className="sheet-list"><div className="list-flat">
            {shown.map((it) => (
              <div className="row" role="button" tabIndex={0} key={it.id} onClick={() => toggle(it.id)}>
                <div className="row-grow">
                  <div className="conn-name truncate">{it.label}</div>
                  {it.sub && <div className="conn-meta">{it.sub}</div>}
                </div>
                {multi && <span className={"chip" + (chosen.includes(it.id) ? " active" : "")} aria-pressed={chosen.includes(it.id)}>{chosen.includes(it.id) ? "Picked" : "Pick"}</span>}
              </div>
            ))}
          </div></div>
        )}
        <div className="pad-x sheet-actions">
          {multi && (
            <button className="btn btn-primary btn-launch btn-block" disabled={!allowEmpty && chosen.length === 0} onClick={() => onPick(chosen)}>
              {confirmLabel
                ? confirmLabel(chosen.length)
                : chosen.length > 0 ? `Copy to ${chosen.length} ${chosen.length === 1 ? "Day" : "Days"}` : "Pick at Least One"}
            </button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
