// YOUR MOVE IS A ROW IN THE STREAM (Dave 2026-09-16, photographed: "There's
// no need for this massive first task. It's not like it's not important than
// the rest so why are we doing that?" -- then, off a rendered comparison of
// four, "Option 3 but 'today' should be a chip").
//
// C-24 promoted the dealt task: 18px semibold over two lines, a facts line of
// its own and a full-width button line, on top of notices that are one 16px
// line each. Measured at iPhone width that was 125px over 58px rows. The
// premise was "the thing he is meant to do next is the loudest thing on the
// page", and he has rejected it: the ranker's pick is the app's guess, the
// notices under it are facts, and drawing the guess at twice the size says
// the app is more certain than it is.
//
// THE UNIFORM IS KEPT BY CONSTRUCTION, NOT BY RESEMBLANCE. The first attempt
// at this restyled a bespoke anatomy to look like a stream row and missed the
// rule that actually governs the card: ONE ACTION COLUMN (ruled.css) -- every
// control in this stream is a .pill-act, 100px minimum, at one height. A 30px
// capsule plus a red-tinted chip on a second line broke it three ways at
// once. So this renders the notice row's own markup: .notice-swipe, the
// .notice-card-row it moves, the 44px lead, .conn-name, .conn-meta and one
// .pill-act in the trailing slot. The only things that differ from the rows
// under it are what sits in the lead column (a check, because this is a task)
// and the fill on the pill (Start is the verb, and it keeps the accent).
//
// THE CHIP SAYS THE DISTANCE. It is the app's own .uchip, the same one the
// task rows further down this page wear, with the same words from the same
// producer (distanceFor): TODAY in amber, "2 DAYS LATE" in red, and nothing
// at all for a task due tomorrow or later, which is what keeps it loud.
//
// THE SECOND VERB IS ON THE SWIPE. Every row in this stream keeps its second
// action there already, so Tomorrow (and Stop, and Another 15) is not a new
// gesture to learn -- and the useSwipe controller carries a long press and a
// context menu with it, for the inputs that have no finger.
import { Check } from "../shared/icons";
import { useSwipe } from "../shared/useSwipe";
import type { StateWord } from "../schedule/stateWord";

export interface MoveFacts {
  /** The urgency CHIP: distanceFor's own words and kind, so this row says the
   *  distance in the same voice as every other task row in the app. Null when
   *  nothing is due, which is when no chip renders at all. */
  urgency?: { label: string; kind: "today" | "late" } | null;
  /** The area, drawn as its 7px dot plus plain text (G4). */
  category?: { name: string; slot: string } | null;
  /** "20m", from the task's own estimate or its area's usual. */
  estimate?: string | null;
  /** One reason fragment: why THIS one, now. "Fits before Deep Work". */
  reason?: string | null;
  /** The running block is up: the reason slot holds "15 Minutes up", which
   *  needs him now, so it wears the key's amber, the same fact the Focus
   *  screen already draws amber for the same block. */
  over?: boolean;
  /** The state of the block it would land in, when it has a home. */
  state?: StateWord | null;
}

// EVERY VERB ON THIS ROW CHANGES THE DAY (Dave 2026-09-16: "I still haven't
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
  /** THE FIFTEEN, WHILE IT RUNS (2026-09-16). When a block is running on this
   *  task, Start and Tomorrow stand down and these take their place: the
   *  clock is already in `facts.reason`, and the verbs are what to do about
   *  it. Done ticks the task off from here; Stop ends the block early and
   *  trims it on the calendar to the minutes he actually sat; Another 15 buys
   *  the next fifteen. The caller passes Stop while it runs and Another 15
   *  once it is up, so there are never three. */
  onDone?: () => void;
  onAgain?: () => void;
  onStop?: () => void;
  /** Tick it off from here.
   *
   *  THE ONE PLACE THIS DEPARTS FROM THE NOTICE ROWS (2026-09-12). Their lead
   *  column is a coloured disc; this one is the task check, because the dealt
   *  row was the only completion control on the whole daytime page and a row
   *  without one would mean a task cannot be ticked off from Today at all.
   *  Same 44px column, same anatomy as every task row in the app. */
  onToggle?: () => void;
  onOpen?: () => void;
}) {
  // ONE PRIMARY VERB, structurally rather than by exemption: the thing to do
  // right now. Before the block that is Start; while it runs it is Done,
  // because the task is already started and the only thing left to say about
  // it is that it is finished. Two <button> elements here would be two verbs
  // competing for one action column even though only one can ever render, so
  // it is one button that knows which verb it is.
  const primary = onDone
    ? { label: "Done", run: onDone }
    : onStart
      ? { label: "Start Now", run: onStart }
      : null;
  // The caller passes exactly one alt (Tomorrow before a block; Stop or
  // Another 15 while one runs), so the LEFT reveal is always one 88px slot
  // and whichever alt renders sits at its right edge.
  //
  // AND SWIPE RIGHT COMPLETES (UP-CORE-15's rule: "swipe right completes /
  // left defers on EVERY list"). This row can be finished -- it is a task,
  // not a notice -- so it answers the same gesture as every other task row in
  // the app, with the same rail behind it. A running block passes no toggle
  // and the right half of the gesture simply is not armed.
  const hasAlt = !!(onTomorrow || onAgain || onStop);
  const swipe = useSwipe({
    revealW: hasAlt ? 88 : 0,
    rightW: onToggle ? 88 : 0,
    ...(onToggle ? { onRightCommit: onToggle } : {}),
    enabled: hasAlt || !!onToggle,
  });
  return (
    <div className="pad-x hl">
      {/* Tabbing into the revealed button opens the rail around it, so a
          keyboard or switch user is never pressing a control parked
          underneath the row. Same wiring NoticeCard uses. */}
      <div className="notice-swipe" onFocus={swipe.revealFocus}>
        {onToggle && (
          <div className="task-done-rail" aria-hidden="true">
            <Check className="ic" />
            <span className="swipe-label">Done</span>
          </div>
        )}
        {/* A block you cannot stop is a trap. Stopping trims the event to the
            minutes he actually sat, so the day does not keep a full fifteen
            he did not take. */}
        {onAgain && (
          <button className="notice-alt" data-reveal onClick={() => swipe.closeThen(onAgain)}>Another 15</button>
        )}
        {onStop && (
          <button className="notice-alt" data-reveal onClick={() => swipe.closeThen(onStop)}>Stop</button>
        )}
        {/* The honest answer to "not tonight". It does not re-rank, snooze or
            hide anything: it books the task into a real open slot tomorrow
            and the toast says which one, so the answer to "when, then?" is on
            screen instead of implied. */}
        {onTomorrow && <button className="notice-alt" data-reveal onClick={() => swipe.closeThen(onTomorrow)}>Tomorrow</button>}
        <div
          className={"card notice-card notice-card-row notice-card-uniform" + (swipe.dragging ? " swiping" : "")}
          style={{ transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined }}
          {...swipe.handlers}
        >
          {/* THE WHOLE ROW IS THE DOOR (Dave 2026-09-15, photographed: "How is
              the first thing that renders on the app not clickable?"). The
              check and the pill each stop the tap so they keep their verbs. */}
          <div
            className="row"
            role={onOpen ? "button" : undefined}
            tabIndex={onOpen ? 0 : undefined}
            aria-label={onOpen ? "Open " + title : undefined}
            onClick={onOpen}
            onKeyDown={onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } } : undefined}
          >
            {/* The column is reserved whether or not there is a check in it,
                so the words line up with the rows below on a page that mounts
                this without a toggle, which is what the running block does. */}
            {onToggle ? (
              <div className="task-check-tap" role="checkbox" aria-checked={false} aria-label="Mark done" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
                <div className="task-check" />
              </div>
            ) : (
              <div className="task-check-tap" />
            )}
            <div className="row-grow">
              <div className="conn-name hl-title">{title}</div>
              {/* TWO SLOTS, NOT FOUR (2026-09-16, measured: the sub has about
                  175px beside a 100px action column, and a chip spends 80 of
                  them). The old facts line listed urgency, area, length and
                  placement, which on this row printed "2 DAYS LATE · Persc"
                  with the rest cut away behind the pill -- four facts, none of
                  them readable. So the line carries at most two, and each slot
                  falls back rather than going empty:
                    WHEN   the chip if there is one, else the area it lives in
                    WHY    the placement if there is one, else how long it takes
                  That is the same pair the task rows on this page print on
                  their own kicker line (TaskRow's .r-k), and it reproduces the
                  "TODAY · 45 min" Dave photographed exactly. */}
              <div className="conn-meta facts">
                {/* At most one coloured FACT per line is the law (K.3,
                    extended in laws/astra.test.ts). The chip is not a fact and
                    carries its own tint by rule; the second slot below is the
                    line's one coloured fact at most. */}
                {facts.urgency ? (
                  <span className="fact">
                    <span className={"uchip " + (facts.urgency.kind === "late" ? "u-late" : "u-today")}>{facts.urgency.label}</span>
                  </span>
                ) : facts.category ? (
                  <span className="fact cat"><span className={"cd cat-bg-" + facts.category.slot} />{facts.category.name}</span>
                ) : null}
                {/* NO LINEAGE ON THIS LINE (Dave 2026-09-21: "get rid of the
                    blue subtext in pic 1 idk what that is or why it's
                    there"). It was .fact.sky printing "Moves <goal>", lineage
                    the title cannot say and the reader cannot use. The
                    placement fact ("Fits before Deep Work") is real and
                    stays, in the same ink as every other fact on every
                    other row.
                    §AM (2026-09-26): the two slots that DO carry a meaning
                    wear the Colour Key's ink for it, and only one of them
                    can render. A block that is up ("15 Minutes up") needs
                    him now, which is amber, the same fact Focus draws amber.
                    The length is the task's estimate or its area's learned
                    median, an estimate the app worked out, which is sky:
                    .fact.est, the ink the task rows' estimate already wears. */}
                {facts.reason
                  ? <span className={"fact" + (facts.over ? " warn" : "")}>{facts.reason}</span>
                  : facts.estimate ? <span className="fact est">{facts.estimate}</span> : null}
              </div>
            </div>
            {primary && (
              <button type="button" className="pill-act pill-go" onClick={(e) => { e.stopPropagation(); primary.run(); }}>
                {primary.label}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
