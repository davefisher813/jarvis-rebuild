// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import BrainPage, { type BrainCategory } from "./BrainPage";

const CATS: BrainCategory[] = [
  { id: "c1", name: "Work", color: "blue", icon: "briefcase" },
  { id: "c2", name: "Family", color: "pink", icon: "heart" },
  { id: "c3", name: "Health", color: "green", icon: "dumbbell" },
];

describe("BrainPage", () => {
  it("renders the static sections plus a dynamic Your Categories section", () => {
    render(<BrainPage onOpen={() => {}} categories={CATS} />);
    ["Who You Know", "How You Think", "Your Categories", "Setup"].forEach((t) =>
      expect(screen.getByText(t)).toBeInTheDocument(),
    );
    expect(screen.getByText("Work")).toBeInTheDocument();
  });

  it("omits Your Categories when there are none", () => {
    render(<BrainPage onOpen={() => {}} />);
    expect(screen.queryByText("Your Categories")).not.toBeInTheDocument();
  });

  it("renders every row with a colored (non-grey) icon tile", () => {
    const { container } = render(<BrainPage onOpen={() => {}} categories={CATS} />);
    const tiles = container.querySelectorAll(".sec-ico");
    // 8 static rows + 3 category rows
    expect(tiles.length).toBe(11);
    expect(container.querySelectorAll(".sec-ico.ico-surface").length).toBe(0);
    tiles.forEach((t) => expect(t.className).toMatch(/ico-blue|ico-accent|ico-good|cat-bg-/));
  });

  it("colors each category tile with its own slot", () => {
    const { container } = render(<BrainPage onOpen={() => {}} categories={CATS} />);
    expect(container.querySelector(".sec-ico.cat-bg-blue")).toBeTruthy();
    expect(container.querySelector(".sec-ico.cat-bg-pink")).toBeTruthy();
    expect(container.querySelector(".sec-ico.cat-bg-green")).toBeTruthy();
  });

  it("shows status on the Setup rows", () => {
    const { container } = render(<BrainPage onOpen={() => {}} categories={CATS} />);
    expect(container.querySelectorAll(".row-status").length).toBe(2);
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("On")).toBeInTheDocument();
  });

  it("fires onOpen for a static row and a category row", () => {
    const onOpen = vi.fn();
    render(<BrainPage onOpen={onOpen} categories={CATS} />);
    fireEvent.click(screen.getByText("Contacts"));
    expect(onOpen).toHaveBeenCalledWith("contacts", "Contacts");
    fireEvent.click(screen.getByText("Work"));
    expect(onOpen).toHaveBeenCalledWith("c1", "Work");
  });
});
