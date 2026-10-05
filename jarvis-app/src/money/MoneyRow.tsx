import type { ReactNode } from "react";
import { useSwipe } from "../shared/useSwipe";
import { useRowMenu } from "../shared/useRowMenu";
import type { RowAction } from "../shared/RowActionSheet";
import { rowDoor } from "../shared/rowDoor";
import { Check, Trash2 } from "../shared/icons";

// THE ONE SWIPEABLE ROW OF MONEY (Dave 2026-10-05, locked; docs/jarvis-unified/ROW-ACTIONS-SPEC.md). Money's bills,
// set-asides, saving goals, subscriptions, matches, receipts and loose files all answer to the same five gestures, so
// they are one component rather than seven hand-built trays:
//
//   tap          the row's door (its sheet holds every action)
//   swipe left   the row's ONE quickest verb (`verb`), then a quieter second (`verb2`), then Delete, from the edge
//   swipe right  Complete (`complete`): fires the action and snaps back; absent for a row with nothing to complete
//   long press   the context menu (`menu`), every action again, never the only way to anything essential
//   the check    stays on the row as a child (state, not a command)
//
// No pill sits on the row. This is the second swipe surface of the app that composes the shared controller: the
// gesture math is shared/useSwipe's and the held-row menu is shared/useRowMenu's; nothing here reads a touch coordinate.
export interface RowVerb {
  label: string;
  icon: ReactNode;
  run: () => void;
}

export default function MoneyRow({
  name, verb, verb2, onDelete, deleteLabel = "Delete", complete, menu, menuTitle, onOpen, className = "", children,
}: {
  /** The record's name, so every tray button names what it acts on. */
  name: string;
  /** The row's one quickest action: the first button in the tray. */
  verb?: RowVerb | null;
  /** A quieter second button beside it (Not a Match beside Link). Needs a verb. */
  verb2?: RowVerb | null;
  /** Delete behind the reveal, the last tray button, never the only way (the sheet and the menu hold it too). */
  onDelete?: () => void;
  deleteLabel?: string;
  /** Swipe right: the completing action and the word on the rail behind the row. */
  complete?: { label: string; run: () => void } | null;
  /** The long-press menu: every action again. Empty means no menu. */
  menu: RowAction[];
  menuTitle?: string;
  onOpen: () => void;
  className?: string;
  children: ReactNode;
}) {
  const second = verb ? verb2 : null;
  const slots = (verb ? 1 : 0) + (second ? 1 : 0) + (onDelete ? 1 : 0);
  const rowMenu = useRowMenu({ title: menuTitle ?? name, actions: menu });
  const swipe = useSwipe({
    revealW: slots * 88,
    rightW: complete ? 88 : 0,
    ...(complete ? { onRightCommit: complete.run } : {}),
    onLongPress: rowMenu.onLongPress,
  });
  const { handlers, sheet } = rowMenu.bind(swipe);
  // A tap on a row whose tray is showing closes it instead of opening the record.
  const door = rowDoor(onOpen);
  const open = swipe.open || swipe.dx !== 0;
  return (
    <div className="task-swipe">
      {complete && (
        <div className="task-done-rail" aria-hidden="true">
          <Check className="ic" />
          <span className="swipe-label">{complete.label}</span>
        </div>
      )}
      {verb && (
        <button className="task-verb" aria-label={verb.label + " " + name} onClick={() => swipe.closeThen(verb.run)}>
          {verb.icon}
          <span className="swipe-label">{verb.label}</span>
        </button>
      )}
      {second && (
        <button className="task-verb task-verb-2" aria-label={second.label + " " + name} onClick={() => swipe.closeThen(second.run)}>
          {second.icon}
          <span className="swipe-label">{second.label}</span>
        </button>
      )}
      {onDelete && (
        <button className="task-del" style={slots > 1 ? { right: (slots - 1) * 88 } : undefined} aria-label={deleteLabel + " " + name}
          onClick={() => swipe.closeThen(onDelete)}>
          <Trash2 className="ic" />
          <span className="swipe-label">{deleteLabel}</span>
        </button>
      )}
      <div
        className={"task-row p2 " + className + (swipe.dragging ? " swiping" : "")}
        style={swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : undefined}
        {...handlers}
        role={door.role}
        tabIndex={door.tabIndex}
        onKeyDown={door.onKeyDown}
        onClick={(e) => { if (open) { swipe.closeThen(); return; } door.onClick(e); }}
      >
        {children}
      </div>
      {sheet}
    </div>
  );
}
