import { useState, type ReactNode } from "react";
import { CalendarDays, ListChecks, FolderKanban, User, Target } from "../../shared/icons";
import { FormSheet, Group, FieldRow, Note, ErrorLine } from "../../shared/FormSheet";

// CREATE AND LINK IN ONE STEP (LinkPicker catalog pick, 2026-09-0X). The
// picker only ever offered what already existed -- nothing to link meant
// leaving the note, creating the thing on its own screen, and coming back
// here to find and pick it. This is the one-field door that skips the trip:
// a name, Save, and it is both created AND connected to the note in the
// same tap. Everything else about the new task/event/project/person/goal
// (a due date, a category, a time) is exactly what its own screen already
// asks for -- this only ever asks the one question a picker's own "+" can
// answer without becoming that screen.
export type QuickCreateKind = "event" | "task" | "project" | "person" | "goal";

const META: Record<QuickCreateKind, { title: string; group: string; placeholder: string; tone: string; glyph: ReactNode }> = {
  event: { title: "New Event", group: "Event", placeholder: "What's happening?", tone: "sky", glyph: <CalendarDays className="ic" /> },
  task: { title: "New Task", group: "Task", placeholder: "What needs doing?", tone: "red", glyph: <ListChecks className="ic" /> },
  project: { title: "New Project", group: "Project", placeholder: "e.g. Q3 launch plan", tone: "blue", glyph: <FolderKanban className="ic" /> },
  person: { title: "New Person", group: "Person", placeholder: "Full Name", tone: "pink", glyph: <User className="ic" /> },
  goal: { title: "New Goal", group: "Goal", placeholder: "e.g. Run a half marathon", tone: "green", glyph: <Target className="ic" /> },
};

// An event needs somewhere to sit on the calendar; the sheet asks for a
// name only, so it lands today at the next half hour -- open, editable
// from the event's own screen the moment it exists, same as every other
// quick-added thing in this app.
export function nextHalfHour(now = new Date()): string {
  const mins = now.getMinutes();
  const rounded = mins < 30 ? 30 : 60;
  const h = (now.getHours() + (rounded === 60 ? 1 : 0)) % 24;
  const m = rounded === 60 ? 0 : 30;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

export default function QuickCreateSheet({
  kind,
  onCreate,
  onCancel,
}: {
  kind: QuickCreateKind;
  onCreate: (title: string) => void;
  onCancel: () => void;
}) {
  const meta = META[kind];
  const [title, setTitle] = useState("");
  const [touched, setTouched] = useState(false);
  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save creates
  // the thing, so two taps created two.
  const [saving, setSaving] = useState(false);
  const valid = title.trim().length > 0;
  const save = () => {
    if (!valid) { setTouched(true); return; }
    if (saving) return;
    setSaving(true);
    onCreate(title.trim());
  };
  return (
    <FormSheet title={meta.title} onCancel={onCancel} onSave={save} saveDisabled={!valid} saveLabel={saving ? "Saving" : "Save"}>
      <Group label={meta.group}>
        <FieldRow tone={meta.tone} glyph={meta.glyph} value={title} onChange={setTitle} placeholder={meta.placeholder}
          ariaLabel={meta.title} error={touched && !valid} right={false} onEnter={save} />
      </Group>
      <ErrorLine text={touched && !valid ? "Add a name." : null} />
      <Note>Links to this note the moment you save.</Note>
    </FormSheet>
  );
}
