import { createPortal } from "react-dom";
import type { TaskItem } from "../TasksService";
import type { LinkedItem } from "../../notes/types";
import { actionLabelFor } from "../reminderHistory";
import { Note } from "../../shared/FormSheet";

// THE CONTEXT PROMPT (the reminders rebuild push E, Dave's interactive
// preview): a sheet, never a gate. An eyebrow saying what just happened,
// the reminder's words, one line on what it is about, the linked verb as
// the one filled action when a door exists, Continue Anyway, then Snooze
// Prompt and Turn Off as quiet pills, and why it appeared under a
// disclosure. Closing it is one tap either way.

export default function ContextPromptSheet({ item, eyebrow, onOpenLinked, onContinue, onSnooze, onTurnOff }: {
  item: TaskItem;
  /** "Opening Bridge" or "After Completing a Task". */
  eyebrow: string;
  onOpenLinked?: (link: LinkedItem) => void;
  onContinue: (id: string) => void;
  onSnooze: (id: string) => void;
  onTurnOff: (id: string) => void;
}) {
  const r = item.data.reminder;
  if (!r) return null;
  const link = r.linkedItem;
  return createPortal(
    <div className="sheet-scrim" onClick={() => onContinue(item.id)}>
      <div className="card xs form-sheet rem-prompt-sheet" role="dialog" aria-label="Reminder prompt" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-form">
          <div className="eyebrow rem-prompt-eyebrow">{eyebrow}</div>
          <div className="rem-detail-title">{item.data.text}</div>
          <div className="rem-prompt-line">{link?.label ? `${link.label} is one tap away` : "Still open, whenever you are ready"}</div>
          <div className="rem-detail-acts">
            {link && onOpenLinked && <button type="button" className="btn btn-primary" onClick={() => { onOpenLinked(link); onContinue(item.id); }}>{actionLabelFor(link)}</button>}
            <button type="button" className="btn btn-secondary" onClick={() => onContinue(item.id)}>Continue Anyway</button>
            <div className="rem-detail-grid">
              <button type="button" className="btn btn-secondary" onClick={() => onSnooze(item.id)}>Snooze Prompt</button>
              <button type="button" className="btn btn-secondary" onClick={() => onTurnOff(item.id)}>Turn Off</button>
            </div>
          </div>
          <details className="exp-more rem-more">
            <summary>Why This Appeared</summary>
            <Note>This reminder asked to be shown here. It responds to what you open inside JARVIS, never to another app</Note>
          </details>
          <div className="xs-foot" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
