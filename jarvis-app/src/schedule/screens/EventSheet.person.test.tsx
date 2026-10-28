// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import EventSheet, { type SheetCategory } from "./EventSheet";

// THE EVENT SHEET HAS A PERSON, AND A PERSON CAN COME OFF (Dave, 2026-10-27: "the Edit Event screen has no Person field at all", so a wrong
// contact could not be removed). The task sheet's Person row, on the event: None on top, narrowed by the Area, a pick never moves a chosen
// Area, a change of Area sends a person who no longer fits back to None (shared/areaLinks).
const CATS: SheetCategory[] = [
  { id: "work", name: "Work", color: "blue" },
  { id: "friends", name: "Friends", color: "teal" },
];
const PEOPLE = [
  { id: "josh-b", name: "Josh (Bucknell)", areas: ["friends"] },
  { id: "josh-r", name: "Josh Rudd", areas: ["work"] },
  { id: "nobody", name: "Unfiled Contact", areas: [] },
];

beforeEach(() => localStorage.clear());

const mount = (over: Partial<ComponentProps<typeof EventSheet>> = {}) => {
  const onSave = vi.fn();
  render(<EventSheet mode="edit" initial={{ title: "Catch Up", date: "2026-10-28", start: "09:00", end: "10:00", category: "work" }} categories={CATS} people={PEOPLE} onSave={onSave} onCancel={() => {}} {...over} />);
  return { onSave };
};
const trigger = (label: string) => screen.getAllByLabelText(label).find((el) => el.tagName === "BUTTON")!;
const value = (label: string) => trigger(label).textContent ?? "";
const open = (label: string) => fireEvent.click(trigger(label));
const offered = () => [...screen.getByRole("menu").querySelectorAll(".hmenu-l")].map((el) => el.textContent);
const peek = (label: string) => { open(label); const got = offered(); open(label); return got; };
const choose = (label: string, name: string | RegExp) => { open(label); fireEvent.click(screen.getByRole("menuitemradio", { name })); };

describe("EventSheet: the Person row", () => {
  it("is there on an edit, with None on top", () => {
    mount({ initial: { title: "Catch Up", date: "2026-10-28", start: "09:00", end: "10:00", category: "work", personId: "josh-b" } });
    expect(value("Person")).toContain("Josh (Bucknell)");
    expect(peek("Person")[0]).toBe("None");
  });

  it("None takes the wrong person off, and the save says so (an empty id, never a missing one)", () => {
    const { onSave } = mount({ initial: { title: "Catch Up", date: "2026-10-28", start: "09:00", end: "10:00", category: "work", personId: "josh-b" } });
    choose("Person", "None");
    expect(value("Person")).toContain("None");
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ personId: "" });
  });

  it("another person can be picked in place of the first", () => {
    const { onSave } = mount({ initial: { title: "Catch Up", date: "2026-10-28", start: "09:00", end: "10:00", category: "work", personId: "josh-b" } });
    choose("Person", /Josh Rudd/);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ personId: "josh-r" });
  });

  it("opening a record never edits it: a person who disagrees with the Area stays until the Area changes", () => {
    const { onSave } = mount({ initial: { title: "Catch Up", date: "2026-10-28", start: "09:00", end: "10:00", category: "work", personId: "josh-b" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ category: "work", personId: "josh-b" });
  });

  it("the Area narrows the list, and a change of Area clears a person who no longer fits", () => {
    mount({ initial: { title: "Catch Up", date: "2026-10-28", start: "09:00", end: "10:00", category: "work", personId: "josh-r" } });
    expect(peek("Person")).toEqual(["None", "Josh Rudd"]);
    choose("Area", /Friends/);
    expect(value("Person")).toContain("None");
    expect(peek("Person")).toEqual(["None", "Josh (Bucknell)"]);
  });

  it("a person picked before any Area was chosen brings their own Area in", () => {
    render(<EventSheet mode="new" initial={{ date: "2026-10-28" }} categories={CATS} people={PEOPLE} onSave={() => {}} onCancel={() => {}} />);
    choose("Person", /Josh \(Bucknell\)/);
    expect(value("Area")).toContain("Friends");
  });

  it("with no contacts there is no Person row, and the save carries no personId to overwrite a real one", () => {
    const { onSave } = mount({ people: [] });
    expect(screen.queryAllByLabelText("Person")).toHaveLength(0);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).not.toHaveProperty("personId");
  });
});
