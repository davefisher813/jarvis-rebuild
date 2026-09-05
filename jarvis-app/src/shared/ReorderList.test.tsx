// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ReorderList from "./ReorderList";

// SHELL-F-01 (2026-09-05): the list must paint a changed id set in the same
// render it arrives in. It used to resync in an effect, one render late, so
// a caller that dropped an id saw renderRow called with it once, and any
// renderRow that looked the id up crashed the page.
describe("ReorderList", () => {
  it("never calls renderRow with an id the caller has removed", () => {
    const seen: string[][] = [];
    const rowsOf = (ids: string[]) => (
      <ReorderList
        ids={ids}
        onReorder={() => {}}
        renderRow={(id) => {
          seen.push(ids);
          if (!ids.includes(id)) throw new Error("renderRow got a stale id: " + id);
          return <span>{id}</span>;
        }}
      />
    );
    const { rerender, container } = render(rowsOf(["a", "b", "c"]));
    expect(container.textContent).toBe("abc");
    rerender(rowsOf(["a", "c"]));
    expect(container.textContent).toBe("ac");
  });

  it("keeps the caller's order when the same ids come back in a new array", () => {
    const rowsOf = (ids: string[]) => (
      <ReorderList ids={ids} onReorder={() => {}} renderRow={(id) => <span>{id}</span>} />
    );
    const { rerender, container } = render(rowsOf(["a", "b"]));
    rerender(rowsOf(["a", "b"]));
    expect(container.textContent).toBe("ab");
    rerender(rowsOf(["b", "a"]));
    expect(container.textContent).toBe("ba");
  });
});
