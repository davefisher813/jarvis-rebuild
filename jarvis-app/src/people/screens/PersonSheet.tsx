import { createPortal } from "react-dom";
import { useState } from "react";
import type { PersonData } from "../types";
import type { ColorSlot } from "../../categories/types";
import { AVATAR_COLORS, avatarClass } from "../types";
import { LABEL_CHIPS } from "../views";

export interface SheetCategoryOpt { id: string; name: string; color: ColorSlot }

export interface PersonDraft {
  name: string;
  relationship: string;
  birthday: string;
  notes: string;
  color: ColorSlot;
  // Person pass (2026-08-03)
  email: string;
  phone: string;
  register?: "casual" | "professional" | "friend";
  categoryIds: string[];
}

const TRASH = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);

export default function PersonSheet({
  mode,
  initial,
  categories = [],
  onSave,
  onDelete,
  onCancel,
}: {
  mode: "new" | "edit";
  initial?: PersonData;
  categories?: SheetCategoryOpt[];
  onSave: (draft: PersonDraft) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [relationship, setRelationship] = useState(initial?.relationship ?? "");
  const [birthday, setBirthday] = useState(initial?.birthday ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [color, setColor] = useState<ColorSlot>(initial?.color ?? "red");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [register, setRegister] = useState<"casual" | "professional" | "friend" | undefined>(initial?.register);
  const [categoryIds, setCategoryIds] = useState<string[]>(initial?.categoryIds ?? []);
  const [touched, setTouched] = useState(false);

  const toggleCategory = (id: string) =>
    setCategoryIds((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]));

  const valid = name.trim().length > 0;
  const save = () => {
    if (!valid) { setTouched(true); return; }
    onSave({
      name: name.trim(),
      relationship: relationship.trim(),
      birthday: birthday.trim(),
      notes: notes.trim(),
      color,
      email: email.trim(),
      phone: phone.trim(),
      register,
      categoryIds,
    });
  };

  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">{mode === "new" ? "New Person" : "Edit Person"}</div></div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Name</div>
            <input className={"input" + (touched && !valid ? " input-error" : "")} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            {touched && !valid && <div className="input-error">Add a name.</div>}
          </div>
          <div className="field">
            <div className="input-label">Who they are to you</div>
            {/* Chips first, typing second: the label field existed for months
                and stayed empty because it was a blank box. One universal set
                for v1; kind-aware sets arrive when category kinds exist. */}
            <div className="chip-row chip-wrap-row">
              {LABEL_CHIPS.map((l) => (
                <div key={l} className={"chip" + (relationship === l ? " active" : "")} role="button" tabIndex={0} aria-pressed={relationship === l}
                  onClick={() => setRelationship(relationship === l ? "" : l)}>{l}</div>
              ))}
            </div>
            <input className="input" placeholder="Or say it your way" value={(LABEL_CHIPS as readonly string[]).includes(relationship) ? "" : relationship} onChange={(e) => setRelationship(e.target.value)} />
          </div>
          <div className="field">
            <div className="input-label">How JARVIS writes to them</div>
            {/* Register, deliberately NOT closeness: nobody taps "Not really"
                about their mother. Unset = unknown = clean prose. Ordered as a
                looseness scale; "Close Friend" (not "Friend") so the segment
                never shares its exact title with the label chip above. */}
            <div className="segmented">
              <button type="button" className={"seg" + (register === "friend" ? " active" : "")} onClick={() => setRegister(register === "friend" ? undefined : "friend")}>Close Friend</button>
              <button type="button" className={"seg" + (register === "casual" ? " active" : "")} onClick={() => setRegister(register === "casual" ? undefined : "casual")}>Casual</button>
              <button type="button" className={"seg" + (register === "professional" ? " active" : "")} onClick={() => setRegister(register === "professional" ? undefined : "professional")}>Professional</button>
            </div>
          </div>
          <div className="field">
            <div className="input-label">Contact</div>
            <input className="input input-stack" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="input" type="tel" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          {categories.length > 0 && (
            <div className="field">
              <div className="input-label">Part of</div>
              {/* MULTI-select on purpose: a person can be Family AND Bridge.
                  Single-tag here would rebuild the exclusive-bucket mistake
                  one layer down. */}
              <div className="chip-row chip-wrap-row">
                {categories.map((c) => (
                  <div key={c.id} className={"chip" + (categoryIds.includes(c.id) ? " active" : "")} role="button" tabIndex={0} aria-pressed={categoryIds.includes(c.id)}
                    onClick={() => toggleCategory(c.id)}>
                    <span className={"cat-dot cat-bg-" + c.color} />{c.name}
                  </div>
                ))}
              </div>
            </div>
          )}
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
