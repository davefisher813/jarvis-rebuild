import { useEffect, useRef } from "react";
import { subscribeFreshLists } from "./store";

// THE REPAINT THAT NEVER ARRIVED (2026-08-24).
//
// CachedAdapter answers a list from the persisted cache immediately, refreshes
// it in the background, and calls `onFresh(entityType)` when that refresh
// finds real changes. store.ts wires that into `subscribeFreshLists`, whose
// own comment says "surfaces that want the repaint subscribe".
//
// No surface ever did. Zero subscribers, since the day it shipped. The app
// detected that what you were looking at was stale and then dropped the
// notification on the floor, so a list edited on another device sat wrong
// until you happened to touch something that triggered a reload.
//
// This is the consumer half. A surface says which entity types it draws and
// hands over its existing reload; nothing else changes.
//
// Two things it deliberately does NOT do. It never fires on the surface's own
// writes, because those already reload through their own handlers and a second
// pass would fight optimistic state. And it never fires in the demo or local
// build, because those use InMemoryAdapter with no CachedAdapter behind it, so
// there is nothing to be stale about.
export function useFreshLists(types: readonly string[], reload: () => unknown): void {
  // Held in a ref so a caller passing an inline arrow does not resubscribe on
  // every render, which would make this a leak instead of a fix.
  const reloadRef = useRef<() => unknown>(reload);
  reloadRef.current = reload;

  const key = types.join(",");
  useEffect(() => {
    const want = new Set(key.split(",").filter(Boolean));
    if (want.size === 0) return;
    return subscribeFreshLists((entityType) => {
      if (want.has(entityType)) void reloadRef.current();
    });
  }, [key]);
}
