// @vitest-environment jsdom
//
// THE LIFE AREA PAGES, FIX ROUND 3 (Dave 2026-10-05, "Everything should look PERFECT"). Each case renders the real CategoryDetail
// and asserts a property the round-2 review found drawn wrong. Every one fails on the tree before the round-3 fixes.
import { describe, it, expect, beforeEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useCategories, useProjects, useSchedule } from "../data/NotesProvider";
import CategoryDetail from "./CategoryDetail";
import { todayISO } from "../tasks/grouping";
import { addDays } from "../schedule/calendar";
import { eventLog } from "../events";

function Area({ name = "Family", color = "pink", seed, props }: {
  name?: string; color?: string;
  seed?: (ctx: { id: string; tasks: ReturnType<typeof useTasks>; projects: ReturnType<typeof useProjects>; schedule: ReturnType<typeof useSchedule> }) => Promise<void>;
  props?: Partial<React.ComponentProps<typeof CategoryDetail>>;
}) {
  const cats = useCategories();
  const tasks = useTasks();
  const projects = useProjects();
  const schedule = useSchedule();
  const [cid, setCid] = useState("");
  useEffect(() => {
    void (async () => {
      const id = (await cats.create(name, color as never))!;
      if (seed) await seed({ id, tasks, projects, schedule });
      setCid(id);
    })();
  }, [cats, tasks, projects, schedule, name, color, seed]);
  return cid ? <CategoryDetail categoryId={cid} onBack={() => {}} {...props} /> : null;
}

const today = todayISO();
// The completion log lives in device storage and ids restart per provider, so a tick from one case must not be a tick in the next.
beforeEach(() => { try { localStorage.clear(); } catch { /* storage is best-effort */ } eventLog.clear(); });
// His typed title, shown in Title Case: the small words stay lower.
const SHOWN = "Fall Clinic Walkthrough with the Whole Staff";
const rowOf = (name: string) => [...document.querySelectorAll(".task-row .task-name")].find((e) => e.textContent === name)!.closest(".task-row") as HTMLElement;

describe("an area page's rows say their state as text, never a filled chip (D10)", () => {
  const seed = async ({ id, tasks, projects }: Parameters<NonNullable<React.ComponentProps<typeof Area>["seed"]>>[0]) => {
    const pid = await projects.create({ title: "Golf Event", category: id, status: "active" });
    const done = await tasks.createTask("Print Programs", { category: id, projectId: pid! });
    await tasks.toggleDone(done!);
    await tasks.createTask("Send Thank-You Notes", { category: id, projectId: pid!, due: today });
    await tasks.createTask("Call Ridgeline", { category: id, due: today });
  };

  it("the project row's done count and next day are facts in the key, and no .uchip is drawn in any row", async () => {
    render(<NotesProvider userId="r3-chips"><Area seed={seed} /></NotesProvider>);
    await waitFor(() => expect(document.querySelector(".proj-row-ruled")).not.toBeNull());
    const row = document.querySelector(".proj-row-ruled") as HTMLElement;
    expect(within(row).getByText("1 Done")).toHaveClass("fact", "good");
    expect(within(row).getByText("Today")).toHaveClass("fact", "warn");
    expect(document.querySelector(".uchip")).toBeNull();
  });

  it("an Up Next task due today says Today in amber text", async () => {
    render(<NotesProvider userId="r3-chips2"><Area seed={seed} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Call Ridgeline")).toBeInTheDocument());
    const row = rowOf("Call Ridgeline");
    expect(within(row).getByText("Today")).toHaveClass("fact", "warn");
    expect(row.querySelector(".uchip")).toBeNull();
  });

  it("an Up Next row leaves off the area the page is already in, and keeps a project it belongs to", async () => {
    render(<NotesProvider userId="r3-area"><Area seed={seed} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Call Ridgeline")).toBeInTheDocument());
    const loose = rowOf("Call Ridgeline");
    expect(within(loose).queryByText("Family")).toBeNull();
    const moved = rowOf("Send Thank-You Notes");
    expect(within(moved).getByText("Golf Event")).toBeInTheDocument();
    expect(within(moved).queryByText("Family")).toBeNull();
  });
});

describe("Coming Up", () => {
  const seed = async ({ id, schedule }: Parameters<NonNullable<React.ComponentProps<typeof Area>["seed"]>>[0]) => {
    await schedule.createEvent("Fall Clinic Walkthrough With The Whole Staff", { date: today, start: "15:30", end: "16:30", category: id });
    await schedule.createEvent("Calder Summer Cookout Planning", { date: addDays(today, 3), start: "18:30", end: "19:30", category: id });
  };

  it("the title is a .sched-t so it wraps to two lines and ends in an ellipsis, never a cut letter", async () => {
    render(<NotesProvider userId="r3-up1"><Area seed={seed} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(SHOWN)).toBeInTheDocument());
    expect(screen.getByText(SHOWN)).toHaveClass("sched-t");
    expect(screen.getByText(SHOWN).closest(".sched-title")).not.toBeNull();
  });

  it("the area and the day are two facts, with no typed middle dot, Today in amber and a later day a neutral date", async () => {
    render(<NotesProvider userId="r3-up2"><Area seed={seed} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(SHOWN)).toBeInTheDocument());
    const card = document.querySelector(".sched-coming") as HTMLElement;
    expect(card.querySelector(".sched-sep")).toBeNull();
    expect(card.textContent).not.toContain("·");
    const rows = [...card.querySelectorAll(".sched-row")] as HTMLElement[];
    expect(rows).toHaveLength(2);
    const day = (r: HTMLElement) => r.querySelector(".sched-cat > .fact:nth-of-type(2)") as HTMLElement;
    expect(day(rows[0]!)).toHaveClass("fact", "warn");
    expect(day(rows[0]!)).toHaveTextContent("Today");
    expect(day(rows[1]!)).toHaveClass("fact", "date");
    // The area is a fact of its own, so the facts line draws the dot between the two.
    expect(rows[0]!.querySelector(".sched-cat > .fact:first-child")).toHaveTextContent("Family");
  });

  it("the read-only rows take the card's left inset (no lead slot held back for a star or a rail)", async () => {
    render(<NotesProvider userId="r3-up3"><Area seed={seed} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Calder Summer Cookout Planning")).toBeInTheDocument());
    for (const r of document.querySelectorAll(".sched-coming .sched-row")) expect(r).toHaveClass("sched-row-bare");
  });
});

describe("a repeated tick is one completion", () => {
  it("a task ticked, un-ticked and ticked again lists once under This Week and counts once", async () => {
    const seed = async ({ id, tasks }: Parameters<NonNullable<React.ComponentProps<typeof Area>["seed"]>>[0]) => {
      const tid = await tasks.createTask("Ship The New Landing Hero", { category: id });
      await tasks.toggleDone(tid!);
      await tasks.toggleDone(tid!);
      await tasks.toggleDone(tid!);
    };
    render(<NotesProvider userId="r3-dup"><Area seed={seed} name="Work" color="blue" /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("This Week")).toBeInTheDocument());
    expect(screen.getAllByText("Ship the New Landing Hero")).toHaveLength(1);
    const tile = screen.getByText("done").closest(".stat-tile") as HTMLElement;
    expect(within(tile).getByText("1")).toHaveClass("st-n");
  });
});

describe("an area with nothing in it is one crafted empty state", () => {
  it("draws a glyph in the area's colour, a title, one warm line and ONE capsule, not four bare heads", async () => {
    render(<NotesProvider userId="r3-empty"><Area name="Personal" color="purple" /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Nothing in Personal Yet")).toBeInTheDocument());
    const state = document.querySelector(".empty-state") as HTMLElement;
    expect(state.querySelector(".empty-icon.cat-fg-purple")).not.toBeNull();
    expect(state.querySelector(".empty-sub")).toHaveTextContent(/Lands Here/);
    expect(state.querySelectorAll("button")).toHaveLength(1);
    for (const head of ["Projects", "Goals Here", "Coming Up", "Up Next"]) expect(screen.queryByText(head)).toBeNull();
    for (const add of ["Add Project", "Add Goal", "Add Event", "Add Task"]) expect(screen.queryByText(add)).toBeNull();
  });

  it("the one capsule opens the four things an area holds", async () => {
    render(<NotesProvider userId="r3-empty2"><Area name="Personal" color="purple" /></NotesProvider>);
    fireEvent.click(await screen.findByText("Add"));
    for (const label of ["Add Task", "Add Event", "Add Project", "Add Goal"]) expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("the moment it holds anything, all four sections stand again", async () => {
    const seed = async ({ id, tasks }: Parameters<NonNullable<React.ComponentProps<typeof Area>["seed"]>>[0]) => { await tasks.createTask("Renew Passport", { category: id }); };
    render(<NotesProvider userId="r3-empty3"><Area name="Personal" color="purple" seed={seed} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Up Next")).toBeInTheDocument());
    for (const head of ["Projects", "Goals Here", "Coming Up", "Up Next"]) expect(screen.getByText(head)).toBeInTheDocument();
    expect(screen.queryByText("Nothing in Personal Yet")).toBeNull();
  });
});

describe("Your People with nobody tagged", () => {
  it("is the app's empty state (glyph, title, a line that says the whole area name) and Open Contacts is a capsule in the head", async () => {
    render(<NotesProvider userId="r3-people"><Area name="Family" color="pink" props={{ onOpenContacts: () => {} }} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("No People Here Yet")).toBeInTheDocument());
    const state = screen.getByText("No People Here Yet").closest(".empty-state") as HTMLElement;
    expect(state.querySelector(".empty-icon")).not.toBeNull();
    // The whole sentence, wrapping: the area name is never lost to an ellipsis.
    expect(state.querySelector(".empty-sub")).toHaveTextContent("Tag Someone in Contacts as Family");
    expect(state.closest(".task-row")).toBeNull();
    expect(screen.getByText("Open Contacts")).toHaveClass("see-all", "pill-action");
  });
});
