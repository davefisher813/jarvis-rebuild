import { useEffect, useState } from "react";
import EventSheet, { type EventDraft } from "../schedule/screens/EventSheet";
import type { SheetCategory } from "../tasks/screens/TaskSheet";
import { useOptionalCategories } from "../data/NotesProvider";

// THE EXISTING EVENT SHEET, FOR AN APPOINTMENT AN EMAIL LEFT OPEN (2026-09-29).
//
// When the sentence did not settle the day, the time, or AM and PM, the card
// does not guess and does not invent a form: it opens the same sheet the
// schedule uses, prefilled with what the message did say, and the person fills
// in the rest. The sheet needs the person's areas (categories); this reads
// them from the provider when there is one and offers none when there is not,
// which the sheet already handles.
export default function MeetingEventSheet({
  mode, initial, onSave, onDelete, onCancel,
}: {
  mode: "new" | "edit";
  initial: Partial<EventDraft>;
  onSave: (draft: EventDraft) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const cats = useOptionalCategories();
  const [categories, setCategories] = useState<SheetCategory[]>([]);
  useEffect(() => {
    if (!cats) return;
    let on = true;
    void cats.list().then((list) => { if (on) setCategories(list.map((c) => ({ id: c.id, name: c.data.name, color: c.data.color }))); }).catch(() => {});
    return () => { on = false; };
  }, [cats]);
  return (
    <EventSheet
      mode={mode}
      initial={initial}
      categories={categories}
      // Handed on whole: every field the sheet shows reaches the caller, which writes them all (emailSchedule.applyEventDraft).
      onSave={(draft) => onSave(draft)}
      {...(onDelete ? { onDelete } : {})}
      onCancel={onCancel}
    />
  );
}
