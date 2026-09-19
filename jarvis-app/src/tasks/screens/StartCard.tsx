import type { StartAction } from "../startAction";
import type { TopPick } from "../startPick";

// A PLACE TO BEGIN (Start Now, 2026-09-16; cut down 2026-09-18).
//
// It was a slab: an eyebrow, the name at h2, a line of ready, a full-bleed
// red button, and two quiet links opening two sheets. Roughly 480px for ONE
// action, sitting directly above a list whose first row offered the same task
// with the same Start button. Dave: "let's clean up this massive card for one
// simple action. It's beyond overkill."
//
// What is left is a row: what to start, why it was picked, what is already
// ready on it, and the button. One line of reason instead of a Why This
// sheet, because startPick will no longer make a pick it cannot explain in
// one line. No Choose Another, because the list underneath IS choose another.
export interface StartCardProps {
  pick: TopPick;
  action: StartAction;
  /** Why this one, in the words of startReason. Never empty in practice:
   *  topPick returns null when there is no reason to give. */
  reason: string;
  onStart: (id: string) => void;
}

export default function StartCard({ pick, action, reason, onStart }: StartCardProps) {
  // ONE FACT, NOT TWO (2026-09-18). As two spans, .facts drew its separator
  // between them and then ellipsed the second to nothing on a narrow row --
  // leaving a line that ended in a dangling middle dot. Joined here, the
  // truncation falls on the words instead, where it belongs.
  const line = [reason, action.ready].filter(Boolean).join(" \u00b7 ");
  return (
    <div className="pad-x start-top-wrap">
      <div className="card start-top">
        <div className="row-grow">
          <div className="eyebrow">A Place to Begin</div>
          <div className="start-top-name">{pick.task.data.text}</div>
          <div className="facts">
            <span className="fact">{line}</span>
          </div>
        </div>
        <button className="btn btn-primary start-top-go" onClick={() => onStart(pick.task.id)}>
          {pick.resuming ? "Resume" : "Start"}
        </button>
      </div>
    </div>
  );
}
