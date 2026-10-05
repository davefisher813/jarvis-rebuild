import { useRef } from "react";
import { catColor, catName } from "../../shared/categories";
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
  open,
  onToggle,
  onDuration,
  onDrop,
  onComplete,
  onAccept,
  onOpen,
}: {
  block: PlanBlock;
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
    <div className="sched-swipe-wrap">
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
          {...rowHandlers}
          onClick={() => { if (swipeOpen || dx) { closeThen(); return; } if (onOpen) onOpen(); else onToggle(); }}
        >
          <span className={"sched-bar sched-bar-proposed cat-bd-" + slot} />
          {/* THE CHECK SITS WHERE THE STAR SITS (Dave 2026-09-27, on his phone:
              a 44px check box parked beside the time pushed the title a whole
              line down and left a hole under it). An event row leads with its
              16px star, then the time, then the title on its own line; a
              proposed row leads with its check the same size in the same
              slot, so every row in the card reads the same. The 44px hit is
              the ::after expander, not the box. */}
          {onComplete && (
            <div className="sched-check" role="checkbox" aria-checked={false}
              aria-label={`Mark ${title} done`}
              onClick={(e) => { e.stopPropagation(); onComplete(); }}>
              <div className="task-check" />
            </div>
          )}
          <div className="sched-time">{t.time}<span className="ampm">{t.ap}</span></div>
          <div className="sched-body">
            <div className="sched-title"><span className="sched-t">{title}</span></div>
            <div className="sched-cat">
              {/* Each fact its own unit, separator and all, like DayRow's
                  line (2026-09-27): the one-row layout drops facts from the
                  end one at a time, so a loose dot and a loose word cannot
                  be, and the state word leads the line the way it leads an
                  event row's (C-28). */}
              {/* The word does the work the dashes started. Its own segment, so
                  the dot-break casing law applies and it reads as a state, not
                  as part of the category name.
                  C-28 (Astra, 2026-09-12): and the word is the state word now,
                  in the closed vocabulary's own small caps. .prop-tag stays on
                  it for the rule that keeps live information off --tx-4. */}
              <span className="sched-fact">
                <span className="prop-tag fact st gray">Proposed</span>
              </span>
              {/* No separator between the state word and the category: the dot
                  divides them, the same as an event row's "FIXED • Family". */}
              <span className="sched-fact">
                <span className={"cat-dot cat-bg-" + slot} />
                {catName(block.category)}
              </span>
            </div>
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
export function HeldProposalRow({ block, onOpen, onAccept, onDrop }: {
  block: PlanBlock;
  onOpen: () => void;
  onAccept?: () => void;
  onDrop?: () => void;
}) {
  const title = titleCase(block.text);
  const actions: RowAction[] = [
    ...(onAccept ? [{ label: "Book It", onPick: onAccept }] : []),
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
      <span className={"cat-dot-hollow cat-bd-" + catColor(block.category)} />
      <span className="block-held-t truncate">{title}</span>
      <span className="facts block-held-facts">
        <span className="fact st gray">Proposed</span>
        {/* A length that cannot be tapped is a number with no state: white, not a second grey beside the block's own
            kicker (§AK, §AM). 2026-10-05 (the catalog gate): spanLabel spells it "45 Min" and "1h 30m"; it was glued
            "45m" by hand. */}
        <span className="fact"><b>{spanLabel(blockMinutes(block))}</b></span>
      </span>
      {sheet}
    </div>
  );
}
