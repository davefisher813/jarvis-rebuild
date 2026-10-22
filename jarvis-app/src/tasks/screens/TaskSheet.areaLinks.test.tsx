// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import TaskSheet, { type SheetCategory } from "./TaskSheet";

// LINKED PICKERS FILTER BY AREA, BOTH DIRECTIONS (Dave 2026-10-22). His screenshot: Area was Elite Squad and the Goal picker still listed every goal
// in the app (Body Weight Target, Build Massive Recruiting Network, Commit All Athletes...).
//   1. AREA FIRST   an Area narrows Goal, Project and Person to what is tied to it; None stays on top; a search searches what is left; an Area
//                   with nothing of a kind leaves just None.
//   2. REVERSE      a Goal, Project or Person picked while the Area is blank brings its own Area in, and the rest narrow to it.
//   3. A CHANGE     of Area sends any pick that no longer fits back to None.
const CATS: SheetCategory[] = [
  { id: "elite", name: "Elite Squad", color: "blue" },
  { id: "bridge", name: "Bridge", color: "green" },
  { id: "home", name: "Home", color: "yellow" },
];
const GOALS = [
  { id: "g-weight", title: "Body Weight Target", areas: ["bridge"] },
  { id: "g-recruit", title: "Build Massive Recruiting Network", areas: ["elite"] },
  { id: "g-commit", title: "Commit All Athletes", areas: ["elite", "bridge"] },
  { id: "g-loose", title: "Read More", areas: [] },
];
const PROJECTS = [
  { id: "p-camp", title: "Summer Camp", category: "elite", goalId: "g-recruit", goalTitle: "Build Massive Recruiting Network" },
  { id: "p-gear", title: "Gear Order", category: "elite" },
  { id: "p-cut", title: "Cut Plan", category: "bridge" },
  { id: "p-someday", title: "Someday", category: undefined },
];
const PEOPLE = [
  { id: "u-coach", name: "Coach Dana", areas: ["elite"] },
  { id: "u-doc", name: "Dr Reyes", areas: ["bridge"] },
  { id: "u-both", name: "Sam Both", areas: ["bridge", "elite"] },
  { id: "u-none", name: "Nina Nobody", areas: [] },
];

beforeEach(() => localStorage.clear());

const mount = (over: Partial<ComponentProps<typeof TaskSheet>> = {}) => {
  const onSave = vi.fn();
  const view = render(<TaskSheet mode="new" categories={CATS} people={PEOPLE} projects={PROJECTS} goals={GOALS} onSave={onSave} onCancel={() => {}} {...over} />);
  return { onSave, ...view };
};
// The capsule that opens a row's menu (an open menu carries the same label, so the button is the one to press).
const trigger = (label: string) => screen.getAllByLabelText(label).find((el) => el.tagName === "BUTTON")!;
const value = (label: string) => trigger(label).textContent ?? "";
const open = (label: string) => fireEvent.click(trigger(label));
/** What the open menu offers, top to bottom. */
const offered = () => [...screen.getByRole("menu").querySelectorAll(".hmenu-l")].map((el) => el.textContent);
const peek = (label: string) => { open(label); const got = offered(); open(label); return got; };
const pick = (name: string | RegExp, role: "menuitemradio" | "menuitemcheckbox" = "menuitemradio") => fireEvent.click(screen.getByRole(role, { name }));
/** Pick from a single-choice menu: open it, tap the option. */
const choose = (label: string, name: string | RegExp) => { open(label); pick(name); };
/** The Area menu stays open while areas are ticked; tap the capsule to close it. */
const areas = (...names: (string | RegExp)[]) => { open("Area"); for (const n of names) pick(n, "menuitemcheckbox"); open("Area"); };

describe("1. Area first: the pickers list only what is tied to the Area", () => {
  it("with no Area, every menu lists everything, None on top", () => {
    mount();
    expect(peek("Goal")).toEqual(["None", "Body Weight Target", "Build Massive Recruiting Network", "Commit All Athletes", "Read More"]);
    expect(peek("Project")).toEqual(["None", "Cut Plan", "Gear Order", "Summer Camp", "Someday"]);
    expect(peek("Person")).toEqual(["None", "Coach Dana", "Dr Reyes", "Sam Both", "Nina Nobody"]);
  });

  it("Elite Squad: Goal, Project and Person list only the ones tied to it (the screenshot's defect)", () => {
    mount();
    areas(/Elite Squad/);
    expect(peek("Goal")).toEqual(["None", "Build Massive Recruiting Network", "Commit All Athletes"]);
    expect(peek("Project")).toEqual(["None", "Gear Order", "Summer Camp"]);
    expect(peek("Person")).toEqual(["None", "Coach Dana", "Sam Both"]);
  });

  it("a goal or a person tied to two areas is offered under each of them", () => {
    mount();
    areas(/Bridge/);
    expect(peek("Goal")).toEqual(["None", "Body Weight Target", "Commit All Athletes"]);
    expect(peek("Person")).toEqual(["None", "Dr Reyes", "Sam Both"]);
  });

  it("an Area with nothing of a kind leaves that menu with None alone", () => {
    mount();
    areas(/Home/);
    expect(peek("Goal")).toEqual(["None"]);
    expect(peek("Project")).toEqual(["None"]);
    expect(peek("Person")).toEqual(["None"]);
  });

  it("an item with no area is tied to none, so an Area hides it", () => {
    mount();
    areas(/Elite Squad/);
    expect(peek("Goal")).not.toContain("Read More");
    expect(peek("Project")).not.toContain("Someday");
    expect(peek("Person")).not.toContain("Nina Nobody");
  });

  it("a search inside a picker searches the narrowed list", () => {
    mount();
    areas(/Elite Squad/);
    open("Project");
    fireEvent.change(screen.getByLabelText("Search Projects"), { target: { value: "cut" } });
    // Cut Plan is a Bridge project: not in Elite Squad's list, so a search for it finds nothing, and None stays.
    expect(offered()).toEqual(["None"]);
    fireEvent.change(screen.getByLabelText("Search Projects"), { target: { value: "gear" } });
    expect(offered()).toEqual(["None", "Gear Order"]);
    open("Project");
    open("Goal");
    fireEvent.change(screen.getByLabelText("Search Goals"), { target: { value: "body" } });
    expect(offered()).toEqual(["None"]);
    fireEvent.change(screen.getByLabelText("Search Goals"), { target: { value: "commit" } });
    expect(offered()).toEqual(["None", "Commit All Athletes"]);
  });

  it("with several areas ticked, anything tied to any of them", () => {
    mount();
    areas(/Elite Squad/, /Bridge/);
    expect(peek("Goal")).toEqual(["None", "Body Weight Target", "Build Massive Recruiting Network", "Commit All Athletes"]);
    expect(peek("Person")).toEqual(["None", "Coach Dana", "Dr Reyes", "Sam Both"]);
  });

  it("choosing None for the Area lists everything again", () => {
    mount();
    areas(/Elite Squad/);
    open("Area");
    pick("None", "menuitemcheckbox");
    expect(value("Area")).toContain("None");
    expect(peek("Goal")).toHaveLength(5);
  });
});

describe("2. Reverse: a pick made first brings its Area in, and the rest narrow to it", () => {
  it("a Goal first: the Area becomes the goal's, and Project and Person narrow to it", () => {
    mount();
    expect(value("Area")).toContain("None");
    choose("Goal", /Body Weight Target/);
    expect(value("Area")).toContain("Bridge");
    expect(peek("Project")).toEqual(["None", "Cut Plan"]);
    expect(peek("Person")).toEqual(["None", "Dr Reyes", "Sam Both"]);
  });

  it("a goal tied to two areas brings the first it names", () => {
    mount();
    choose("Goal", /Commit All Athletes/);
    expect(value("Area")).toContain("Elite Squad");
  });

  it("a Project first: the Area becomes the project's, its goal shows, and Person narrows", () => {
    mount();
    choose("Project", /Summer Camp/);
    expect(value("Area")).toContain("Elite Squad");
    expect(value("Goal")).toContain("Build Massive Recruiting Network");
    expect(peek("Person")).toEqual(["None", "Coach Dana", "Sam Both"]);
  });

  it("a Person first: the Area becomes theirs (the first they belong to), and Goal and Project narrow", () => {
    mount();
    choose("Person", /Dr Reyes/);
    expect(value("Area")).toContain("Bridge");
    expect(peek("Goal")).toEqual(["None", "Body Weight Target", "Commit All Athletes"]);
    expect(peek("Project")).toEqual(["None", "Cut Plan"]);
  });

  it("a person who belongs to two areas brings the first", () => {
    mount();
    choose("Person", /Sam Both/);
    expect(value("Area")).toContain("Bridge");
  });

  it("a person with no area brings none, and nothing narrows", () => {
    mount();
    choose("Person", /Nina Nobody/);
    expect(value("Person")).toContain("Nina Nobody");
    expect(value("Area")).toContain("None");
    expect(peek("Goal")).toHaveLength(5);
  });

  it("with an Area already chosen, a pick never moves it", () => {
    mount();
    areas(/Elite Squad/);
    choose("Person", /Sam Both/);
    expect(value("Area")).toContain("Elite Squad");
    expect(value("Area")).not.toContain("Bridge");
    choose("Goal", /Commit All Athletes/);
    expect(value("Area")).toContain("Elite Squad");
  });
});

describe("3. A change of Area sends what no longer fits back to None", () => {
  it("switching Elite Squad to Home clears the person and the project", () => {
    const { onSave } = mount();
    areas(/Elite Squad/);
    choose("Person", /Coach Dana/);
    choose("Project", /Gear Order/);
    expect(value("Person")).toContain("Coach Dana");
    expect(value("Project")).toContain("Gear Order");
    // Take Elite Squad off (no Area: nothing is cleared), then put Home on.
    open("Area");
    pick(/Elite Squad/, "menuitemcheckbox");
    expect(value("Person")).toContain("Coach Dana");
    expect(value("Project")).toContain("Gear Order");
    pick(/Home/, "menuitemcheckbox");
    open("Area");
    expect(value("Person")).toContain("None");
    expect(value("Project")).toContain("None");
    fireEvent.change(screen.getByPlaceholderText("What needs doing?"), { target: { value: "Check the roof" } });
    fireEvent.click(screen.getByText("Save"));
    const draft = onSave.mock.calls[0]![0];
    expect(draft.category).toBe("home");
    expect(draft.personId).toBeUndefined();
    expect(draft.projectId).toBeUndefined();
  });

  it("a pick still tied to a remaining area stays; one that is not goes", () => {
    mount();
    areas(/Elite Squad/, /Bridge/);
    choose("Person", /Sam Both/); // elite and bridge
    choose("Goal", /Commit All Athletes/); // elite and bridge
    open("Area");
    pick(/Elite Squad/, "menuitemcheckbox"); // Bridge remains
    open("Area");
    expect(value("Person")).toContain("Sam Both");
    expect(value("Goal")).toContain("Commit All Athletes");
    areas(/Bridge/, /Home/); // Bridge off, Home on
    expect(value("Person")).toContain("None");
    expect(value("Goal")).toContain("None");
  });

  it("a loose goal that is not tied to the new Area goes back to None", () => {
    mount();
    choose("Goal", /Body Weight Target/); // brings Bridge
    expect(value("Area")).toContain("Bridge");
    areas(/Bridge/, /Elite Squad/);
    expect(value("Goal")).toContain("None");
  });

  it("a project goes and takes its goal off the row; a goal tied to the new Area is kept as the pick", () => {
    mount();
    choose("Project", /Summer Camp/); // Elite Squad, goal Build Massive Recruiting Network
    expect(value("Goal")).toContain("Build Massive Recruiting Network");
    areas(/Elite Squad/, /Bridge/);
    expect(value("Project")).toContain("None");
    // That goal is tied to Elite Squad only, so it does not survive Bridge.
    expect(value("Goal")).toContain("None");
  });

  it("choosing None for the Area clears nothing", () => {
    mount();
    areas(/Elite Squad/);
    choose("Person", /Coach Dana/);
    choose("Project", /Gear Order/);
    open("Area");
    pick("None", "menuitemcheckbox");
    expect(value("Person")).toContain("Coach Dana");
    expect(value("Project")).toContain("Gear Order");
  });

  it("saves what is on screen", () => {
    const { onSave } = mount();
    areas(/Elite Squad/);
    choose("Person", /Coach Dana/);
    choose("Project", /Summer Camp/);
    fireEvent.change(screen.getByPlaceholderText("What needs doing?"), { target: { value: "Plan the camp" } });
    fireEvent.click(screen.getByText("Save"));
    const draft = onSave.mock.calls[0]![0];
    expect(draft).toMatchObject({ category: "elite", personId: "u-coach", projectId: "p-camp", goalId: "g-recruit" });
  });
});

describe("a record opened with a link that already disagrees with its Area", () => {
  const initial = { text: "Weigh in", category: "elite", due: "", repeat: "", goalId: "g-weight", personId: "u-doc" };

  it("shows it as it is and keeps it listed: opening never edits a record", () => {
    mount({ mode: "edit", initial });
    expect(value("Area")).toContain("Elite Squad");
    expect(value("Goal")).toContain("Body Weight Target");
    expect(value("Person")).toContain("Dr Reyes");
    expect(peek("Goal")).toEqual(["None", "Body Weight Target", "Build Massive Recruiting Network", "Commit All Athletes"]);
    // The people menu keeps the order the contacts came in; Dr Reyes (Bridge) stays listed among Elite Squad's.
    expect(peek("Person")).toEqual(["None", "Coach Dana", "Dr Reyes", "Sam Both"]);
  });

  it("clears it the moment the Area changes", () => {
    const { onSave } = mount({ mode: "edit", initial });
    areas(/Elite Squad/, /Home/); // Elite Squad off, Home on
    expect(value("Goal")).toContain("None");
    expect(value("Person")).toContain("None");
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0].goalId).toBeUndefined();
    expect(onSave.mock.calls[0]![0].personId).toBeUndefined();
  });

  it("saves it untouched when nothing was changed", () => {
    const { onSave } = mount({ mode: "edit", initial });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ category: "elite", goalId: "g-weight", personId: "u-doc" });
  });
});

describe("the area read out of the name is an Area in force", () => {
  it("narrows the menus, and sends a pick that does not fit back to None", () => {
    mount();
    choose("Person", /Nina Nobody/); // tied to no area, so no Area is brought in
    expect(value("Area")).toContain("None");
    fireEvent.change(screen.getByPlaceholderText("What needs doing?"), { target: { value: "Call Nina #elitesquad" } });
    expect(value("Area")).toContain("Elite Squad");
    expect(value("Person")).toContain("None");
    expect(peek("Person")).toEqual(["None", "Coach Dana", "Sam Both"]);
  });
});
