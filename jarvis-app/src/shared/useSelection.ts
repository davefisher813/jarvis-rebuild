import { useCallback, useMemo, useState } from "react";

// SELECT AND CLEAR, IN BULK (Dave 2026-08-24: "implement easy deleting of
// stuff throughout the app as well. It should be very easy to clear and
// delete stuff. Also in bulk").
//
// Four surfaces asked for this (tasks, notices, notes, schedule) and the
// wrong way to answer is four select modes that behave almost the same. That
// is how the app grew two schedule formats. This is the state machine; each
// surface supplies its own rows and its own delete.
//
// WHAT IT REFUSES TO DO, and each refusal is a bug that would otherwise ship:
//
//   - It never holds ids that have left the list. A selection made before a
//     reload, a filter change or somebody else's edit would otherwise ask to
//     delete rows that no longer exist. `selected` is always intersected
//     with what is currently on screen.
//   - It never leaves an empty select mode standing. Clearing the last row
//     while selecting leaves a header offering to delete nothing.
//   - Select All means all of what is VISIBLE, never all of what exists. A
//     filtered list that deleted the rows behind the filter would be the
//     worst possible version of this feature.

export interface Selection {
  active: boolean;
  selected: string[];
  count: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  enter: (firstId?: string) => void;
  exit: () => void;
  selectAll: () => void;
  clearAll: () => void;
  allSelected: boolean;
}

export function useSelection(visibleIds: readonly string[]): Selection {
  const [active, setActive] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // The intersection, recomputed every render. Deliberately derived rather
  // than synced in an effect: an effect would leave one render where the
  // count on screen counts rows that are gone.
  const visible = useMemo(() => new Set(visibleIds), [visibleIds]);
  const selected = useMemo(
    () => visibleIds.filter((id) => picked.has(id)),
    [visibleIds, picked],
  );

  const toggle = useCallback((id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const enter = useCallback((firstId?: string) => {
    setActive(true);
    if (firstId) setPicked(new Set([firstId]));
  }, []);

  const exit = useCallback(() => {
    setActive(false);
    setPicked(new Set());
  }, []);

  const selectAll = useCallback(() => setPicked(new Set(visibleIds)), [visibleIds]);
  const clearAll = useCallback(() => setPicked(new Set()), []);

  // An empty list has nothing to select, so select mode has nothing to be.
  // Checked on render rather than in an effect for the same reason as above.
  const reallyActive = active && visible.size > 0;

  return {
    active: reallyActive,
    selected,
    count: selected.length,
    isSelected: (id) => picked.has(id),
    toggle,
    enter,
    exit,
    selectAll,
    clearAll,
    allSelected: visibleIds.length > 0 && selected.length === visibleIds.length,
  };
}
