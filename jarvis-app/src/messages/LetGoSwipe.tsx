import { CircleSlash, Ellipsis } from "../shared/icons";
import { useSwipe } from "../shared/useSwipe";

// Swipe a Waiting On row: More Moves, or Let It Go.
//
// Same gesture, same classes, same 88px per action as mail and tasks (the
// math itself lives in the one shared controller).
//
// TWO BUGS FIXED HERE 2026-08-21, both from the same reading:
//
//   1. The reveal was 88px wide and its only button sat at right:88px, which
//      is the slot the row still covers at that width. Let It Go has been
//      unreachable since the day it shipped: the swipe opened onto an empty
//      strip. A one-action reveal has to use the right:0 slot.
//   2. decide() returns everything else this thread could become, and none
//      of it was reachable. It is now: More opens the sheet.
//
// Let It Go keeps the outer slot because it is the one-swipe case (a dead
// thread), and neither button is destructive: nothing here touches the mail.
//
// B13 (2026-08-23): More is the only way into MailMoreSheet, which holds the
// entire escalation ladder for this row. It was an ellipsis behind a swipe:
// the most buried control in the app, guarding the most useful sheet in it.
// Now it says More.
export default function LetGoSwipe({
  onMore,
  onLetGo,
  children,
}: {
  onMore?: () => void;
  onLetGo: () => void;
  children: React.ReactNode;
}) {
  const swipe = useSwipe({ revealW: onMore ? 176 : 88 });

  return (
    <div className="task-swipe">
      {onMore && (
        <button className="mail-arch" onClick={() => swipe.closeThen(onMore)} aria-label="More moves">
          <Ellipsis className="ic" />
          <span className="swipe-label">More</span>
        </button>
      )}
      <button className="mail-letgo" onClick={() => swipe.closeThen(onLetGo)} aria-label="Let it go">
        <CircleSlash className="ic" />
        <span className="swipe-label">Let Go</span>
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
