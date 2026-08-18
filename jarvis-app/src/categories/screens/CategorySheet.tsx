import { createPortal } from "react-dom";
import { useState } from "react";
import { COLOR_SLOTS, CATEGORY_KINDS, KIND_LABEL, type ColorSlot, type CategoryKind } from "../types";
import { suggestKind } from "../kinds";
import { catIcon, ICON_KEYS } from "../icons";

export interface CategoryDraft {
  name: string;
  color: ColorSlot;
  icon: string;
  kind: CategoryKind;
  season?: "paused";
  workHours?: boolean;
}

const TRASH = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export default function CategorySheet({
  mode,
  initial,
  onSave,
  onDelete,
  onCancel,
}: {
  mode: "new" | "edit";
  initial?: Partial<CategoryDraft>;
  onSave: (draft: CategoryDraft) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [delArmed, setDelArmed] = useState(false);
  const [color, setColor] = useState<ColorSlot>(initial?.color ?? "blue");
  const [icon, setIcon] = useState<string>(initial?.icon ?? "folder");
  // Kind defaults from the name (never silently written; saving makes it real).
  const [kind, setKind] = useState<CategoryKind>(initial?.kind ?? suggestKind(initial?.name ?? ""));
  const [season, setSeason] = useState<"paused" | undefined>(initial?.season);
  const [workHours, setWorkHours] = useState(!!initial?.workHours);
  const [touched, setTouched] = useState(false);

  const valid = name.trim().length > 0;
  const save = () => {
    if (!valid) {
      setTouched(true);
      return;
    }
    onSave({
      name: name.trim(),
      color,
      icon,
      kind,
      // Org settings only mean something on an org category; leaving org
      // clears them so a paused Work category cannot haunt a renamed one.
      season: kind === "org" ? season : undefined,
      workHours: kind === "org" ? workHours : undefined,
    });
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Category" : "Edit Category"}</div></div>

        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Name</div>
            <input
              className={"input" + (touched && !valid ? " input-error" : "")}
              placeholder="Category name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {touched && !valid && <div className="input-error">Add a category name.</div>}
          </div>

          <div className="field">
            <div className="input-label">What Kind of Category</div>
            <div className="chip-row chip-wrap-row">
              {CATEGORY_KINDS.map((k) => (
                <div key={k} className={"chip" + (kind === k ? " active" : "")} role="button" tabIndex={0} aria-pressed={kind === k}
                  onClick={() => setKind(k)}>{KIND_LABEL[k]}</div>
              ))}
            </div>
          </div>

          {kind === "org" && (
            <>
              <div className="field">
                <div className="input-label">Season</div>
                {/* Paused = suggestions leave it alone until you wake it.
                    Bills never pause; a low month cannot silence rent. */}
                <div className="segmented">
                  <button type="button" className={"seg" + (!season ? " active" : "")} onClick={() => setSeason(undefined)}>Active</button>
                  <button type="button" className={"seg" + (season === "paused" ? " active" : "")} onClick={() => setSeason("paused")}>Paused</button>
                </div>
              </div>
              <div className="field">
                <div className="input-label">Work Hours</div>
                <div className="segmented">
                  <button type="button" className={"seg" + (!workHours ? " active" : "")} onClick={() => setWorkHours(false)}>Off</button>
                  <button type="button" className={"seg" + (workHours ? " active" : "")} onClick={() => setWorkHours(true)}>Follows my work hours</button>
                </div>
              </div>
            </>
          )}

          <div className="field">
            <div className="input-label">Color</div>
            <div className="swatch-pick">
              {COLOR_SLOTS.map((s) => (
                <button
                  key={s}
                  className={"swatch cat-bg-" + s + (s === color ? " sel" : "")}
                  aria-label={s}
                  aria-pressed={s === color}
                  onClick={() => setColor(s)}
                />
              ))}
            </div>
          </div>

          <div className="field">
            <div className="input-label">Icon</div>
            <div className="icon-pick">
              {ICON_KEYS.map((k) => (
                <button
                  key={k}
                  className={"icpick" + (k === icon ? " sel" : "")}
                  aria-label={k}
                  aria-pressed={k === icon}
                  onClick={() => setIcon(k)}
                >
                  {catIcon(k)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={save}>Save</button>
          {/* Armed two-tap (2026-08-09): deleting a category orphans every
              task, note, and project tagged with it, and it fired on ONE tap
              of a red button. Same pattern as Redo Setup. */}
          {mode === "edit" && onDelete && (
            <button className="btn btn-danger btn-block" onClick={() => { if (delArmed) { onDelete(); } else { setDelArmed(true); } }}>
              {TRASH}{delArmed ? "Tap again to delete" : "Delete Category"}
            </button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}
