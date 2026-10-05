// @vitest-environment jsdom
// A row listed on an area's page leaves that area off its second line (Dave 2026-10-05, the round-2 review: "Book PG 17U Travel" over
// "Family" on the Family page), and states its distance as text in the key, never a filled chip (D10).
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TaskRow } from "./TasksPage";
import type { TaskItem } from "../TasksService";
import { setCategoryRegistry } from "../../shared/categories";

const item = (over: Partial<TaskItem["data"]> = {}): TaskItem => ({ id: "t1", entityType: "task", data: { text: "Book Travel", done: false, category: "fam", ...over } } as unknown as TaskItem);

describe("TaskRow on an area's own page", () => {
  it("shows the area on a normal list, and nothing for the area the page is already in", () => {
    setCategoryRegistry([{ id: "fam", name: "Family", color: "pink" }, { id: "work", name: "Work", color: "blue" }]);
    const { container, rerender } = render(<TaskRow item={item()} today="2026-10-05" />);
    expect(container.querySelector(".r-parent")).toHaveTextContent("Family");
    rerender(<TaskRow item={item()} today="2026-10-05" inArea="fam" />);
    expect(container.querySelector(".r-parent")).toBeNull();
    // Another area it also carries is news, so it still shows.
    rerender(<TaskRow item={item({ extraCategories: ["work"] })} today="2026-10-05" inArea="fam" />);
    expect(container.querySelector(".r-parent")).toHaveTextContent("Work");
  });

  it("says Today in amber text and a late one in red text, with no fill", () => {
    const { container, rerender } = render(<TaskRow item={item({ due: "2026-10-05" })} today="2026-10-05" />);
    expect(container.querySelector(".r-k .fact.warn")).toHaveTextContent("Today");
    rerender(<TaskRow item={item({ due: "2026-10-02" })} today="2026-10-05" />);
    expect(container.querySelector(".r-k .fact.red")).toHaveTextContent("3 Days Late");
    expect(container.querySelector(".uchip")).toBeNull();
  });
});
