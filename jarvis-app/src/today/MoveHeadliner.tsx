// YOUR MOVE IS A ROW IN THE STREAM (Dave 2026-09-16, photographed: "There's
// no need for this massive first task. It's not like it's not important than
// the rest so why are we doing that?" -- then, off a rendered comparison of
// four, "Option 3 but 'today' should be a chip").
//
// THE ROW HAS NO BUTTON ON IT (Dave 2026-10-05, locked: "Clean rows, no pills
// anywhere"). The Start Now capsule that sat in the trailing slot is gone, and
// so is the Done capsule that replaced it while a block runs. The row is the
// notice row's own markup (.notice-swipe, the .notice-card-row that moves, the
// 44px lead, .conn-name, .conn-meta) with nothing in its trailing slot, and
// every verb it had is a gesture:
//
//   swipe left   the ONE quickest action for the state the task is in:
//                ready to work -> Start Now; a block running on it -> Wrap Up.
//                The second tray button keeps what already lived there
//                (Tomorrow before a block; Stop, or Another 15 once it is up),
//                because a block you cannot stop is a trap.
//   swipe right  Done, the same rail every task row answers to.
//   tap          opens the task, whose sheet holds every other action.
//   its moment   a task that is LATE, or a block that is UP, quietly shows its
//                one action on the row as text (RowCtxAction), the same verb
//                as the swipe. Anything not yet late stays clean.
//
// THE CHIP SAYS THE DISTANCE. It is the app's own .uchip, the same one the task
// rows further down this page wear, with the same words from the same producer
// (distanceFor): TODAY in amber, "2 DAYS LATE" in red, and nothing at all for a
// task due tomorrow or later, which is what keeps it loud.
//
// THIS FILE ALSO HOLDS THE SHELL EVERY SWIPEABLE ROW ON TODAY WEARS
// (SwipeShell below). The swipe laws are rostered by file, and one shell for
// every Today row is one place the gesture is wired, the teaching peek runs and
// a right swipe teaches the tip, instead of five copies of it.
import { Check } from "../shared/icons";
import { useSwipe } from "../shared/useSwipe";
import { useRowMenu } from "../shared/useRowMenu";
import type { RowAction } from "../shared/RowActionSheet";
import { noteSwiped } from "../shared/swipeTeach";
import RowCtxAction from "../shared/RowCtxAction";
import { usePeekOnce } from "./usePeekOnce";
import type { ReactNode } from "react";
import type { StateWord } from "../schedule/stateWord";

/** One verb in a row's swipe tray. The first in the list is the quickest one and sits where the finger lands first. */
export interface TrayAction {
  label: string;
  run: () => void;
  /** Goes last in the held row's menu, drawn in the destructive ink (Delete, Remove). */
  destructive?: boolean;
}

// THE SHELL OF A TODAY ROW THAT SWIPES. The tray (a green Done rail on the right, the accent verbs on the left), the
// moving surface, the one gesture controller, and the one-time peek. `className` is what the moving surface adds to
// .notice-card, which is where touch-action: pan-y lives.
export function SwipeShell({ actions = [], onRight, rightLabel = "Done", menu, menuTitle, className = "", children }: {
  /** Quickest first. Each is 88px of reveal. */
  actions?: TrayAction[];
  /** Swipe right completes. Absent, the row cannot move right. */
  onRight?: () => void;
  rightLabel?: string;
  /** THE HELD ROW'S MENU (Dave 2026-10-05: long press is the context menu, never the only way to anything). Absent, it is
   *  the tray's verbs in order (the quickest first) and then the right swipe's, destructive last: the same actions, drawn as
   *  a list. A caller passes its own only to list more than the gestures do. */
  menu?: RowAction[];
  /** What the menu is about, when the row is a record with a name. */
  menuTitle?: string;
  className?: string;
  children: ReactNode;
}) {
  const lines: RowAction[] = menu ?? [
    ...actions.map((a) => ({ label: a.label, onPick: a.run, ...(a.destructive ? { destructive: true } : {}) })),
    ...(onRight && !actions.some((a) => a.label === rightLabel) ? [{ label: rightLabel, onPick: onRight }] : []),
  ].sort((a, b) => Number(!!a.destructive) - Number(!!b.destructive));
  const swipeable = actions.length > 0 || !!onRight;
  const rowMenu = useRowMenu({ title: menuTitle ?? "", actions: lines, swipeEnabled: swipeable });
  const swipe = useSwipe({
    revealW: actions.length * 88,
    rightW: onRight ? 88 : 0,
    // A right swipe is a swipe: it teaches the tip away like a left one does (shared/useSwipe only notes the left).
    ...(onRight ? { onRightCommit: () => { noteSwiped(); onRight(); } } : {}),
    enabled: swipeable,
    onLongPress: rowMenu.onLongPress,
  });
  const { handlers, sheet } = rowMenu.bind(swipe);
  usePeekOnce(swipe.peek, actions.length > 0);
  return (
    // Tabbing into a revealed button opens the rail around it, so a keyboard or switch user is never pressing a control
    // parked underneath the row.
    <div className="notice-swipe" onFocus={swipe.revealFocus}>
      {onRight && (
        <div className="task-done-rail" aria-hidden="true">
          <Check className="ic" />
          <span className="swipe-label">{rightLabel}</span>
        </div>
      )}
      {actions.map((a, i) => (
        <button
          key={a.label}
          type="button"
          className="notice-alt"
          data-reveal
          style={i ? { right: i * 88 } : undefined}
          onClick={() => swipe.closeThen(a.run)}
        >{a.label}</button>
      ))}
      <div
        className={"notice-card " + className + (swipe.dragging ? " swiping" : "")}
        style={{ transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined }}
        {...handlers}
      >
        {children}
      </div>
      {sheet}
    </div>
  );
}

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
   *  it. Wrap Up ticks the task off from here; Stop ends the block early and
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
  // THE QUICKEST VERB, structurally rather than by exemption: the thing to do
  // right now. Before the block that is Start; while it runs it is Wrap Up,
  // because the task is already started and the only thing left to say about
  // it is that it is finished. One verb at the edge of the tray, so the row
  // never holds two competing for the same place.
  const primary = onDone
    ? { label: "Wrap Up", run: onDone }
    : onStart
      ? { label: "Start Now", run: onStart }
      : null;
  // The caller passes exactly one alt (Tomorrow before a block; Stop or
  // Another 15 while one runs); it sits one slot in from the primary.
  const actions: TrayAction[] = [
    ...(primary ? [primary] : []),
    ...(onTomorrow ? [{ label: "Tomorrow", run: onTomorrow }] : []),
    ...(onAgain ? [{ label: "Another 15", run: onAgain }] : []),
    ...(onStop ? [{ label: "Stop", run: onStop }] : []),
  ];
  // ITS MOMENT HAS COME (spec section 3): late, or a block that is up. Never before.
  const due = facts.urgency?.kind === "late" || !!facts.over;
  return (
    <div className="pad-x hl">
      <SwipeShell
        actions={actions}
        menuTitle={title}
        {...(onToggle ? { onRight: onToggle } : {})}
        className="card notice-card-row notice-card-uniform"
      >
        {/* THE WHOLE ROW IS THE DOOR (Dave 2026-09-15, photographed: "How is
            the first thing that renders on the app not clickable?"). The
            check stops its own tap so it keeps its verb. */}
        <div
          className="row"
          role={onOpen ? "button" : undefined}
          tabIndex={onOpen ? 0 : undefined}
          aria-label={onOpen ? "Open " + title : undefined}
          onClick={onOpen}
          onKeyDown={onOpen ? (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } } : undefined}
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
                175px beside the action column, and a chip spends 80 of
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
                  there"). The placement fact (Fits before Deep Work) is real
                  and stays, in the same ink as every other fact on every
                  other row.
                  §AM (2026-09-26): the two slots that DO carry a meaning
                  wear the Colour Key's ink for it, and only one of them
                  can render. A block that is up (15 Minutes up) needs him
                  now, which is amber, the same fact Focus draws amber.
                  The length is the task's estimate or its area's learned
                  median, an estimate the app worked out, which is sky:
                  .fact.est, the ink the task rows' estimate already wears.
                  No length beside a late chip (2026-09-26): "2 DAYS LATE"
                  fills the line at type scale 1.4, and the length after it
                  was left its dot and an ellipsis. */}
              {facts.reason
                ? <span className={"fact" + (facts.over ? " warn" : "")}>{facts.reason}</span>
                : facts.estimate && facts.urgency?.kind !== "late" ? <span className="fact est">{facts.estimate}</span> : null}
            </div>
          </div>
          {/* The one quiet verb, only while the moment has come. The same
              action as the swipe, so the row has one verb. */}
          {primary && (
            <RowCtxAction when={due} label={primary.label} onAct={primary.run} />
          )}
        </div>
      </SwipeShell>
    </div>
  );
}
