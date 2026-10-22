// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useCategories, useGoals, useProjects } from "../data/NotesProvider";
import ProjectDetailPage from "./ProjectDetailPage";
import type { Project, ProjectData } from "./types";
import type { ProjectsService } from "./ProjectsService";

// LINKED PICKERS FILTER BY AREA, BOTH DIRECTIONS (Dave 2026-10-22), on the project page's own rows. These two save the moment they are picked,
// so each rule lands in one write: the Goal menu lists what is tied to the Area, a goal picked with no Area brings its own in, and an Area a
// goal no longer fits sends it back to None.
let svc: ProjectsService;
let ids: Record<string, string> = {};

function Page({ start }: { start: (ids: Record<string, string>) => Partial<ProjectData> }) {
  const cats = useCategories();
  const goals = useGoals();
  const projects = useProjects();
  const [project, setProject] = useState<Project | null>(null);
  useEffect(() => {
    svc = projects;
    void (async () => {
      const elite = (await cats.create("Elite Squad", "blue"))!;
      const bridge = (await cats.create("Bridge", "green"))!;
      const home = (await cats.create("Home", "yellow"))!;
      const gWeight = (await goals.create({ title: "Body Weight Target", state: "on_track", tags: [bridge] }))!;
      const gRecruit = (await goals.create({ title: "Build Massive Recruiting Network", state: "on_track", tags: [elite] }))!;
      const gCommit = (await goals.create({ title: "Commit All Athletes", state: "on_track", tags: [elite, bridge] }))!;
      const gLoose = (await goals.create({ title: "Read More", state: "on_track" }))!;
      ids = { elite, bridge, home, gWeight, gRecruit, gCommit, gLoose };
      const id = (await projects.create({ title: "Camp Plan", status: "active", ...start(ids) }))!;
      ids.project = id;
      setProject(await projects.get(id));
    })();
  }, []);
  return project ? <ProjectDetailPage project={project} onBack={() => {}} onEdit={() => {}} steps={[]} today="2026-10-22" /> : null;
}

const mount = (start: (ids: Record<string, string>) => Partial<ProjectData> = () => ({})) =>
  render(<NotesProvider userId="proj-area-links"><Page start={start} /></NotesProvider>);
const trigger = (label: string) => screen.getAllByLabelText(label).find((el) => el.tagName === "BUTTON")!;
const value = (label: string) => trigger(label).textContent ?? "";
const open = (label: string) => fireEvent.click(trigger(label));
const offered = () => [...screen.getByRole("menu").querySelectorAll(".hmenu-l")].map((el) => el.textContent);
const peek = (label: string) => { open(label); const got = offered(); open(label); return got; };
const choose = (label: string, name: string | RegExp) => { open(label); fireEvent.click(screen.getByRole("menuitemradio", { name })); };
const ready = () => waitFor(() => { expect(screen.getAllByLabelText("Goal").some((e) => e.tagName === "BUTTON")).toBe(true); });
const saved = async () => (await svc.get(ids.project!))!.data;

beforeEach(() => { localStorage.clear(); ids = {}; });

describe("the project page: the Goal row follows the Area", () => {
  it("with an Area, the Goal menu lists only the goals tied to it, None on top", async () => {
    mount((i) => ({ category: i.elite }));
    await ready();
    expect(peek("Goal")).toEqual(["None", "Build Massive Recruiting Network", "Commit All Athletes"]);
  });

  it("with no Area, every goal is listed", async () => {
    mount();
    await ready();
    expect(peek("Goal")).toEqual(["None", "Body Weight Target", "Build Massive Recruiting Network", "Commit All Athletes", "Read More"]);
  });

  it("an Area with no goals leaves the Goal menu with None alone", async () => {
    mount((i) => ({ category: i.home }));
    await ready();
    expect(peek("Goal")).toEqual(["None"]);
  });

  it("a goal picked with no Area brings its Area in, on screen and in the saved project", async () => {
    mount();
    await ready();
    choose("Goal", /Body Weight Target/);
    expect(value("Area")).toContain("Bridge");
    await waitFor(async () => { const d = await saved(); expect(d.category).toBe(ids.bridge); expect(d.goalId).toBe(ids.gWeight); });
  });

  it("with an Area already set, a goal pick never moves it", async () => {
    mount((i) => ({ category: i.elite }));
    await ready();
    choose("Goal", /Commit All Athletes/);
    expect(value("Area")).toContain("Elite Squad");
    await waitFor(async () => { expect((await saved()).category).toBe(ids.elite); });
  });

  it("changing the Area sends a goal that no longer fits back to None, in the same save", async () => {
    mount((i) => ({ category: i.elite, goalId: i.gRecruit }));
    await ready();
    expect(value("Goal")).toContain("Build Massive Recruiting Network");
    choose("Area", /Bridge/);
    expect(value("Goal")).toContain("None");
    await waitFor(async () => { const d = await saved(); expect(d.category).toBe(ids.bridge); expect(d.goalId).toBeUndefined(); });
  });

  it("a goal tied to the new Area stays", async () => {
    mount((i) => ({ category: i.elite, goalId: i.gCommit }));
    await ready();
    choose("Area", /Bridge/);
    expect(value("Goal")).toContain("Commit All Athletes");
    await waitFor(async () => { expect((await saved()).goalId).toBe(ids.gCommit); });
  });

  it("choosing None for the Area clears nothing", async () => {
    mount((i) => ({ category: i.elite, goalId: i.gRecruit }));
    await ready();
    choose("Area", "None");
    expect(value("Goal")).toContain("Build Massive Recruiting Network");
    await waitFor(async () => { const d = await saved(); expect(d.category).toBeUndefined(); expect(d.goalId).toBe(ids.gRecruit); });
  });

  it("a page opened with a goal that already disagrees shows it, lists it, and edits nothing", async () => {
    mount((i) => ({ category: i.elite, goalId: i.gWeight }));
    await ready();
    expect(value("Goal")).toContain("Body Weight Target");
    expect(peek("Goal")).toEqual(["None", "Body Weight Target", "Build Massive Recruiting Network", "Commit All Athletes"]);
    expect((await saved()).goalId).toBe(ids.gWeight);
  });
});
