import { useEffect, useRef } from "react";
import { bus } from "../events";
import { useFreshLists } from "../data/useFreshLists";

// THE MONEY SCREENS REPAINT WHEN THE LEDGER MOVES (2026-10-03). Receipts,
// payments and bills are written from several doors (the receipt sheet, the
// Tracker, an approved email), and a card that read them once would sit wrong
// until something else made it reload. A write by this device lands on the
// event bus; a change from another device arrives as a fresh list. Both reload.
export function useLedgerEvents(types: readonly string[], reload: () => unknown): void {
  useFreshLists(types, reload);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const key = types.join(",");
  useEffect(() => {
    const want = new Set(key.split(",").filter(Boolean));
    return bus.subscribe((e) => {
      if (e.entityType && want.has(e.entityType)) void reloadRef.current();
    });
  }, [key]);
}
