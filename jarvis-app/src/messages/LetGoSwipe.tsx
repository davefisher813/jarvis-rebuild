import { CircleSlash } from "lucide-react";
import { useSwipe } from "../shared/useSwipe";

// Swipe a Waiting On row: Let It Go.
//
// Same gesture, same classes, same reveal width per action as mail and tasks
// (the math itself lives in the one shared controller). One action, not two:
// archive and delete belong to mail he RECEIVED, and a Waiting On row is
// mail he SENT. The only thing he wants to do to a thread nobody will ever
// answer is stop counting the days on it.
export default function LetGoSwipe({
  onLetGo,
  children,
}: {
  onLetGo: () => void;
  children: React.ReactNode;
}) {
  const swipe = useSwipe({ revealW: 88 });

  return (
    <div className="task-swipe">
      <button className="mail-arch" onClick={() => swipe.closeThen(onLetGo)} aria-label="Let it go">
        <CircleSlash className="ic" />
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
