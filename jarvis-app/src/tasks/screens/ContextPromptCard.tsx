import type { TaskItem } from "../TasksService";
import type { LinkedItem } from "../../notes/types";
import { actionLabelFor } from "../reminderHistory";
import { BellGlyph } from "../../shared/glyphs";

// THE CONTEXT PROMPT (the reminders rebuild push D, 2026-09-15). A card,
// never a gate: the reminder's words, what it is about, the verb that
// opens the record when there is one, Continue Anyway, and a day's snooze.
// Nothing here blocks the screen under it, and closing it is one tap.

export default function ContextPromptCard({ item, onOpenLinked, onContinue, onSnooze }: {
  item: TaskItem;
  onOpenLinked?: (link: LinkedItem) => void;
  onContinue: (id: string) => void;
  onSnooze: (id: string) => void;
}) {
  const r = item.data.reminder;
  if (!r) return null;
  const link = r.linkedItem;
  return (
    <div className="pad-x"><div className="card rem-prompt" role="status">
      <div className="rem-prompt-head">
        <div className="row-ico nav-tile-purple"><BellGlyph /></div>
        <div className="rem-prompt-body">
          <div className="rem-name">{item.data.text}</div>
          <div className="rem-explain">{link?.label ? `About ${link.label} · Look before you go on?` : "For right now · Go on when you are ready"}</div>
        </div>
      </div>
      <div className="rem-prompt-acts">
        {link && onOpenLinked && <button type="button" className="pill-act" onClick={() => onOpenLinked(link)}>{actionLabelFor(link)}</button>}
        <button type="button" className="pill-act" onClick={() => onContinue(item.id)}>Continue Anyway</button>
        <button type="button" className="pill-act pill-quiet" onClick={() => onSnooze(item.id)}>Snooze This Prompt</button>
      </div>
    </div></div>
  );
}
