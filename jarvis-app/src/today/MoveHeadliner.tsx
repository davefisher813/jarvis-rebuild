// YOUR MOVE IS A NORMAL ROW (Dave 2026-09-16, photographed: "There's no need
// for this massive first task. It's not like it's not important than the rest
// so why are we doing that?" -- then, on the first cut: "make the dealt task a
// normal row in the stream").
//
// C-24 promoted the dealt task to a headliner: 18px semibold over two lines, a
// facts line of its own, and a full-width button line, sitting on top of
// notices that are one 16px line each. Measured, that was 125px over 58px
// rows. The premise was "the thing he is meant to do next is the loudest thing
// on the page", and he has rejected it: the ranker's pick is the app's guess,
// the notices under it are facts, and drawing the guess at three times the
// size tells him the app is more certain than it is.
//
// So this is a row in the stream's own uniform now, and the uniform is not
// negotiable: the same 44px lead column, the task row's exact type on the
// title (16px, --w-regular, -0.01em, one line -- see CLAUDE.md, where the
// reminders rows take the same numbers for the same reason), the facts as the
// row's quiet sub, and the verbs as capsules in the trailing slot every other
// row keeps its control in. Nothing on this page is promoted now.
//
// The verbs stay, all of them. They were added two days ago for a reason that
// has not gone away ("I still haven't clicked a button and it helped me in any
// single way on this home page"); what changed is their volume, not their
// existence.
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

// EVERY VERB ON THIS CARD CHANGES THE DAY (Dave 2026-09-16: "I still haven't
// clicked a button and it helped me in any single way on this home page. They
// all SUCK... if not, just don't put a button").
//
// Why and Other Good Choices are gone. Both acted on the app's own model
// rather than on his evening: Why explained a ranking he never asked about and
// offered to re-deal it, and Other Good Choices opened a second list beside
// the one already on screen. A good ranking does not need explaining and a bad
// one is not fixed by explaining it. What is left is Start, which commits real
// minutes, and Tomorrow, which moves the task to a real slot and names it.
export default function MoveHeadliner({
  title, facts, onStart, onTomorrow, onDone, onAgain, onStop, onToggle, onOpen,
}: {
  title: string;
  facts: MoveFacts;
  onStart?: () => void;
  /** Move it to a named open slot tomorrow. Says which one on the toast. */
  onTomorrow?: () => void;
  /** THE FIFTEEN, WHILE IT RUNS (2026-09-16). When a block is running on
   *  this task, Start and Tomorrow stand down and these take the line: the
   *  clock is already in `facts.reason`, and the verbs are what to do about
   *  it. Done ticks the task off from here; Stop ends the block early and
   *  trims it on the calendar to the minutes he actually sat; Another 15
   *  buys the next fifteen. The caller passes Stop while it runs and Another
   *  15 once it is up, so there are never three. */
  onDone?: () => void;
  onAgain?: () => void;
  onStop?: () => void;
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
  onOpen?: () => void;
}) {
  const primary = onDone
    ? { label: "Done", run: onDone }
    : onStart
      ? { label: "Start", run: onStart }
      : null;
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
      {/* THE WHOLE CARD IS THE DOOR (Dave 2026-09-15, photographed: "How is
          the first thing that renders on the app not clickable?"). Only the
          title answered a tap, so the facts line, the gaps and the space
          beside Start were dead. The card opens the task now; the ring, Start
          and Why each stop the tap so they keep their own verbs. */}
      <div
        className="hl"
        role={onOpen ? "button" : undefined}
        tabIndex={onOpen ? 0 : undefined}
        aria-label={onOpen ? "Open " + title : undefined}
        onClick={onOpen}
        onKeyDown={onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } } : undefined}
      >
        <div className="hl-lead">
          {onToggle && (
            <div className="task-check-tap" role="checkbox" aria-checked={false} aria-label="Mark done" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
              <div className="task-check" />
            </div>
          )}
        </div>
        <div className="hl-body">
          {/* THE TITLE GETS THE WHOLE LINE. The first cut at this row put the
              verbs beside it, and two capsules took 147px of a 273px line:
              "Get back to davefisher813: [davefisher813/jarvis-rebuild] Run
              failed" became "Get back to ...", which is a row that has stopped
              saying what it is about. The verbs drop to the sub line instead,
              where the facts are short enough to leave them room. */}
          <div className="hl-title">{title}</div>
          <div className="hl-line">
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
              {/* ONE PRIMARY VERB, structurally rather than by exemption: the
                  thing to do right now. Before the block that is Start; while
                  it runs it is Done, because the task is already started and
                  the only thing left to say about it is that it is finished.
                  Two <button> elements here would be two filled reds in one
                  file (laws.test.ts) even though only one can ever render, so
                  it is one button that knows which verb it is. */}
              {primary && (
                <button type="button" className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); primary.run(); }}>
                  {primary.label}
                </button>
              )}
              {onAgain && <button type="button" className="why" onClick={(e) => { e.stopPropagation(); onAgain(); }}>Another 15</button>}
              {/* A block you cannot stop is a trap. Stopping trims the event to
                  the minutes he actually sat, so the day does not keep a full
                  fifteen he did not take. */}
              {onStop && <button type="button" className="why" onClick={(e) => { e.stopPropagation(); onStop(); }}>Stop</button>}
              {/* The honest answer to "not tonight". It does not re-rank, snooze
                  or hide anything: it books the task into a real open slot
                  tomorrow and the toast says which one, so the answer to "when,
                  then?" is on screen instead of implied. */}
              {onTomorrow && <button type="button" className="why" onClick={(e) => { e.stopPropagation(); onTomorrow(); }}>Tomorrow</button>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
