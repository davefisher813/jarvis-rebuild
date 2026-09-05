import { useEffect, useRef, useState, type ReactNode } from "react";

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
  onReorder: (next: string[]) => void;
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

  const start = (e: React.PointerEvent, i: number) => {
    e.preventDefault();
    fromRef.current = i;
    setIdx(i);

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
      if (fromRef.current !== null) onReorder(orderRef.current);
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
        <div className={"row reorder-row" + (idx === i ? " dragging" : "")} key={id}>
          {renderRow(id)}
          {handles && <div className="drag-handle" onPointerDown={(e) => start(e, i)} aria-label="Reorder" role="button">{GRIP}</div>}
        </div>
      ))}
    </div>
  );
}
