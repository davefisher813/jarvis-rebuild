// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import EventSheet, { type SheetCategory } from "./EventSheet";

// LINKED PICKERS FILTER BY AREA, BOTH DIRECTIONS (Dave 2026-10-22), on the event sheet: Area and Project.
// The event's Area is never blank (it defaults to the first), so until somebody chooses one it is not an Area in force: the Project menu lists
// everything, and a pick brings its own Area in. A record being edited, or a new event opened into an area, has chosen.
const CATS: SheetCategory[] = [
  { id: "work", name: "Work", color: "blue" },
  { id: "friends", name: "Friends", color: "teal" },
  { id: "home", name: "Home", color: "yellow" },
];
const PROJECTS = [
  { id: "p-launch", title: "Launch Plan", category: "work" },
  { id: "p-reunion", title: "Reunion", category: "friends" },
  { id: "p-trip", title: "Trip", category: "friends" },
  { id: "p-someday", title: "Someday", category: undefined },
];

beforeEach(() => localStorage.clear());

const mount = (over: Partial<ComponentProps<typeof EventSheet>> = {}) => {
  const onSave = vi.fn();
  render(<EventSheet mode="new" initial={{ date: "2026-10-24" }} categories={CATS} projects={PROJECTS} onSave={onSave} onCancel={() => {}} {...over} />);
  return { onSave };
};
const trigger = (label: string) => screen.getAllByLabelText(label).find((el) => el.tagName === "BUTTON")!;
const value = (label: string) => trigger(label).textContent ?? "";
const open = (label: string) => fireEvent.click(trigger(label));
const offered = () => [...screen.getByRole("menu").querySelectorAll(".hmenu-l")].map((el) => el.textContent);
const peek = (label: string) => { open(label); const got = offered(); open(label); return got; };
const choose = (label: string, name: string | RegExp) => { open(label); fireEvent.click(screen.getByRole("menuitemradio", { name })); };

describe("EventSheet: the Project menu follows the Area", () => {
  it("a new event whose Area nobody chose lists every project", () => {
    mount();
    expect(peek("Project")).toEqual(["None", "Reunion", "Trip", "Launch Plan", "Someday"]);
  });

  it("a project picked first brings its Area in, and the menu then lists only that Area's", () => {
    mount();
    choose("Project", /Reunion/);
    expect(value("Area")).toContain("Friends");
    expect(peek("Project")).toEqual(["None", "Reunion", "Trip"]);
  });

  it("a project with no area changes no Area, and the menu stays whole", () => {
    mount();
    choose("Project", /Someday/);
    expect(value("Area")).toContain("Work");
    expect(peek("Project")).toHaveLength(5);
  });

  it("choosing the Area puts it in force: only its projects are offered, None on top", () => {
    mount();
    choose("Area", /Friends/);
    expect(peek("Project")).toEqual(["None", "Reunion", "Trip"]);
    choose("Area", /Home/);
    expect(peek("Project")).toEqual(["None"]);
  });

  it("choosing even the default Area puts it in force", () => {
    mount();
    choose("Area", /Work/);
    expect(peek("Project")).toEqual(["None", "Launch Plan"]);
  });

  it("a search searches the narrowed list", () => {
    mount();
    choose("Area", /Friends/);
    open("Project");
    fireEvent.change(screen.getByLabelText("Search Projects"), { target: { value: "launch" } });
    expect(offered()).toEqual(["None"]);
    fireEvent.change(screen.getByLabelText("Search Projects"), { target: { value: "tri" } });
    expect(offered()).toEqual(["None", "Trip"]);
  });

  it("changing the Area sends a project that no longer fits back to None, and it saves that way", () => {
    const { onSave } = mount();
    choose("Area", /Friends/);
    choose("Project", /Trip/);
    expect(value("Project")).toContain("Trip");
    choose("Area", /Work/);
    expect(value("Project")).toContain("None");
    fireEvent.change(screen.getByPlaceholderText(/happening/i), { target: { value: "Standup" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ category: "work", projectId: "" });
  });

  it("changing to an Area the project is tied to keeps it", () => {
    mount();
    choose("Area", /Friends/);
    choose("Project", /Trip/);
    choose("Area", /Friends/);
    expect(value("Project")).toContain("Trip");
  });

  it("a new event opened into an Area has chosen it", () => {
    mount({ initial: { date: "2026-10-24", category: "friends" } });
    expect(peek("Project")).toEqual(["None", "Reunion", "Trip"]);
  });
});

describe("EventSheet: a record opened with a project that disagrees with its Area", () => {
  const initial = { title: "Standup", date: "2026-10-24", start: "09:00", end: "10:00", category: "work", projectId: "p-trip" };

  it("is shown as it is and stays listed; nothing is edited by opening it", () => {
    const { onSave } = mount({ mode: "edit", initial });
    expect(value("Project")).toContain("Trip");
    expect(peek("Project")).toEqual(["None", "Trip", "Launch Plan"]);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ category: "work", projectId: "p-trip" });
  });

  it("is cleared the moment the Area changes", () => {
    mount({ mode: "edit", initial });
    choose("Area", /Home/);
    expect(value("Project")).toContain("None");
  });
});
