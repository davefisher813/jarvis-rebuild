// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSelection } from "./useSelection";

// The three refusals are the whole point of putting this in one place, so
// they are what gets pinned. Each one is a bug that would otherwise ship on
// four surfaces independently.

describe("useSelection", () => {
  it("starts inert", () => {
    const { result } = renderHook(() => useSelection(["a", "b"]));
    expect(result.current.active).toBe(false);
    expect(result.current.count).toBe(0);
  });

  it("enters with the row that was held already picked", () => {
    const { result } = renderHook(() => useSelection(["a", "b", "c"]));
    act(() => result.current.enter("b"));
    expect(result.current.active).toBe(true);
    expect(result.current.selected).toEqual(["b"]);
  });

  it("toggles rows in and out", () => {
    const { result } = renderHook(() => useSelection(["a", "b", "c"]));
    act(() => result.current.enter("a"));
    act(() => result.current.toggle("c"));
    expect(result.current.selected).toEqual(["a", "c"]);
    act(() => result.current.toggle("a"));
    expect(result.current.selected).toEqual(["c"]);
  });

  // A selection made before a reload, a filter change, or somebody else's
  // edit must not ask to delete rows that are no longer there.
  it("forgets rows that have left the list", () => {
    const { result, rerender } = renderHook(({ ids }) => useSelection(ids), {
      initialProps: { ids: ["a", "b", "c"] },
    });
    act(() => result.current.enter("a"));
    act(() => result.current.toggle("c"));
    expect(result.current.count).toBe(2);
    rerender({ ids: ["a", "b"] });
    expect(result.current.selected).toEqual(["a"]);
    expect(result.current.count).toBe(1);
  });

  // A header offering to delete nothing is worse than no header.
  it("drops out of select mode when the list empties under it", () => {
    const { result, rerender } = renderHook(({ ids }) => useSelection(ids), {
      initialProps: { ids: ["a"] },
    });
    act(() => result.current.enter("a"));
    expect(result.current.active).toBe(true);
    rerender({ ids: [] });
    expect(result.current.active).toBe(false);
  });

  // Select All means all of what is ON SCREEN. A filtered list that deleted
  // the rows behind the filter would be the worst possible version of this.
  it("Select All takes the visible rows and nothing else", () => {
    const { result } = renderHook(() => useSelection(["a", "b"]));
    act(() => result.current.enter());
    act(() => result.current.selectAll());
    expect(result.current.selected).toEqual(["a", "b"]);
    expect(result.current.allSelected).toBe(true);
  });

  it("knows when everything visible is selected, and when it stops being", () => {
    const { result, rerender } = renderHook(({ ids }) => useSelection(ids), {
      initialProps: { ids: ["a", "b"] },
    });
    act(() => result.current.enter());
    act(() => result.current.selectAll());
    expect(result.current.allSelected).toBe(true);
    // A row arrives from a reload: the selection is no longer everything.
    rerender({ ids: ["a", "b", "c"] });
    expect(result.current.allSelected).toBe(false);
  });

  it("clears the picks without leaving select mode", () => {
    const { result } = renderHook(() => useSelection(["a", "b"]));
    act(() => result.current.enter("a"));
    act(() => result.current.clearAll());
    expect(result.current.count).toBe(0);
    expect(result.current.active).toBe(true);
  });

  it("exit puts everything back", () => {
    const { result } = renderHook(() => useSelection(["a", "b"]));
    act(() => result.current.enter("a"));
    act(() => result.current.exit());
    expect(result.current.active).toBe(false);
    expect(result.current.count).toBe(0);
  });

  // Selection order follows the LIST, not the order things were tapped, so a
  // caller can rely on it to build a sensible "Deleted 3" undo.
  it("reports the selection in list order", () => {
    const { result } = renderHook(() => useSelection(["a", "b", "c"]));
    act(() => result.current.enter("c"));
    act(() => result.current.toggle("a"));
    expect(result.current.selected).toEqual(["a", "c"]);
  });
});
