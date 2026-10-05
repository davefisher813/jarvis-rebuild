import type { ReactNode } from "react";
import { useSwipe } from "../shared/useSwipe";
import { useRowMenu } from "../shared/useRowMenu";
import type { RowAction } from "../shared/RowActionSheet";
import { Trash2 } from "../shared/icons";

// THE GYM'S SWIPEABLE ROW (Dave 2026-10-05, locked; docs/jarvis-unified/ROW-ACTIONS-SPEC.md). A gym row is a clean row:
//
//   tap          the row's own door (its sheet, its screen), owned by the row inside
//   swipe left   the row's ONE quickest verb (`verb`), then Delete behind it, never the only way
//   swipe right  nothing: a day, a lift or a logged session has nothing to complete, so it opts out
//   long press   the context menu (`menu`), every action again; or, for a row that already opens its own menu, that one
//
// No pill sits on the row. The gesture math is shared/useSwipe's and the held-row menu is shared/useRowMenu's; nothing here
// reads a touch coordinate. It generalizes shared/SwipeDelete, which can only carry Delete, so a row whose quickest verb
// is something else (Start a day, Keep two lifts separate, Favorite a lift) has the same tray without a second
// implementation of the gesture.
export interface GymVerb {
  /** The word on the tray. */
  label: string;
  /** The fuller name for a screen reader, when the tray's word is shortened to fit the 88px slot (Assign, for Assign Muscles). */
  name?: string;
  icon: ReactNode;
  run: () => void;
}

export default function GymSwipeRow({ name, verb, onDelete, deleteLabel = "Delete", enabled = true, ownsPress = false, menu = [], menuTitle, children }: {
  /** The record's name, so every tray button names what it acts on. */
  name: string;
  verb?: GymVerb | null;
  onDelete?: () => void;
  deleteLabel?: string;
  /** Off while a list is in reorder mode: two gestures on one row is neither. */
  enabled?: boolean;
  /** The row inside already opens its own menu on a long press; the swipe's own long-press-to-reveal stands down so the
   *  two never fire on one hold. */
  ownsPress?: boolean;
  /** The long-press menu: every action again. Empty means the row has none (or `ownsPress` says the row has its own). */
  menu?: RowAction[];
  menuTitle?: string;
  children: ReactNode;
}) {
  const slots = (verb ? 1 : 0) + (onDelete ? 1 : 0);
  const rowMenu = useRowMenu({ title: menuTitle ?? name, actions: menu, enabled, swipeEnabled: enabled && slots > 0 });
  // A row that opens its own menu on a hold (ownsPress) still must not have the swipe toggle its tray on that same hold:
  // the swipe's hold becomes a no-op and the inner row's own press runs alone.
  const swipe = useSwipe({
    revealW: slots * 88,
    enabled: enabled && slots > 0,
    onLongPress: rowMenu.onLongPress ?? (ownsPress ? () => {} : undefined),
  });
  const { handlers: bound, sheet } = rowMenu.bind(swipe);
  const handlers = {
    ...bound,
    // The row inside owns the hold and has no menu here: its own context-menu handler has already run, so this one stands down.
    onContextMenu: (e: React.MouseEvent) => { if (ownsPress && menu.length === 0) return; bound.onContextMenu(e); },
  };
  return (
    <div className="task-swipe">
      {verb && (
        <button className="task-verb" aria-label={(verb.name ?? verb.label) + " " + name}
          onClick={() => swipe.closeThen(verb.run)}>
          {verb.icon}
          <span className="swipe-label">{verb.label}</span>
        </button>
      )}
      {onDelete && (
        <button className="task-del" aria-label={deleteLabel + " " + name} onClick={() => swipe.closeThen(onDelete)}>
          <Trash2 className="ic" />
          <span className="swipe-label">{deleteLabel}</span>
        </button>
      )}
      <div
        className={"swipe-row" + (swipe.dragging ? " dragging" : "")}
        style={swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : undefined}
        {...handlers}
      >
        {children}
      </div>
      {sheet}
    </div>
  );
}
