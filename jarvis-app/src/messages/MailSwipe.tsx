import { Archive, Trash2 } from "lucide-react";
import { useSwipe } from "../shared/useSwipe";

// Swipe a mail row: Archive, or Delete.
//
// Same gesture, same classes, same reveal as Tasks; a swipe must feel
// identical everywhere in the app (the gesture itself lives in the one
// shared controller, useSwipe). Two differences here, both deliberate:
//
//   - Archive is NOT amber. Amber means defer, and archiving is not deferring;
//     it is filing something you are done with. It gets a neutral fill.
//   - Delete goes to Gmail's TRASH, which is recoverable for 30 days. This app
//     never calls Gmail's permanent-delete endpoint.
export default function MailSwipe({
  onArchive,
  onDelete,
  children,
}: {
  onArchive: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const swipe = useSwipe({ revealW: 176 });

  return (
    <div className="task-swipe">
      <button className="mail-arch" onClick={onArchive} aria-label="Archive">
        <Archive className="ic" />
      </button>
      <button className="task-del" onClick={onDelete} aria-label="Delete">
        <Trash2 className="ic" />
      </button>
      <div
        className={"task-row" + (swipe.dragging ? " swiping" : "")}
        style={{ transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined }}
        {...swipe.handlers}
      >
        {children}
      </div>
    </div>
  );
}
