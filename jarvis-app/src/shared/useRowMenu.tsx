import { useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode, type TouchEvent as RTouchEvent } from "react";
import RowActionSheet, { type RowAction } from "./RowActionSheet";
import { useLongPress } from "./useLongPress";
import { haptics } from "./haptics";

// THE LONG PRESS IS THE CONTEXT MENU (Dave 2026-10-05, locked; ROW-ACTIONS-SPEC.md section 1: "Long press: the context menu,
// never the only way to anything essential"). One composition of a swipeable row with its menu, written once, so a row gets a
// held-row menu by naming its verbs and nothing else.
//
// THE SHAPE. The swipe controller (shared/useSwipe) owns the gesture and the hold timer; its `onLongPress` option says what a
// hold (and the context-menu event: right click, the iOS callout) does instead of toggling the tray. This hook owns the menu's
// state, the sheet, and the one detail the controller cannot know: a touch that held long enough to open the menu still ends
// in a click, and that click must not also open the row. Three lines in the row:
//
//     const menu = useRowMenu({ title, actions });
//     const swipe = useSwipe({ revealW, onLongPress: menu.onLongPress });
//     const { handlers, sheet } = menu.bind(swipe);      // spread `handlers` on the moving element, render `sheet` once
//
// It is structural on purpose: it never imports the swipe controller and never reads a touch coordinate, so it is not itself
// a swipe surface (the row that calls useSwipe is, and the laws' rosters still name that row). Declaring the menu BEFORE the
// swipe is what lets the swipe take `menu.onLongPress`; an action that needs the swipe (closing the tray) just calls
// `swipe.closeThen` from inside its own function, which only runs later.
//
// A ROW WITH NO MENU keeps the controller's old hold (toggle the tray): that is the keyboard-and-mouse way to the tray, and a
// row with nothing to list has nothing better to open. `actions` empty, or `enabled` false, yields `onLongPress: undefined`.

interface SwipeHandlers {
  onTouchStart: (e: RTouchEvent) => void;
  onTouchMove: (e: RTouchEvent) => void;
  onTouchEnd: () => void;
  onMouseDown: () => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
  onContextMenu: (e: RMouseEvent) => void;
}

/** The slice of a swipe controller `bind` needs: its handlers and the way to close its tray. */
interface RowSwipe {
  handlers: SwipeHandlers;
  closeThen: (fn?: () => void) => void;
}

export interface RowMenuHandlers extends SwipeHandlers {
  onTouchCancel: () => void;
  onClickCapture: (e: RMouseEvent) => void;
  /** Present only when the swipe is off (see `swipeEnabled`): the mouse and pen half of the plain hold. */
  onPointerDown?: (e: RPointerEvent) => void;
  onPointerMove?: (e: RPointerEvent) => void;
  onPointerUp?: () => void;
  onPointerLeave?: () => void;
}

/** How long after the menu opens a click on the row is still the tail of the hold that opened it. */
const HOLD_CLICK_MS = 1500;

export function useRowMenu({ title, actions, enabled = true, swipeEnabled = true, onOpen }: {
  /** What the menu is about (the row's title), so a menu over a list says which row it belongs to. */
  title: string;
  /** The row's verbs: the primary first, then the quieter ones, destructive last. Empty means no menu. */
  actions: RowAction[];
  /** Off while the row is in a mode where a hold means something else (select mode, rename). */
  enabled?: boolean;
  /** False when the row's swipe is switched off (a past event, a row with a menu and no tray). The controller ignores every
   *  touch then, so the hold falls back to the plain press (shared/useLongPress) and the menu still opens. */
  swipeEnabled?: boolean;
  /** What a hold does INSTEAD of opening the sheet, for a row whose hold opens a surface of its own (a producer card's tuning
   *  sheet). It still gets the haptic, the swallowed click and the stand-down of the tray; `actions` may then be empty. */
  onOpen?: () => void;
}): {
  /** Pass to useSwipe({ onLongPress }). Undefined when there is no menu, so the controller keeps its tray toggle. */
  onLongPress: (() => void) | undefined;
  /** Open the menu directly (a row whose tap has no record to open). */
  open: () => void;
  /** The sheet itself, for a row with no swipe (the same node `bind` returns; render ONE of them). */
  sheet: ReactNode;
  bind: (swipe: RowSwipe) => { handlers: RowMenuHandlers; sheet: ReactNode };
} {
  const [menu, setMenu] = useState(false);
  const openedAt = useRef(0);
  // The tray to close with the sheet: set by `bind` on each render, so cancelling the menu leaves the row shut.
  const closeTray = useRef<(() => void) | undefined>(undefined);
  const live = enabled && (!!onOpen || actions.length > 0);
  const plain = useLongPress({ onLongPress: () => open(), ms: 420, enabled: live && !swipeEnabled });
  const open = () => { if (!live) return; haptics.selection(); openedAt.current = Date.now(); if (onOpen) onOpen(); else setMenu(true); };
  const sheet = menu
    ? <RowActionSheet title={title} actions={actions} onCancel={() => { setMenu(false); closeTray.current?.(); }} />
    : null;
  return {
    onLongPress: live ? open : undefined,
    open,
    sheet,
    bind: (swipe) => {
      closeTray.current = () => swipe.closeThen();
      if (!swipeEnabled) {
        // No swipe to lean on: the plain hold (touch, mouse and pen) and the context-menu event open the menu.
        return {
          handlers: {
            ...swipe.handlers,
            onTouchStart: plain.onTouchStart,
            onTouchMove: plain.onTouchMove,
            onTouchEnd: plain.onTouchEnd,
            onTouchCancel: plain.onTouchCancel,
            onPointerDown: plain.onPointerDown,
            onPointerMove: plain.onPointerMove,
            onPointerUp: plain.onPointerUp,
            onPointerLeave: plain.onPointerLeave,
            onClickCapture: plain.onClickCapture,
            onContextMenu: (e) => { if (!live) return; e.preventDefault(); open(); },
          },
          sheet,
        };
      }
      return {
        handlers: {
          ...swipe.handlers,
          // A fresh touch or press is a fresh start: the click owed to the last hold is no longer owed.
          onTouchStart: (e) => { openedAt.current = 0; swipe.handlers.onTouchStart(e); },
          onMouseDown: () => { openedAt.current = 0; swipe.handlers.onMouseDown(); },
          onTouchCancel: () => swipe.handlers.onTouchEnd(),
          // The tail of the hold: the release of the finger that opened the menu would otherwise open the row under it.
          onClickCapture: (e) => {
            if (!openedAt.current) return;
            const fresh = Date.now() - openedAt.current < HOLD_CLICK_MS;
            openedAt.current = 0;
            if (!fresh) return;
            e.preventDefault();
            e.stopPropagation();
          },
        },
        sheet,
      };
    },
  };
}
