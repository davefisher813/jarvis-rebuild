import { useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode, type TouchEvent as RTouchEvent } from "react";
import type { SwipeState } from "../../shared/useSwipe";
import { useLongPress } from "../../shared/useLongPress";
import { haptics } from "../../shared/haptics";
import RowActionSheet, { type RowAction } from "../../shared/RowActionSheet";

// THE LONG PRESS IS THE CONTEXT MENU, FOR EVERY ROW OF THE DAY (Dave 2026-10-05, locked: "Long-press, context menu, for power
// users, never the only way to anything essential"; ROW-ACTIONS-SPEC.md section 1). The rows on this page used to wear a
// chevron grip at the trailing edge, a permanent hint that a swipe existed. Dave's third rule on teaching the swipe is "never a
// permanent visual affordance", so the grip is gone, and the menu it opened (every action again) is a hold or a right click.
//
// One composition, written once. useSwipe owns the gesture math and its touch handlers (a swipe, and its own long hold that
// would open the tray); useLongPress owns the hold that opens the menu. They share a row, so their touch handlers are chained,
// and the menu fires a beat before the tray's hold; closing the menu closes the tray, so the two never fight over one press.
// The mouse hold that used to open the tray is left out, and so is its right click: both open the menu instead.
export function useRowMenu({ title, actions, swipe, enabled = true, onPointerDown }: {
  /** What the menu is about (the row's title), so a menu over a list says which row it belongs to. */
  title: string;
  actions: RowAction[];
  swipe: SwipeState;
  enabled?: boolean;
  /** Another pointer-down listener the row already had (the Anytime drag), run after the hold starts. */
  onPointerDown?: (e: RPointerEvent) => void;
}): { handlers: {
  onTouchStart: (e: RTouchEvent) => void; onTouchMove: (e: RTouchEvent) => void; onTouchEnd: () => void; onTouchCancel: () => void;
  onPointerDown: (e: RPointerEvent) => void; onPointerMove: (e: RPointerEvent) => void; onPointerUp: () => void; onPointerLeave: () => void;
  onClickCapture: (e: RMouseEvent) => void; onContextMenu: (e: RMouseEvent) => void;
}; sheet: ReactNode } {
  const [menu, setMenu] = useState(false);
  const live = enabled && actions.length > 0;
  const open = () => { haptics.selection(); setMenu(true); };
  const press = useLongPress({ onLongPress: open, ms: 420, enabled: live });
  const { handlers, closeThen } = swipe;
  return {
    handlers: {
      onTouchStart: (e) => { handlers.onTouchStart(e); press.onTouchStart(e); },
      onTouchMove: (e) => { handlers.onTouchMove(e); press.onTouchMove(e); },
      onTouchEnd: () => { handlers.onTouchEnd(); press.onTouchEnd(); },
      onTouchCancel: press.onTouchCancel,
      onPointerDown: (e) => { press.onPointerDown(e); onPointerDown?.(e); },
      onPointerMove: press.onPointerMove,
      onPointerUp: press.onPointerUp,
      onPointerLeave: press.onPointerLeave,
      onClickCapture: press.onClickCapture,
      onContextMenu: (e) => { if (!live) return; e.preventDefault(); open(); },
    },
    sheet: menu ? <RowActionSheet title={title} actions={actions} onCancel={() => { setMenu(false); closeThen(); }} /> : null,
  };
}
