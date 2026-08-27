import { ateBeforeCountLine, type AteBeforeMark } from "../timelines";

export interface AteBeforeCandidate {
  eventId: string;
  eventTitle: string;
  date: string;
}

// ATE BEFORE (Part 3). Attached to a calendar practice or game. One tap,
// yes or no, three seconds. No food, no amount, no quality judgment: the
// only question this screen ever asks is the one in its name.
export default function AteBeforeScreen({
  candidates, answered, marks, onMark, onBack,
}: {
  // Today's practice/game events that can still be answered.
  candidates: AteBeforeCandidate[];
  // Which of today's candidates already have an answer, and what it was.
  answered: Record<string, boolean>;
  marks: AteBeforeMark[];
  onMark: (candidate: AteBeforeCandidate, ate: boolean) => void;
  onBack: () => void;
}) {
  const open = candidates.filter((c) => !(c.eventId in answered));

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">Ate Before</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">Did You Eat First</div>
        <div className="bp-sub">Yes or no. Nothing about what, how much, or whether it was good.</div>
      </div></div>

      {open.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">Nothing Left To Answer</div>
          <div className="empty-sub">A new practice or game on the calendar will show up here</div>
        </div>
      ) : (
        <div className="pad-x"><div className="card">
          {open.map((c) => (
            <div className="row" key={c.eventId}>
              <div className="row-grow"><div className="conn-name truncate">{c.eventTitle}</div></div>
              <div className="ate-before-answer">
                <button className="btn btn-secondary" onClick={() => onMark(c, false)}>No</button>
                <button className="btn btn-primary" onClick={() => onMark(c, true)}>Yes</button>
              </div>
            </div>
          ))}
        </div></div>
      )}

      {marks.length > 0 && (
        <>
          <div className="sec-head"><div className="sec-left"><div className="sec-title">The Timeline</div></div></div>
          <div className="pad-x">
            {/* Marks on a timeline, never a fraction: catalog Part 3 bans
                rendering this as "2 of 6". */}
            <div className="eaten-timeline">
              {marks.map((m, i) => (
                <span key={i} className={"eaten-dot " + (m.ate ? "eaten-dot-yes" : "eaten-dot-no")} title={m.date} />
              ))}
            </div>
            <div className="bp-sub">{ateBeforeCountLine(marks)}</div>
          </div>
        </>
      )}

      <div className="screen-foot" />
    </div>
  );
}
