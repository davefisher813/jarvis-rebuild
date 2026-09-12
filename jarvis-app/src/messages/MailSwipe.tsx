import { Archive, Trash2, Clock } from "../shared/icons";
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
//
// B13 (2026-08-23): both actions now say their names. An icon in a coloured
// slot is a guess until you have made it once, and a trash can next to a
// filing tray is exactly the pair worth not guessing between. The reveal
// width is UNCHANGED at 176: the labels are short enough for 88px, and
// widening the reveal would cover more of the row you are deciding about.
//
// E-28 (Push H, 2026-09-12): a Needs You row also reveals Later, in the
// design system's defer amber, ahead of Archive. Three actions, three slots
// of 88: the reveal grows to 264 only on the rows that carry it.
export default function MailSwipe({
  onArchive,
  onDelete,
  onLater,
  children,
}: {
  onArchive: () => void;
  onDelete: () => void;
  onLater?: () => void;
  children: React.ReactNode;
}) {
  const swipe = useSwipe({ revealW: onLater ? 264 : 176 });

  return (
    <div className="task-swipe">
      {onLater && (
        <button className="mail-later" onClick={onLater} aria-label="Later">
          <Clock className="ic" />
          <span className="swipe-label">Later</span>
        </button>
      )}
      <button className="mail-arch" onClick={onArchive} aria-label="Archive">
        <Archive className="ic" />
        <span className="swipe-label">Archive</span>
      </button>
      <button className="task-del" onClick={onDelete} aria-label="Delete">
        <Trash2 className="ic" />
        <span className="swipe-label">Delete</span>
      </button>
      <div
        // swipe-shell: .task-row is in the shared row-padding rule because in
        // Tasks it IS the row. Here it merely carries a .row that brings its
        // own padding, and the two stacked into 24px of dead space around
        // every mail row: the giant black gaps in Dave's 2026-08-26
        // screenshots, present since B13 wrapped rows and invisible to a walk
        // that measured .row instead of the block that contains it.
        className={"task-row swipe-shell" + (swipe.dragging ? " swiping" : "")}
        style={{ transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined }}
        {...swipe.handlers}
      >
        {children}
      </div>
    </div>
  );
}
