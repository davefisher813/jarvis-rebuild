import { useState } from "react";
import { createPortal } from "react-dom";

export interface SheetAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
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
              className={"btn btn-block " + (a.danger ? "btn-secondary btn-danger-text" : "btn-secondary")}
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
export function PickSheet({ title, items, multi, initial, allowEmpty, confirmLabel, onPick, onCancel, emptyText }: {
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
}) {
  const [chosen, setChosen] = useState<string[]>(initial ?? []);
  const toggle = (id: string) => {
    if (!multi) { onPick([id]); return; }
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  };
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{title}</div></div>
        {items.length === 0 ? (
          <div className="pad-x"><div className="bp-sub">{emptyText ?? "Nothing to choose from."}</div></div>
        ) : (
          <div><div className="list-flat">
            {items.map((it) => (
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
            <button className="btn btn-primary btn-block" disabled={!allowEmpty && chosen.length === 0} onClick={() => onPick(chosen)}>
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
