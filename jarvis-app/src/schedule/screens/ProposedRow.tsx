import { useRef } from "react";
import { catColor } from "../../shared/categories";
import { useChipInView } from "../../shared/useChipInView";
import { useSwipe } from "../../shared/useSwipe";
import { pressable } from "../../shared/pressable";
import { titleCase } from "../../shared/casing";
import { Check } from "../../shared/icons";
import type { RowAction } from "../../shared/RowActionSheet";
import { fmtTime } from "../calendar";
import type { PlanBlock } from "../planDay";
import { DUR_CHOICES, durLabel, minutesBetween } from "../durations";
import { spanLabel } from "../../shared/duration";
import { SCHED_ACT_W } from "./schedRail";
import { useRowMenu } from "../../shared/useRowMenu";
import { useLongPress } from "../../shared/useLongPress";

// THE PROPOSED BLOCK (blend, 2026-08-22).
//
// Dave: "I want it showing in the schedule form already... what's the point of
// having two different schedule formats on the home page?" He was right, and
// the drafted card was the wrong half to keep. A proposed block is a row of
// the day like any other; what it must never do is pass for a committed one.
//
// It says so with the vocabulary the app already has for "not real yet":
// .sched-gap draws open time with a dashed rule, so the category bar goes
// HOLLOW and dashed in the category's own color. No new color, no opacity
// trick (a dimmed row reads as past, which is the opposite of what this is),
// and the difference survives at a glance from arm's length.
//
// One component, used by Today and by the Schedule tab, so the two cannot
// drift into a third format the way the card and the day list did.

// B5 (2026-08-23): the duration list moved to schedule/durations.ts, because
// PlanDaySheet had declared its own identical copy and DayRow now needs the
// same one. Re-exported so existing importers keep working.
export { DUR_CHOICES } from "../durations";

export const blockMinutes = (b: PlanBlock): number => minutesBetween(b.start, b.end);

export default function ProposedRow({
  block,
  nested,
  open,
  onToggle,
  onDuration,
  onDrop,
  onComplete,
  onAccept,
  onOpen,
  plain = false,
}: {
  /** THE HOME SCHEDULE IS THE FINISHED DAY (Dave 2026-10-13): time and title only, no "Proposed" and no length under it. The row is still cleared by
   *  swiping right, and everything it says is in its accessible name and on the Schedule page. */
  plain?: boolean;
  block: PlanBlock;
  /** A TASK UNDER ITS BLOCK (issue #106 V6, Dave 2026-10-13: "Proposed tasks get their own rows, indented under the block they
   *  belong to, instead of tappable rows nested inside the event button"). The Schedule tab passes this for a pick that lies
   *  wholly inside a holding block. It is the same row in every respect (the check, the time column, the title with PROPOSED and
   *  its length under it, the swipe, the menu, the tap); it only wears .sched-nested, which is where one CSS knob
   *  (--sched-nest-indent, ruled.css) sets how far it sits in from the block's edge. Optional: Today passes nothing and draws
   *  what it drew. */
  nested?: boolean;
  open: boolean;
  onToggle: () => void;
  onDuration: (minutes: number) => void;
  onDrop: () => void;
  /** TICK IT OFF (Dave, 2026-09-15). This row could resize the task and send
   *  it back to Anytime and could not say it was done -- so a planned task
   *  you actually finished had to be found somewhere else to be closed.
   *  The ring is the same 24px anatomy every task row in the app uses, in
   *  the lead slot, where the hand already looks for it. It is also the
   *  swipe right, which completes (2026-10-05). Optional, so a caller with
   *  no completion wiring renders exactly as it did. */
  onComplete?: () => void;
  /** BOOK THIS ONE BLOCK (button audit 2026-09-16; Dave: "add it to Today").
   *  The proposed-day type has carried a per-block Accept since C-32 and only
   *  the Schedule tab ever drew one, on its nested held rows. This is the
   *  same verb on the row itself, so a draft can be taken a block at a time
   *  wherever it is shown. It is the swipe left now, and the first line of
   *  the long-press menu (2026-10-05). Optional: a caller that only offers
   *  the whole-day Accept passes nothing and this row is what it was. */
  onAccept?: () => void;
  /** OPEN THE TASK (schedule audit 2026-10-01, item 5). A proposed task
   *  nested under a block opened the full Edit Task sheet; the same task as
   *  a row of its own expanded to duration chips and had no way to open it.
   *  One task, two behaviours by where it happened to sit. The tap answers
   *  the same now (2026-10-05): with the editor wired the row opens the
   *  task's sheet, which holds every action; the length chips are Change
   *  Length in the menu. A caller with no editor keeps the tap that expands
   *  the chips. */
  onOpen?: () => void;
}) {
  const t = fmtTime(block.start);
  const sep = <span className="sched-sep">&middot;</span>;
  const slot = catColor(block.category);
  const mins = blockMinutes(block);
  const title = titleCase(block.text);
  const durs = useRef<HTMLDivElement>(null);
  useChipInView(durs, open);

  // NO PILLS ON THE ROW (Dave 2026-10-05, locked). Book It, Edit Task and Move to Anytime sat in the expanded panel as
  // three capsules. The row's one quickest action is the swipe left (Book It, the affirmative move, leading, with the
  // way back to Anytime beside it), a swipe right ticks it off, and the long press is the menu with all of them again.
  const acts = [!!onAccept, true].filter(Boolean).length;
  const menuActions: RowAction[] = [
    ...(onAccept ? [{ label: "Book It", onPick: onAccept }] : []),
    ...(onComplete ? [{ label: "Done", onPick: onComplete }] : []),
    ...(onOpen ? [{ label: "Edit Task", onPick: onOpen }] : []),
    { label: open ? "Close Length" : "Change Length", onPick: onToggle },
    { label: "Move to Anytime", onPick: onDrop },
  ];
  const rowMenu = useRowMenu({ title, actions: menuActions });
  const swipe = useSwipe({
    revealW: acts * SCHED_ACT_W,
    rightW: onComplete ? SCHED_ACT_W : 0,
    ...(onComplete ? { onRightCommit: onComplete } : {}),
    onLongPress: rowMenu.onLongPress,
  });
  const { dx, open: swipeOpen, dragging, closeThen } = swipe;
  const { handlers: rowHandlers, sheet } = rowMenu.bind(swipe);
  return (
    <div className={"sched-swipe-wrap" + (nested ? " sched-nested" : "")}>
      <div className="sched-strip">
        {onComplete && (
          <div className="task-done-rail" aria-hidden="true">
            <Check className="ic" />
            <span className="swipe-label">Done</span>
          </div>
        )}
        <div className="sched-actions" aria-hidden={!swipeOpen}>
          {onAccept && <button className="sched-act" data-verb tabIndex={swipeOpen ? 0 : -1} aria-label={"Book " + title} onClick={() => closeThen(onAccept)}>Book It</button>}
          <button className="sched-act sched-act-quiet" tabIndex={swipeOpen ? 0 : -1} aria-label={"Move " + title + " to Anytime"} onClick={() => closeThen(onDrop)}>Anytime</button>
        </div>
        <div
          className={"sched-row sched-proposed" + (open ? " open" : "") + (dragging ? " swiping" : "")}
          style={dx ? { transform: `translateX(${dx}px)` } : undefined}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          // THE ROW'S NAME IS ONE WHOLE PHRASE (Alfred's deep audit 2026-10-13: the accessible name read "PROPOSE", losing its last letter to the
          // facts line's clip, with "45 Min" outside the button). Said once from the facts themselves, so nothing a clip hides is missing.
          aria-label={`${title}, ${t.time} ${t.ap}, Proposed, ${spanLabel(mins)}`}
          {...rowHandlers}
          onClick={() => { if (swipeOpen || dx) { closeThen(); return; } if (onOpen) onOpen(); else onToggle(); }}
        >
          <span className={"sched-bar sched-bar-proposed cat-bd-" + slot} />
          {/* NO CHECKBOX ON A PROPOSED ROW (Dave 2026-10-13, amending Alfred's schedule order: "I never approved a checkbox on the right side
              of a row"). The 2026-09-27 check sat in the star's slot, ahead of the time, which put this row's time 28px right of every other
              row's; moving it to the row's end put the one checkbox in the app on the wrong side. Checkboxes live at the left, and the left
              of a schedule row belongs to its time, so this row does not draw one. Clearing it is the swipe right (the Done rail, below),
              the first thing the long-press menu says (Done), and the task's own sheet. */}
          {/* THE TIME IS IN THE TIME COLUMN (Dave 2026-10-11: "The time always goes in the LEFT time column, aligned with event
              times. One left edge for all times, one event column; that is the established schedule geometry."). This
              replaces the 2026-10-05 two-line shape that led the details line with the time. The row is an event row now:
              the check in the star's slot, the time, then the title with "PROPOSED · 30 Min" under it. */}
          <div className="sched-time">{t.time}{"\u00a0"}<span className="ampm">{t.ap}</span></div>
          <div className="sched-body">
            <div className="sched-title"><span className="sched-t">{title}</span></div>
            {!plain && (
              <div className="sched-cat">
                <span className="sched-fact"><span className="prop-tag fact st gray">Proposed</span></span>
                <span className="sched-fact">{sep}<span className="fact"><b>{spanLabel(mins)}</b></span></span>
              </div>
            )}
          </div>
        </div>
      </div>
      {open && (
        <div className="draft-edit-body" onClick={(e) => e.stopPropagation()}>
          <div className="plan-controls">
            <div className="chip-row plan-durs" ref={durs}>
              {DUR_CHOICES.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={"chip" + (mins === d ? " chip-on" : "")}
                  aria-label={`${block.text}: ${d} minutes`}
                  onClick={() => onDuration(d)}
                >
                  {durLabel(d)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {sheet}
    </div>
  );
}

// A PROPOSED TASK NESTED IN A BLOCK (C-32, Astra 2026-09-12; Dave 2026-10-05, locked: no pill on a row). It sat inside a
// protected block's own row, so it cannot carry a swipe of its own (the block's rail is under the same finger); its Accept
// capsule is the first line of the long-press menu now, beside Edit Task and Move to Anytime, and the tap opens the task as it
// always has. Absent an editor the tap is the toggle it always was.
export function HeldProposalRow({ block, onOpen, onAccept, onDrop, onComplete, plain = false }: {
  block: PlanBlock;
  /** Home's finished day: the task's title and nothing else (no ring, no time, no "Proposed", no length). Done, Edit and Move are in its long-press menu. */
  plain?: boolean;
  onOpen: () => void;
  onAccept?: () => void;
  onDrop?: () => void;
  /** Today's day card ticks a held task off from here (2026-09-15): the ring leads the row where the hollow dot would. */
  onComplete?: () => void;
}) {
  const title = titleCase(block.text);
  const actions: RowAction[] = [
    ...(onAccept ? [{ label: "Book It", onPick: onAccept }] : []),
    ...(onComplete ? [{ label: "Done", onPick: onComplete }] : []),
    { label: "Edit Task", onPick: onOpen },
    ...(onDrop ? [{ label: "Move to Anytime", onPick: onDrop }] : []),
  ];
  // No swipe on this row (the block's own rail is under the same finger), so its hold is the plain press.
  const menu = useRowMenu({ title, actions });
  const hold = useLongPress({ onLongPress: menu.open, ms: 420, enabled: actions.length > 0 });
  const { sheet } = menu;
  const handlers = {
    ...hold,
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); menu.open(); },
  };
  return (
    <div
      className="block-held block-held-prop"
      {...pressable(onOpen)}
      {...handlers}
      /* This row sits inside the block's own row, which has its own swipe and its own menu under the same finger. A hold,
         a touch or a right click here is THIS row's, so none of them travels up to start the block's. */
      onTouchStart={(ev) => { ev.stopPropagation(); handlers.onTouchStart(ev); }}
      onPointerDown={(ev) => { ev.stopPropagation(); handlers.onPointerDown(ev); }}
      onContextMenu={(ev) => { ev.stopPropagation(); handlers.onContextMenu(ev); }}
      onClick={(ev) => { ev.stopPropagation(); onOpen(); }}
    >
      {onComplete && !plain ? (
        <div className="task-check-tap bh-check" role="checkbox" aria-checked={false}
          aria-label={`Mark ${block.text} done`}
          onClick={(ev) => { ev.stopPropagation(); onComplete(); }}>
          <div className="task-check" />
        </div>
      ) : (
        <span className={"cat-dot-hollow cat-bd-" + catColor(block.category)} />
      )}
      {/* THE TITLE WRAPS, IT IS NEVER CUT (Dave 2026-10-05: "Get E..."): the title takes the row's width and the facts sit under
          it, so nothing is squeezed to make room for a time or a verb. */}
      <div className="block-held-col">
      <span className="block-held-t">{title}</span>
      {!plain && <span className="facts block-held-facts">
        <span className="fact date">{fmtTime(block.start).time} {fmtTime(block.start).ap}</span>
        <span className="fact st gray">Proposed</span>
        {/* A length that cannot be tapped is a number with no state: white, not a second grey beside the block's own
            kicker (§AK, §AM). 2026-10-05 (the catalog gate): spanLabel spells it "45 Min" and "1h 30m"; it was glued
            "45m" by hand. */}
        <span className="fact"><b>{spanLabel(blockMinutes(block))}</b></span>
      </span>}
      </div>
      {sheet}
    </div>
  );
}
