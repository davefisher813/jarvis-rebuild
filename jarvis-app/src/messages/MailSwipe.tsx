import { useRef, useState } from "react";
import { Archive, Trash2 } from "lucide-react";

// Swipe a mail row: Archive, or Delete.
//
// Same gesture, same classes, same 88px reveal as Tasks — a swipe must feel
// identical everywhere in the app. Two differences, both deliberate:
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
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const decided = useRef(false);
  const horizontal = useRef(false);
  const revealW = 176;

  const onStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0]!.clientX;
    startY.current = e.touches[0]!.clientY;
    decided.current = false;
    horizontal.current = false;
    setDragging(true);
  };
  const onMove = (e: React.TouchEvent) => {
    const mx = e.touches[0]!.clientX - startX.current;
    const my = e.touches[0]!.clientY - startY.current;
    // Decide direction once: horizontal claims the gesture, vertical is left
    // alone so the list still scrolls.
    if (!decided.current && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
      decided.current = true;
      horizontal.current = Math.abs(mx) > Math.abs(my);
    }
    if (!horizontal.current) return;
    e.preventDefault();
    const base = open ? -revealW : 0;
    setDx(Math.max(-revealW, Math.min(0, base + mx)));
  };
  const onEnd = () => {
    setDragging(false);
    if (!horizontal.current) return;
    const nowOpen = dx < -revealW / 2;
    setOpen(nowOpen);
    setDx(nowOpen ? -revealW : 0);
  };

  return (
    <div className="task-swipe">
      <button className="mail-arch" onClick={onArchive} aria-label="Archive">
        <Archive className="ic" />
      </button>
      <button className="task-del" onClick={onDelete} aria-label="Delete">
        <Trash2 className="ic" />
      </button>
      <div
        className={"task-row" + (dragging ? " swiping" : "")}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
      >
        {children}
      </div>
    </div>
  );
}
