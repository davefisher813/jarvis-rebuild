import { useState } from "react";
import LargeTitleNav from "../shared/LargeTitleNav";
import { showToast } from "../shared/toast";
import { Head, Card, Row, Menu, Foot, DangerRow, focusField } from "./kit";
import { useEmailSections } from "../messages/useEmailSections";
import {
  FIELD_LABEL, SECTION_FIELDS, addSectionBlock, isCapError, newSectionId, removeSection, restoreSection,
  upsertSection, validateSection, type EmailSection, type SectionField,
} from "../messages/emailSections";

// EMAIL SECTIONS (2026-09-29): a plain editable list of the person's own local
// filters for the Email tab. Add, Edit, Delete with Undo, in the settings
// kit's own rows. No preview and no simulator: the chips on the Email tab are
// the preview.
//
// WHAT THIS SCREEN NEVER DOES: call AI, or touch Gmail. A section is a saved
// filter over mail already loaded on the phone (messages/emailSections.ts).
//
// ERRORS ARE SHOWN, NOT FIXED. A name over 60 characters, a matcher over 200,
// a duplicate name, an empty matcher: each says so under its own field, and
// nothing is trimmed or dropped to make it fit. Errors for an empty field wait
// until the first Save, so opening a fresh section does not open red; the
// length caps speak as soon as they are crossed.
//
// A SAVE THAT FAILS KEEPS THE EDITOR OPEN with everything as typed, and the
// list only changes once the write has landed (useEmailSections.commit).
// Offline, the write queues like every profile write and the foot says so.

const FIELD_OPTIONS = SECTION_FIELDS.map((f) => ({ value: f, label: FIELD_LABEL[f] }));

interface Editing { isNew: boolean; index: number; draft: EmailSection; attempted: boolean }

const summary = (s: EmailSection): string => {
  const texts = s.matchers.map((m) => m.text.trim()).filter(Boolean);
  if (texts.length === 0) return "No Matchers";
  return texts.slice(0, 3).join(" · ") + (texts.length > 3 ? " · +" + (texts.length - 3) + " More" : "");
};

export default function EmailSectionsPage({ onBack }: { onBack: () => void }) {
  const { sections, loaded, available, current, commit, pending } = useEmailSections();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [capNote, setCapNote] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  const startNew = () => {
    const why = addSectionBlock(current());
    setCapNote(why);
    if (why) return;
    setEditing({ isNew: true, index: current().length, attempted: false, draft: { id: newSectionId(), name: "", matchers: [{ field: "sender", text: "" }] } });
  };
  const startEdit = (s: EmailSection, index: number) => {
    setCapNote(null);
    setEditing({ isNew: false, index, attempted: false, draft: { ...s, matchers: s.matchers.map((m) => ({ ...m })) } });
  };
  const patch = (fn: (d: EmailSection) => EmailSection) => setEditing((e) => (e ? { ...e, draft: fn(e.draft) } : e));

  const others = editing ? current().filter((x) => x.id !== editing.draft.id) : [];
  const check = editing ? validateSection(editing.draft, others) : null;

  const save = async () => {
    if (!editing || saving) return;
    setEditing({ ...editing, attempted: true });
    if (!validateSection(editing.draft, others).ok) return;
    setSaving(true);
    const ok = await commit(upsertSection(current(), editing.draft));
    setSaving(false);
    if (!ok) return;
    setQueued(pending());
    setEditing(null);
  };

  const remove = async (s: EmailSection) => {
    if (saving) return;
    const at = current().findIndex((x) => x.id === s.id);
    setSaving(true);
    const ok = await commit(removeSection(current(), s.id));
    setSaving(false);
    if (!ok) return;
    setQueued(pending());
    setEditing(null);
    showToast({
      message: "Section Deleted · Mail Untouched",
      actionLabel: "Undo",
      onAction: () => void (async () => {
        if (await commit(restoreSection(current(), s, at))) setQueued(pending());
      })(),
    });
  };

  const show = (msg: string | undefined) => (editing && msg && (editing.attempted || isCapError(msg)) ? msg : undefined);

  return (
    <div className="screen ruled">
      <LargeTitleNav title="Email Sections" back="Settings" onBack={onBack} />

      {editing && check && (
        <>
          <Head label={editing.isNew ? "New Section" : "Edit Section"} />
          <Card>
            <div className="row set-row" onClick={focusField}>
              <div className="conn-name">Name</div>
              <input className="set-field" aria-label="Section Name" placeholder="Section Name" value={editing.draft.name}
                onChange={(e) => patch((d) => ({ ...d, name: e.target.value }))} />
            </div>
            {show(check.name) && <div className="input-error set-err" role="alert">{check.name}</div>}
            {editing.draft.matchers.map((m, i) => (
              <MatcherRows
                key={i}
                n={i + 1}
                field={m.field}
                text={m.text}
                error={show(check.matchers[i])}
                onField={(f) => patch((d) => ({ ...d, matchers: d.matchers.map((x, j) => (j === i ? { ...x, field: f } : x)) }))}
                onText={(t) => patch((d) => ({ ...d, matchers: d.matchers.map((x, j) => (j === i ? { ...x, text: t } : x)) }))}
                onRemove={() => patch((d) => ({ ...d, matchers: d.matchers.filter((_, j) => j !== i) }))}
              />
            ))}
            {show(check.section) && <div className="input-error set-err" role="alert">{check.section}</div>}
            <button type="button" className="row row-act" onClick={() => patch((d) => ({ ...d, matchers: [...d.matchers, { field: "sender", text: "" }] }))}>Add Matcher</button>
            <button type="button" className="row row-act" onClick={() => void save()} disabled={saving}>{saving ? "Saving" : "Save Section"}</button>
            <button type="button" className="row row-act" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
            {!editing.isNew && <DangerRow label="Delete Section" onClick={() => void remove(editing.draft)} disabled={saving} />}
          </Card>
          <Foot>Any matcher can match · Not case sensitive · Text is matched exactly as typed</Foot>
        </>
      )}

      {!editing && loaded && sections.length === 0 && (
        <div className="empty-state">
          <div className="empty-title">No Sections Yet</div>
          <div className="empty-sub">Filters you make appear as chips on the Email tab</div>
          <button type="button" className="btn btn-secondary" onClick={startNew} disabled={!available}>Add Section</button>
        </div>
      )}

      {sections.length > 0 && (
        <>
          <Head label="Sections" count={sections.length} />
          <Card>
            {sections.map((s, i) => (
              <Row key={s.id} label={s.name} meta={summary(s)} chev onClick={() => startEdit(s, i)} />
            ))}
            {!editing && <button type="button" className="row row-act" onClick={startNew} disabled={!available}>Add Section</button>}
          </Card>
        </>
      )}
      {capNote && <div className="pad-x"><div className="input-error" role="alert">{capNote}</div></div>}
      {(sections.length > 0 || editing) && (
        <Foot>{queued ? "Saved on This Phone · Will Sync" : "Filters over mail already loaded · Nothing changes in Gmail"}</Foot>
      )}
      <div className="screen-foot" />
    </div>
  );
}

function MatcherRows({ n, field, text, error, onField, onText, onRemove }: {
  n: number;
  field: SectionField;
  text: string;
  error: string | undefined;
  onField: (f: SectionField) => void;
  onText: (t: string) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <Menu label="Match" value={field} options={FIELD_OPTIONS} onPick={(v) => onField(v as SectionField)} ariaLabel={`Match Type ${n}`} />
      <div className="row set-row" onClick={focusField}>
        <div className="conn-name">Text</div>
        <input className="set-field" aria-label={`Text to Match ${n}`} placeholder="Text to Match" value={text} onChange={(e) => onText(e.target.value)} />
      </div>
      {error && <div className="input-error set-err" role="alert">{error}</div>}
      <button type="button" className="row row-act" onClick={onRemove}>{`Remove Matcher ${n}`}</button>
    </>
  );
}
