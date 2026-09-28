import { useState } from "react";
import { createPortal } from "react-dom";
import { BRAIN_ROLES } from "./brainMemory";

// "WHO IS THIS?" (Brain Manual v1, 2026-09-27).
//
// The inline triage card for an unknown sender or attendee: a multi-select
// of the flow-doc role set (BRAIN_ROLES) plus one optional line. Presentational
// only -- the flow owns the write (create the person row if needed, then
// BrainMemoryService.triagePerson), so this sheet is shared by Messages and
// the event sheet. Chips are the house .chip-row/.chip atoms (the " on"
// class is the existing selected state); the sheet skeleton is QuickCapture's.

function roleLabel(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default function WhoIsThisSheet({
  name,
  initialRoles = [],
  initialNote = "",
  onSave,
  onClose,
}: {
  name: string;
  initialRoles?: string[];
  initialNote?: string;
  onSave: (roles: string[], note: string) => void;
  onClose: () => void;
}) {
  const [roles, setRoles] = useState<string[]>(() => BRAIN_ROLES.filter((r) => initialRoles.includes(r)));
  const [note, setNote] = useState(initialNote);

  const toggle = (role: string) =>
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));

  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Who Is This?</div></div>
        <div className="pad-x sheet-form">
          <div className="conn-name">{name}</div>
          <div className="chip-row" role="group" aria-label="Roles">
            {BRAIN_ROLES.map((role) => (
              <button
                key={role}
                className={"chip" + (roles.includes(role) ? " on" : "")}
                aria-pressed={roles.includes(role)}
                onClick={() => toggle(role)}
              >
                {roleLabel(role)}
              </button>
            ))}
          </div>
          <input
            className="input"
            aria-label="Note, Optional"
            placeholder="Note (Optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="sheet-actions">
            <button className="btn btn-primary btn-block" onClick={() => { onClose(); onSave(roles, note); }} disabled={roles.length === 0}>
              Save
            </button>
            <button className="btn btn-secondary btn-block" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
