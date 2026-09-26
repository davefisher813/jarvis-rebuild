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

// The reason wears its meaning (Colour Key, 2026-09-22): late is red, due
// today or tomorrow is amber, a later due day is a neutral date in small caps.
// startReason's words are a closed set, so they can be read back here.
function reasonClass(why: string): string {
  if (/ late$/.test(why)) return "fact red";
  if (/^Due (today|in 1 day)$/.test(why)) return "fact warn";
  if (/^Due in /.test(why)) return "fact date";
  return "fact";
}

export default function StartCard({ pick, action, reason, onStart }: StartCardProps) {
  // TWO FACTS, AND CSS DRAWS THE DOT BETWEEN THEM (2026-09-26). It was one
  // grey span with a typed middle dot, so a late reason sat in the same grey
  // as what is ready. Now the reason takes its key colour and what is ready
  // is the row's one grey; the ready fact keeps a floor in components.css so
  // the drawn dot never dangles on a narrow row. Resuming says nothing
  // here: the Resume button already says he was working on it.
  const why = pick.resuming ? "" : reason;
  return (
    <div className="pad-x start-top-wrap">
      <div className="card start-top">
        <div className="row-grow">
          <div className="eyebrow">A Place to Begin</div>
          <div className="start-top-name">{pick.task.data.text}</div>
          <div className="facts">
            {why && <span className={reasonClass(why)}>{why}</span>}
            {action.ready && <span className="fact">{action.ready}</span>}
          </div>
        </div>
        <button className="btn btn-primary start-top-go" onClick={() => onStart(pick.task.id)}>
          {pick.resuming ? "Resume" : "Start"}
        </button>
      </div>
    </div>
  );
}
