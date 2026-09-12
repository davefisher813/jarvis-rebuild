// YOUR MOVE HAS A HEADLINER AGAIN (C-24, Astra pass, Dave's picks
// 2026-09-12, against the approved harness).
//
// The dealt task used to ride the stream as one uniform row among the
// notices, which is the shape Combine B settled on in August: the page asked
// one question and every answer wore the same clothes. The Astra pass takes
// that back for the ONE task, and only that one: the thing he is meant to do
// next is the loudest thing on the page, it says why it was chosen on its own
// facts line, and the two runners-up fold into a row under it instead of
// competing with it.
//
// The notices keep the stream and keep their uniform. Nothing else is
// promoted; a second headliner would be the pinned card coming back.
import type { StateWord } from "../schedule/stateWord";

export interface MoveFacts {
  /** "Due Today" / "Waiting 3 days", warn. Null when the task has no date. */
  urgency?: string | null;
  /** The area, drawn as its 7px dot plus plain text (G4). */
  category?: { name: string; slot: string } | null;
  /** "20m", from the task's own estimate or its area's usual. */
  estimate?: string | null;
  /** One reason fragment, sky: why THIS one, now. "Fits before Deep Work". */
  reason?: string | null;
  /** The state of the block it would land in, when it has a home. */
  state?: StateWord | null;
}

export default function MoveHeadliner({
  title, facts, onStart, onWhy, onToggle, otherCount, onOther, onOpen,
}: {
  title: string;
  facts: MoveFacts;
  onStart?: () => void;
  onWhy?: () => void;
  /** Tick it off from here.
   *
   *  THE ONE PLACE THIS DEPARTS FROM THE HARNESS (2026-09-12). The approved
   *  headliner carries Start and Why and no ring. But the dealt row was the
   *  only completion control on the whole daytime page, so a headliner
   *  without one would mean a task cannot be ticked off from Today at all,
   *  and the momentum chain that fills the slot behind it would be
   *  unreachable. That is a function the mock was not deciding about, so
   *  the ring stays, in the same 24px anatomy every task row uses. */
  onToggle?: () => void;
  /** How many ranked tasks are behind this one. The row is silent at zero. */
  otherCount: number;
  onOther?: () => void;
  onOpen?: () => void;
}) {
  return (
    <>
      {/* ONE LEFT EDGE (Dave 2026-09-12, photographed: "The 'text Shawna'
          is a real eye sore... It's the first thing a user sees"). The first
          cut put the ring and the title on one line and let the facts and
          the buttons fall out under BOTH of them, so the card had three left
          edges: the facts at the card's edge, the buttons at a notice row's
          inset, the title beside the ring. It is the task-row anatomy now,
          the same one every row under it uses: a 44px ring column, then one
          text column that holds the title, the facts and the verbs, all
          starting at the card's shared text edge. The ring column is always
          reserved so the words line up with the rows below even on a page
          that mounts this without a toggle. */}
      <div className="hl">
        <div className="hl-lead">
          {onToggle && (
            <div className="task-check-tap" role="checkbox" aria-checked={false} aria-label="Mark done" onClick={onToggle}>
              <div className="task-check" />
            </div>
          )}
        </div>
        <div className="hl-body">
          {/* The title is the door, the same contract every task row on this
              page keeps: the words open the task, the pill is the verb. */}
          <div className="hl-title" role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen}>{title}</div>
          <div className="facts">
            {/* At most one coloured fact per line is the law (K.3, extended in
                laws/astra.test.ts). Urgency is the one that gets the colour
                when it exists, because a date is the fact that changes what he
                does; the reason takes sky only when there is no urgency to
                say. The area and the state word carry their own colour by
                rule and do not count. */}
            {facts.urgency && <span className="fact warn">{facts.urgency}</span>}
            {facts.category && (
              <span className="fact cat"><span className={"cd cat-bg-" + facts.category.slot} />{facts.category.name}</span>
            )}
            {facts.estimate && <span className="fact">{facts.estimate}</span>}
            {facts.reason && <span className={"fact" + (facts.urgency ? "" : " sky")}>{facts.reason}</span>}
          </div>
          <div className="hl-acts">
            {onStart && <button type="button" className="btn btn-primary btn-sm" onClick={onStart}>Start</button>}
            {/* The Why chip is the same anatomy as the mail evidence chip: a
                claim you can open to see the working behind it. */}
            {onWhy && <button type="button" className="why" onClick={onWhy}>Why</button>}
          </div>
        </div>
      </div>
      {otherCount > 0 && onOther && (
        <div className="row hl-other" role="button" tabIndex={0} onClick={onOther}>
          <div className="row-stack">
            <div className="conn-name">Other Good Choices</div>
          </div>
          <span className="r-count">{otherCount} more</span>
          <span className="chev" aria-hidden="true" />
        </div>
      )}
    </>
  );
}
