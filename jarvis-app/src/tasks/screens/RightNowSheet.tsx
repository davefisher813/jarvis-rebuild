import { createPortal } from "react-dom";
import { rightNowLine, endOf, type RightNow } from "../rightNow";
import { OVERWHELM_ENTER } from "../overwhelmed";
import { fmtTime } from "../../schedule/calendar";

// WHAT NOW. One thing, two ways out, no list.
//
// The sheet exists rather than the button acting silently because he has to
// SEE what he is agreeing to; a task that just started with no name attached
// is the app deciding for him. But it is deliberately not a picker: offering
// three would reintroduce the decision this button exists to remove.
//
// JUST THIS ONE LIVES HERE (Fewer Buttons, Dave 2026-09-02: "Pick One
// alone; Just This One lives inside it"). It used to be a second button
// beside Pick One on the Tasks page, and the two were one question with two
// answers: both rank with theOneThing, one shows the answer in this sheet,
// the other collapses the list to it. So the list version is an action on
// this sheet now: the same pick, shown in the list with everything else
// hidden (a view, never a write; one tap brings it all back).
export default function RightNowSheet({
  pick,
  onStart,
  onOther,
  onJustThisOne,
  onCancel,
}: {
  pick: RightNow;
  onStart: () => void;
  onOther: () => void;
  onJustThisOne?: () => void;
  onCancel: () => void;
}) {
  // 12-hour, like every clock in the app (seen as "Until 19:14" on the
  // 2026-09-02 walk; endOf speaks the stored HH:MM).
  const until = fmtTime(endOf(pick.startHHMM, pick.minutes));
  return createPortal(
    <div className="sheet-scrim" onClick={onCancel}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="grp"><div className="eyebrow">Do This</div></div>
        <div className="pad-x sheet-form">
          <div className="rn-title">{pick.task.data.text}</div>
          <div className="rn-sub">{rightNowLine(pick)} · Until {until.time} {until.ap}</div>
        </div>
        <div className="pad-x sheet-actions">
          <button className="btn btn-primary btn-block btn-lg" onClick={onStart}>Just Fifteen</button>
          {/* The same thing, in the list, with the rest of the list gone. */}
          {onJustThisOne && <button className="btn btn-secondary btn-block" onClick={onJustThisOne}>{OVERWHELM_ENTER}</button>}
          {/* Not a list: one alternative, which is a different thing entirely. */}
          <button className="btn btn-block" onClick={onOther}>Something Else</button>
          <button className="btn btn-block" onClick={onCancel}>Not Now</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
