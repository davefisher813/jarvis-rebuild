import { createPortal } from "react-dom";
import { emit } from "../events";

// OTHER GOOD CHOICES (C-24, Astra pass 2026-09-12).
//
// The deck behind the dealt task, which used to be a grey "13 waiting"
// receipt that led to the Up Next flow. Two tasks, ranked, each startable
// from here, and one quiet way out to What Now for the times when neither of
// the three is the thing.
//
// Starting one of these is a real signal: JARVIS offered A and he took B. It
// emits suggestion.dismissed with kind "other" against the task that WAS
// offered, so the log says what was turned down rather than only what was
// taken.
export interface Choice {
  id: string;
  text: string;
  facts?: string | null;
}

export default function OtherChoicesSheet({
  offeredId, choices, onStart, onOpen, onPickSomethingElse, onClose,
}: {
  /** The headliner's task: the one that was offered and not taken. */
  offeredId: string;
  choices: Choice[];
  onStart: (id: string) => void;
  onOpen?: (id: string) => void;
  onPickSomethingElse?: () => void;
  onClose: () => void;
}) {
  const start = (id: string) => {
    emit({ type: "suggestion.dismissed", entityType: "task", entityId: offeredId, props: { kind: "other" } });
    onStart(id);
    onClose();
  };
  return createPortal(
    <div className="sheet-scrim" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Other Good Choices</div></div>
        {choices.map((c) => (
          <div className="row" key={c.id}>
            <div className="row-stack" role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onClick={() => onOpen?.(c.id)}>
              <div className="conn-name truncate">{c.text}</div>
              {c.facts && <div className="facts"><span className="fact">{c.facts}</span></div>}
            </div>
            <button className="pill-act" onClick={() => start(c.id)}>Start</button>
          </div>
        ))}
        <div className="sheet-form">
          {onPickSomethingElse && (
            <button className="quiet-action" onClick={() => { onPickSomethingElse(); onClose(); }}>Pick Something Else</button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
