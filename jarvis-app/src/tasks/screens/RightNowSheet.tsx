import { createPortal } from "react-dom";
import { rightNowLine, endOf, type RightNow } from "../rightNow";

// WHAT NOW. One thing, two ways out, no list.
//
// The sheet exists rather than the button acting silently because he has to
// SEE what he is agreeing to; a task that just started with no name attached
// is the app deciding for him. But it is deliberately not a picker: offering
// three would reintroduce the decision this button exists to remove.
export default function RightNowSheet({
  pick,
  onStart,
  onOther,
  onCancel,
}: {
  pick: RightNow;
  onStart: () => void;
  onOther: () => void;
  onCancel: () => void;
}) {
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Do This</div></div>
        <div className="pad-x sheet-form">
          <div className="rn-title">{pick.task.data.text}</div>
          <div className="rn-sub">{rightNowLine(pick)} · Until {endOf(pick.startHHMM, pick.minutes)}</div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block btn-lg" onClick={onStart}>Just Fifteen</button>
          {/* Not a list: one alternative, which is a different thing entirely. */}
          <button className="btn btn-block" onClick={onOther}>Something Else</button>
          <button className="btn btn-block" onClick={onCancel}>Not Now</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
