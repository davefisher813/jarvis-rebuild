// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import PeopleListPage from "./PeopleListPage";
import { setCategoryRegistry } from "../../shared/categories";
import type { Person } from "../types";

// THE REMEMBER STAR ON A CONTACT ROW (the ship-blocker review, 2026-10-05: "an empty outline star on every contact row"). An empty
// star on every row is a control nobody asked for; the row wears it only while the person is remembered, in the gutter, as a task,
// an event, a note and a decision row do, and remembering is the long press (Remember, then Forget once it is). The strand store is
// replaced by a double so the test owns both states.

const run = vi.fn(async () => {});
let on = false;
vi.mock("../../shared/EntityStar", () => ({
  default: ({ quiet }: { quiet?: boolean }) => (quiet && !on ? null : <button type="button" className={"row-star" + (on ? " on" : "")} aria-label={on ? "Forget this" : "Remember this"} />),
  useRemember: () => ({ on, run }),
}));

setCategoryRegistry([]);
const people: Person[] = [
  { id: "a", data: { name: "Aaron Roman", group: "contacts", relationship: "Sister" } as Person["data"] },
  { id: "b", data: { name: "Bea Cole", group: "contacts" } as Person["data"] },
];
const page = (onOpen = () => {}) => render(<PeopleListPage people={people} onOpen={onOpen} onAdd={() => {}} onBack={() => {}} />);

describe("PeopleListPage: the Remember star", () => {
  it("draws no star on a contact that is not remembered, and offers Remember on the long press", () => {
    on = false; run.mockClear();
    const { container } = page();
    expect(container.querySelectorAll(".person-row-ruled").length).toBe(2);
    expect(container.querySelector(".person-row-ruled .row-star"), "an empty star on every row is gone").toBeNull();
    fireEvent.contextMenu(screen.getByText("Aaron Roman"));
    const sheet = document.querySelector(".action-sheet") as HTMLElement;
    expect([...sheet.querySelectorAll("button")].map((b) => b.textContent)).toContain("Remember");
    fireEvent.click(within(sheet).getByText("Remember"));
    expect(run).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("a remembered contact wears the filled star, and its long press offers Forget", () => {
    on = true; run.mockClear();
    const { container } = page();
    expect(container.querySelectorAll(".person-row-ruled > .row-star.on").length).toBe(2);
    fireEvent.contextMenu(screen.getByText("Aaron Roman"));
    const sheet = document.querySelector(".action-sheet") as HTMLElement;
    expect(within(sheet).getByText("Forget")).toBeInTheDocument();
    cleanup();
  });

  it("a tap still opens the person", () => {
    on = false;
    const onOpen = vi.fn();
    page(onOpen);
    fireEvent.click(screen.getByText("Bea Cole"));
    expect(onOpen).toHaveBeenCalledWith("b");
    cleanup();
  });
});
