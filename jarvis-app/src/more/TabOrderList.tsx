import { useEffect, useRef, useState } from "react";
import { DESTINATIONS } from "../shell/destinations";

const GRIP = <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /></svg>;

// Pointer-based vertical reorder. Uses window-level listeners (so the gesture
// is never lost if the finger leaves the handle) and blocks touchmove while
// dragging so the page does not steal the gesture as a scroll. Works on touch.
export default function TabOrderList({ keys, onReorder }: { keys: string[]; onReorder: (next: string[]) => void }) {
  const meta = (k: string) => DESTINATIONS.find((d) => d.key === k)!;
  const [order, setOrder] = useState<string[]>(keys);
  const orderRef = useRef(order);
  const fromRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState<number | null>(null);

  useEffect(() => { setOrder(keys); }, [keys]);
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
    <div className={"card reorder-list" + (idx !== null ? " dragging-active" : "")} ref={listRef}>
      {order.map((k, i) => {
        const m = meta(k);
        return (
          <div className={"row reorder-row" + (idx === i ? " dragging" : "")} key={k}>
            <div className="sec-ico ico-surface"><m.Icon className="ic" /></div>
            <div className="row-grow"><div className="conn-name">{m.label}</div></div>
            <div className="drag-handle" onPointerDown={(e) => start(e, i)} aria-label="Reorder" role="button">{GRIP}</div>
          </div>
        );
      })}
    </div>
  );
}
