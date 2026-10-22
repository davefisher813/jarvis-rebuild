// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import ProjectSheet from "./ProjectSheet";
import type { Category } from "../categories/types";
import type { Goal } from "../life/types";

// LINKED PICKERS FILTER BY AREA, BOTH DIRECTIONS (Dave 2026-10-22), on the project sheet: Area and Goal. A goal is tied to the areas it watches
// (its tags); the first one is its home.
const cat = (id: string, name: string, color: Category["data"]["color"]): Category => ({ id, data: { name, color, order: 0 } as Category["data"] });
const CATS = [cat("elite", "Elite Squad", "blue"), cat("bridge", "Bridge", "green"), cat("home", "Home", "yellow")];
const goal = (id: string, title: string, tags: string[]): Goal => ({ id, data: { title, state: "on_track", tags } });
const GOALS = [
  goal("g-weight", "Body Weight Target", ["bridge"]),
  goal("g-recruit", "Build Massive Recruiting Network", ["elite"]),
  goal("g-commit", "Commit All Athletes", ["elite", "bridge"]),
  goal("g-loose", "Read More", []),
  { id: "g-done", data: { title: "Finished Thing", state: "achieved", tags: ["elite"] } } as Goal,
];

const mount = (over: Partial<ComponentProps<typeof ProjectSheet>> = {}) => {
  const onSave = vi.fn();
  render(<ProjectSheet mode="new" categories={CATS} goals={GOALS} onSave={onSave} onCancel={() => {}} {...over} />);
  return { onSave };
};
const trigger = (label: string) => screen.getAllByLabelText(label).find((el) => el.tagName === "BUTTON")!;
const value = (label: string) => trigger(label).textContent ?? "";
const open = (label: string) => fireEvent.click(trigger(label));
const offered = () => [...screen.getByRole("menu").querySelectorAll(".hmenu-l")].map((el) => el.textContent);
const peek = (label: string) => { open(label); const got = offered(); open(label); return got; };
const choose = (label: string, name: string | RegExp) => { open(label); fireEvent.click(screen.getByRole("menuitemradio", { name })); };
const save = (title = "Camp Plan") => { fireEvent.change(screen.getByLabelText("Project title"), { target: { value: title } }); fireEvent.click(screen.getByText("Save")); };

describe("ProjectSheet: the Goal menu follows the Area", () => {
  it("with no Area, every goal that can still be moved is listed (an achieved one is not)", () => {
    mount();
    expect(peek("Goal")).toEqual(["None", "Body Weight Target", "Build Massive Recruiting Network", "Commit All Athletes", "Read More"]);
  });

  it("an Area lists only the goals tied to it, None on top", () => {
    mount();
    choose("Area", /Elite Squad/);
    expect(peek("Goal")).toEqual(["None", "Build Massive Recruiting Network", "Commit All Athletes"]);
    choose("Area", /Bridge/);
    expect(peek("Goal")).toEqual(["None", "Body Weight Target", "Commit All Athletes"]);
  });

  it("an Area with no goals leaves the row, saying None, with None alone to pick", () => {
    mount();
    choose("Area", /Home/);
    expect(value("Goal")).toContain("None");
    expect(peek("Goal")).toEqual(["None"]);
  });

  it("a goal picked first brings its Area in (the first it names)", () => {
    mount();
    choose("Goal", /Commit All Athletes/);
    expect(value("Area")).toContain("Elite Squad");
    // The Area is now in force, so a goal tied to another area is not offered, and a pick never moves the Area.
    expect(peek("Goal")).not.toContain("Body Weight Target");
    choose("Goal", /Build Massive Recruiting Network/);
    expect(value("Area")).toContain("Elite Squad");
  });

  it("a goal with no area brings none", () => {
    mount();
    choose("Goal", /Read More/);
    expect(value("Area")).toContain("None");
  });

  it("changing the Area sends a goal that no longer fits back to None, and it saves that way", () => {
    const { onSave } = mount();
    choose("Area", /Elite Squad/);
    choose("Goal", /Build Massive Recruiting Network/);
    choose("Area", /Bridge/);
    expect(value("Goal")).toContain("None");
    save();
    expect(onSave.mock.calls[0]![0]).toMatchObject({ category: "bridge" });
    expect(onSave.mock.calls[0]![0].goalId).toBeUndefined();
  });

  it("a goal tied to the new Area stays", () => {
    mount();
    choose("Area", /Elite Squad/);
    choose("Goal", /Commit All Athletes/);
    choose("Area", /Bridge/);
    expect(value("Goal")).toContain("Commit All Athletes");
  });

  it("choosing None for the Area clears nothing", () => {
    mount();
    choose("Area", /Elite Squad/);
    choose("Goal", /Build Massive Recruiting Network/);
    choose("Area", "None");
    expect(value("Goal")).toContain("Build Massive Recruiting Network");
    expect(peek("Goal")).toHaveLength(5);
  });

  it("a project born into an Area opens with that Area in force", () => {
    mount({ initial: { category: "bridge" } });
    expect(peek("Goal")).toEqual(["None", "Body Weight Target", "Commit All Athletes"]);
  });
});

describe("ProjectSheet: a record opened with a goal that disagrees with its Area", () => {
  const initial = { title: "Camp Plan", status: "active" as const, category: "elite", goalId: "g-weight" };

  it("shows it, lists it, and saves it untouched", () => {
    const { onSave } = mount({ mode: "edit", initial });
    expect(value("Goal")).toContain("Body Weight Target");
    expect(peek("Goal")).toEqual(["None", "Body Weight Target", "Build Massive Recruiting Network", "Commit All Athletes"]);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ category: "elite", goalId: "g-weight" });
  });

  it("clears it the moment the Area changes", () => {
    mount({ mode: "edit", initial });
    choose("Area", /Home/);
    expect(value("Goal")).toContain("None");
  });
});
