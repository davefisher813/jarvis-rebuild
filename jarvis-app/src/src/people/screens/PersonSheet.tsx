import { createPortal } from "react-dom";
import { useState } from "react";
import type { PersonData, PersonGroup } from "../types";
import type { ColorSlot } from "../../categories/types";
import { AVATAR_COLORS, avatarClass } from "../types";

export interface PersonDraft {
  name: string;
  relationship: string;
  birthday: string;
  notes: string;
  color: ColorSlot;
}

const TRASH = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);

export default function PersonSheet({
  mode,
  group,
  initial,
  onSave,
  onDelete,
  onCancel,
}: {
  mode: "new" | "edit";
  group: PersonGroup;
  initial?: PersonData;
  onSave: (draft: PersonDraft) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [relationship, setRelationship] = useState(initial?.relationship ?? "");
  const [birthday, setBirthday] = useState(initial?.birthday ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [color, setColor] = useState<ColorSlot>(initial?.color ?? "red");
  const [touched, setTouched] = useState(false);

  const valid = name.trim().length > 0;
  const save = () => {
    if (!valid) { setTouched(true); return; }
    onSave({ name: name.trim(), relationship: relationship.trim(), birthday: birthday.trim(), notes: notes.trim(), color });
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Person" : "Edit Person"} · {group === "inner_circle" ? "Inner Circle" : group === "adversarial" ? "Adversarial" : "Contacts"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Name</div>
            <input className={"input" + (touched && !valid ? " input-error" : "")} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            {touched && !valid && <div className="input-error">Add a name.</div>}
          </div>
          <div className="field">
            <div className="input-label">Relationship</div>
            <input className="input" placeholder="e.g. Business partner" value={relationship} onChange={(e) => setRelationship(e.target.value)} />
          </div>
          <div className="field">
            <div className="input-label">Color</div>
            <div className="swatch-row">
              {AVATAR_COLORS.map((sl) => (
                <button key={sl} type="button" aria-label={sl} aria-pressed={color === sl} className={"av-swatch " + avatarClass(sl) + (color === sl ? " sel" : "")} onClick={() => setColor(sl)} />
              ))}
            </div>
          </div>
          <div className="field">
            <div className="input-label">Birthday</div>
            <input className="input" placeholder="e.g. March 4" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
          </div>
          <div className="field">
            <div className="input-label">Notes</div>
            <textarea className="input input-multiline" rows={3} placeholder="What JARVIS should remember" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block" onClick={save}>Save</button>
          {mode === "edit" && onDelete && (
            <button className="btn btn-danger btn-block" onClick={onDelete}>{TRASH}Delete Person</button>
          )}
          <button className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}
