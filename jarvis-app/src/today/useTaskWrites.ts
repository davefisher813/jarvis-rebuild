import { useEffect, useRef } from "react";
import { bus } from "../events";
import { ENTITY_TASK } from "../notes/types";

// THE DAY RING FOLLOWS THE TASKS (Dave 2026-10-06: "the 8/19 ring doesn't update
// when I move tasks to other days. Rescheduling a task off today should drop it
// from the count immediately").
//
// Today read its tasks once on open and again only from its own handlers or when
// the background refresh found another device's change. A move made anywhere
// else while Today was on screen (a sheet over it, a card's own action, the
// sweep's review) wrote the task and left the ring, the list and every count
// counting the old day. Every task write by this device lands on the event bus,
// so Today listens there and reloads. The reloads are coalesced: a bulk move is
// forty writes in a row, and one read at the end is the only one that matters.
// Writes Today makes itself reload on their own as well; the extra pass is one
// more read of the same list, never a different answer.
const SETTLE_MS = 150;

export function useTaskWrites(reload: () => unknown): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = bus.subscribe((e) => {
      if (e.entityType !== ENTITY_TASK) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void reloadRef.current(); }, SETTLE_MS);
    });
    return () => { off(); if (timer) clearTimeout(timer); };
  }, []);
}
