import { useEffect, useRef, useState, type ReactNode } from "react";
import { onPressKey } from "./pressable";
import { useLongPress } from "./useLongPress";
import RowActionSheet from "./RowActionSheet";

const GRIP = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /></svg>;

// Pointer-based vertical reorder, extracted from the tab-order list so a
// second draggable list does not mean a second gesture implementation. Uses
// window-level listeners (the gesture is never lost if the finger leaves the
// handle) and blocks touchmove while dragging so the page cannot steal it as
// a scroll. Works on touch.
//
// The caller renders each row's CONTENT; this owns only the order and the
// handle, so every reorderable list looks like every other list in the app.
export default function ReorderList({
  ids,
  renderRow,
  onReorder,
  handles = true,
}: {
  ids: string[];
  renderRow: (id: string) => ReactNode;
  // SHELL-F-11 (2026-09-05): a caller that writes the new order may report
  // back. Resolving false puts the rows back where the drag found them,
  // because the stored order is unchanged and the caller's own list prop
  // therefore never changes, so nothing else would ever correct the screen.
  onReorder: (next: string[]) => void | Promise<boolean | void>;
  /** REORDER IS A MODE (Health Preview, approved 2026-08-31, gestures
   *  ruling): a row crowded with a name, a chevron and a grip has no clean
   *  tap target. When false the grips stay off-screen and the list is a
   *  plain list; the caller's "Reorder" head pill turns them on. Defaults
   *  true so every existing call site keeps its always-on drag. */
  handles?: boolean;
}) {
  const [order, setOrder] = useState<string[]>(ids);
  const orderRef = useRef(order);
  const fromRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState<number | null>(null);

  // SHELL-F-01 (2026-09-05): the order used to be resynced to `ids` in an
  // effect, which runs AFTER the render that follows a change. So when the
  // caller dropped an id (an area deleted from Settings > Areas) this list
  // still painted its previous order once, and renderRow was called with an
  // id the caller no longer has. Resync during render instead, keyed on the
  // ids' content (callers build the array fresh every render, so identity
  // would reset a drag in progress): a changed list is painted with the new
  // ids in the same render, never with a dead one.
  const idsKey = ids.join("\u0000");
  const [seenKey, setSeenKey] = useState(idsKey);
  let shown = order;
  if (seenKey !== idsKey) {
    setSeenKey(idsKey);
    setOrder(ids);
    orderRef.current = ids;
    shown = ids;
  }
  useEffect(() => { orderRef.current = order; }, [order]);

  // Write a new order, and put the rows back if the caller says it did not
  // land. Shared by the drag and by the Move Up / Move Down sheet below, so
  // every route to a reorder behaves identically (SHELL-F-11, SHELL-F-22).
  const commit = (next: string[], before: string[]) => {
    setOrder(next);
    orderRef.current = next;
    const result = onReorder(next);
    // SHELL-F-11: only a promise that says false rolls back. A caller that
    // returns nothing keeps the old optimistic behaviour exactly.
    void Promise.resolve(result).then((ok) => {
      if (ok === false) { setOrder(before); orderRef.current = before; }
    }).catch(() => { setOrder(before); orderRef.current = before; });
  };

  // ONE MENU, TWO DOORS (BROWSER-F-14 + SHELL-F-22, merged 2026-09-05).
  //
  // Reordering used to be a pointer drag on the grip and nothing else: no
  // menu, no up/down control, no keyboard path. Worse, the grip declared
  // role="button" and aria-label="Reorder" and answered a drag only, so
  // tapping it did nothing at all, and it carried tabIndex -1, so with a
  // switch control or a keyboard there was no way to change tab order in the
  // app at all.
  //
  // Both fixes land on the SAME sheet, which is the shared RowActionSheet the
  // notification rows use for Dismiss. Three ways in, one menu behind them:
  //
  //   - a tap on the grip (a press that never travelled),
  //   - Enter or Space on the grip, which is a tab stop now,
  //   - a long press anywhere on the row, for the person who never finds the
  //     grip or cannot hold a drag steady.
  //
  // The drag is untouched, and a pick goes through the same commit() a drag
  // does, so a refused write puts the rows back exactly the same way.
  const [menu, setMenu] = useState<number | null>(null);
  const move = (i: number, delta: number) => {
    setMenu(null);
    const before = orderRef.current;
    const j = i + delta;
    if (j < 0 || j >= before.length) return;
    const next = [...before];
    const [m] = next.splice(i, 1);
    next.splice(j, 0, m!);
    commit(next, before);
  };

  const start = (e: React.PointerEvent, i: number) => {
    e.preventDefault();
    fromRef.current = i;
    setIdx(i);
    // Where the finger went down, so the end can tell a tap from a drag.
    const downX = e.clientX, downY = e.clientY;
    let moved = false;
    // Where the rows sat before this drag, kept for the refused-write path.
    const before = orderRef.current;

    const targetIndex = (clientY: number): number => {
      const rows = Array.from(listRef.current?.children ?? []) as HTMLElement[];
      for (let j = 0; j < rows.length; j++) {
        const b = rows[j]!.getBoundingClientRect();
        if (clientY < b.top + b.height / 2) return j;
      }
      return rows.length - 1;
    };

    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const cur = fromRef.current;
      if (cur === null) return;
      // TRAVELLED, not merely twitched: a finger resting on the handle emits
      // a pointermove or two of a pixel or so, and treating those as a drag
      // would take the tap away again. Where the engine reports no pointer
      // coordinates at all (jsdom), a move event is the only signal there is,
      // so it counts as one.
      const measurable = [downX, downY, ev.clientX, ev.clientY].every((n) => Number.isFinite(n));
      if (!measurable || Math.abs(ev.clientX - downX) > 6 || Math.abs(ev.clientY - downY) > 6) moved = true;
      const t = targetIndex(ev.clientY);
      if (t !== cur && t >= 0) {
        setOrder((prev) => { const a = [...prev]; const [m] = a.splice(cur, 1); a.splice(t, 0, m!); return a; });
        fromRef.current = t;
        setIdx(t);
      }
    };
    const blockScroll = (ev: TouchEvent) => ev.preventDefault();
    const end = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.removeEventListener("touchmove", blockScroll);
      // A press that never travelled is a TAP, and a tap on the reorder
      // control opens the reorder sheet instead of silently committing the
      // order it already had.
      if (!moved) setMenu(i);
      else if (fromRef.current !== null) commit(orderRef.current, before);
      fromRef.current = null;
      setIdx(null);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    document.addEventListener("touchmove", blockScroll, { passive: false });
  };

  return (
    <div className={"card reorder-list" + (idx !== null ? " dragging-active" : "") + (handles ? " reorder-live" : "")} ref={listRef}>
      {shown.map((id, i) => (
        <Row
          key={id}
          dragging={idx === i}
          handles={handles}
          index={i}
          count={shown.length}
          expanded={menu === i}
          onGrip={(e) => start(e, i)}
          onOpen={() => setMenu(i)}
        >
          {renderRow(id)}
        </Row>
      ))}
      {/* Outside the rows, not inside one. A portal still propagates events up
          the REACT tree, so a sheet rendered within a row would have every tap
          eaten by that row's long press click suppression on the way down: the
          sheet would open and then refuse to be used.

          The ends keep both entries and disable the one that has nowhere to
          go, rather than dropping it: the grip is a control that promised to
          do something when pressed, and a menu whose buttons move around by
          row position is a worse promise than a greyed one. */}
      {menu !== null && (
        <RowActionSheet
          actions={[
            { label: "Move Up", onPick: () => move(menu, -1), disabled: menu === 0 },
            { label: "Move Down", onPick: () => move(menu, 1), disabled: menu === shown.length - 1 },
          ]}
          onCancel={() => setMenu(null)}
        />
      )}
    </div>
  );
}

// One row. Its own component because useLongPress is a hook and cannot be
// called inside the map above.
function Row({ children, dragging, handles, index, count, expanded, onGrip, onOpen }: {
  children: ReactNode;
  dragging: boolean;
  handles: boolean;
  index: number;
  count: number;
  expanded: boolean;
  onGrip: (e: React.PointerEvent) => void;
  onOpen: () => void;
}) {
  // Only where the drag itself is offered: with the grips off this is a plain
  // list and holding a row must not offer a move it cannot show.
  const press = useLongPress({ onLongPress: onOpen, enabled: handles });
  return (
    <div className={"row reorder-row" + (dragging ? " dragging" : "")} {...press}>
      {children}
      {handles && (
        <div
          className="drag-handle"
          // The grip owns its own press: without this the row's long press
          // would fire mid-drag and put a sheet over the row being moved.
          onPointerDown={(e) => { e.stopPropagation(); onGrip(e); }}
          onTouchStart={(e) => e.stopPropagation()}
          onKeyDown={onPressKey(onOpen)}
          aria-label={"Reorder " + (index + 1) + " of " + count}
          aria-haspopup="menu"
          aria-expanded={expanded}
          role="button"
          tabIndex={0}
        >{GRIP}</div>
      )}
    </div>
  );
}
