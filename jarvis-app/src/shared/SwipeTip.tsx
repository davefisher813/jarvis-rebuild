import { useEffect, useState } from "react";
import { X } from "./icons";
import { dismissTip, onSwipeTeachChange, tipVisible } from "./swipeTeach";

// THE SWIPE TIP (Dave 2026-10-05, locked): a quiet one-line note at the top of the Today list on first run. It
// disappears for good after the first real swipe or the first dismiss. It is a note, not a control: no capsule.
export default function SwipeTip() {
  const [show, setShow] = useState(tipVisible);
  useEffect(() => onSwipeTeachChange(() => setShow(tipVisible())), []);
  if (!show) return null;
  return (
    <div className="pad-x">
      <div className="swipe-tip" role="note">
        <span className="swipe-tip-t">Swipe a Task for Quick Actions</span>
        <button type="button" className="swipe-tip-x" aria-label="Dismiss Tip" onClick={dismissTip}><X className="ic" /></button>
      </div>
    </div>
  );
}
