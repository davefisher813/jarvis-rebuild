// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import "@testing-library/jest-dom";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { subscribeToast, resetToasts } from "../shared/toast";
import BiggerPicturePage from "./BiggerPicturePage";
import type { ProjectRow } from "./progress";
import type { GoalReach } from "./reach";

// THE TWO LENSES (§AK and §AM, 2026-09-26). The unlensed single frame these
// tests used to render is gone: Life always mounts this page as one of its
// segments, and its rows stacked up to five greys under one title.
afterEach(cleanup);

const row = (over: Partial<ProjectRow["project"]["data"]> = {}): ProjectRow => ({
  project: { id: "p1", data: { title: "Remodel Bridge Website", status: "active", due: "2026-09-06", ...over } },
  progress: { done: 3, total: 8, pct: 38 },
  stalled: false,
  lastAt: null,
});

const reach = (): GoalReach => ({ progress: null } as unknown as GoalReach);

// THE PROJECTS LENS, BOTH SHAPES (§AK, 2026-09-26): an unstarted project's
// row and card carry its title and nothing under it, never "No tasks yet".
describe("BiggerPicturePage Projects lens, a project with no tasks", () => {
  it("prints no placeholder on the card or on the ruled row", () => {
    const r: ProjectRow = { ...row({ category: "work" }), progress: null };
    const { container } = render(
      <BiggerPicturePage
        lens="projects"
        segments={<div />}
        goals={[]}
        reachOfGoal={reach}
        projectRows={[r]}
        sections={[{ id: "work", name: "Work", color: "blue" }]}
        onAddGoal={() => {}}
        onOpenGoal={() => {}}
        onAddProject={() => {}}
        onOpenProject={() => {}}
      />,
    );
    expect(container.textContent).toContain("Remodel Bridge Website");
    expect(container.textContent).not.toMatch(/No tasks yet/);
    fireEvent.click(container.querySelector(".bp-viewtog")!);
    expect(container.querySelector(".proj-row-ruled")).toBeTruthy();
    expect(container.textContent).not.toMatch(/No tasks yet/);
    // Not even an empty meter line holding its margin under the title.
    expect(container.querySelector(".proj-row-ruled .goal-meter")).toBeNull();
  });
});

// THE NOUN AGREES WITH THE NUMBER (2026-10-05, the perfect bar: "0 OF 1 TASKS" on a project card, "0 of 1 Projects Done" on a goal's).
describe("BiggerPicturePage project card count", () => {
  const card = (progress: ProjectRow["progress"]) => render(
    <BiggerPicturePage
      lens="projects" segments={<div />} goals={[]} reachOfGoal={reach}
      projectRows={[{ ...row({ category: "work" }), progress }]}
      sections={[{ id: "work", name: "Work", color: "blue" }]}
      onAddGoal={() => {}} onOpenGoal={() => {}} onAddProject={() => {}} onOpenProject={() => {}}
    />,
  ).container.querySelector(".bp-card-n")?.textContent;
  it("says '0 of 1 Task' for one and '3 of 8 Tasks' for many", () => {
    expect(card({ done: 0, total: 1, pct: 0 })).toBe("0 of 1 Task");
    expect(card({ done: 3, total: 8, pct: 38 })).toBe("3 of 8 Tasks");
  });
});

// THE GOALS LENS LOGBOOK (§AM F5, 2026-09-26): a finished goal's line is its
// finish date, drawn as a neutral date, with nothing in it bolded.
describe("BiggerPicturePage Goals lens, a finished goal", () => {
  it("draws the finish date as a .fact.date", () => {
    const g = { id: "g1", data: { title: "Run a Half", state: "achieved" as const, achievedOn: "2026-09-12", tags: ["health"] } };
    const { container, getByText } = render(
      <BiggerPicturePage
        lens="goals"
        segments={<div />}
        goals={[g]}
        reachOfGoal={reach}
        projectRows={[]}
        sections={[{ id: "health", name: "Health", color: "green" }]}
        statusOf={() => ({ text: "Done", tone: "good" })}
        onAddGoal={() => {}}
        onOpenGoal={() => {}}
        onAddProject={() => {}}
        onOpenProject={() => {}}
      />,
    );
    fireEvent.click(container.querySelector(".bp-viewtog")!);
    fireEvent.click(getByText(/1 Done Goal/i).closest("button")!);
    const meter = container.querySelector(".goal-row-ruled .goal-meter") as HTMLElement;
    expect(meter.querySelector(".fact.date")?.textContent).toBe("Finished September 12");
    expect(meter.querySelector("b")).toBeNull();
  });
});

// DAVE'S AUDIT, 2026-10-04: "does Show Everything actually do anything?" With a status or an area narrowing the list it
// resets both and says so; with nothing narrowing it, the row is a status line and not a button that does nothing.
describe("BiggerPicturePage Goals Options sheet", () => {
  const goals = [
    { id: "g1", data: { title: "Run Three Times a Week", state: "on_track" as const, tags: ["health"] } },
    { id: "g2", data: { title: "Run a Half", state: "achieved" as const, achievedOn: "2026-09-12", tags: ["health"] } },
  ];
  const page = () => render(
    <BiggerPicturePage lens="goals" segments={<div />} goals={goals} reachOfGoal={reach} projectRows={[]}
      sections={[{ id: "health", name: "Health", color: "green" }]}
      onAddGoal={() => {}} onOpenGoal={() => {}} onAddProject={() => {}} onOpenProject={() => {}} />,
  );
  const toasts: string[] = [];
  let stop = () => {};
  beforeEach(() => { toasts.length = 0; stop = subscribeToast((t) => { if (t) toasts.push(t.message); }); });
  afterEach(() => { stop(); resetToasts(); });

  it("narrowed to Active, Show Everything names what it was showing, widens the list, confirms, and closes", () => {
    const { container } = page();
    expect(container.textContent).not.toContain("Run a Half");
    fireEvent.click(screen.getByLabelText("Goals Options"));
    expect(document.querySelector(".opt-val")?.textContent).toBe("Active");
    fireEvent.click(screen.getByText("Show Everything"));
    expect(document.querySelector(".opt-bar")).toBeNull();
    expect(container.textContent).toContain("Run a Half");
    expect(toasts).toContain("Showing Everything");
  });

  it("already showing everything: no button that does nothing, a status line that says so", () => {
    const { container } = page();
    fireEvent.click(screen.getByLabelText("Goals Options"));
    fireEvent.click(screen.getByText("Show Everything"));
    fireEvent.click(screen.getByLabelText("Goals Options"));
    const row = screen.getByText("Showing Everything").closest(".row")!;
    expect(row.getAttribute("role")).toBeNull();
    expect(row.querySelector(".chev")).toBeNull();
    expect(screen.queryByText("Show Everything")).toBeNull();
    // Done still dismisses it.
    fireEvent.click(document.querySelector(".opt-done")!);
    expect(document.querySelector(".opt-bar")).toBeNull();
    expect(container.textContent).toContain("Run a Half");
  });
});

// 2026-10-04: the Done receipt at the foot of the Active view counted and
// listed EVERY finished project or goal, whatever the Area menu or the search
// box had chosen: Area = Work still read "3 Done Projects" and opened Home's.
describe("BiggerPicturePage: the Done receipt obeys the Area cut and the search", () => {
  const pr = (id: string, title: string, category: string, status: string): ProjectRow => ({
    project: { id, data: { title, status, category, due: "2026-09-06" } as ProjectRow["project"]["data"] },
    progress: { done: 1, total: 2, pct: 50 }, stalled: false, lastAt: null,
  });
  const sections = [{ id: "work", name: "Work", color: "blue" }, { id: "home", name: "Home", color: "green" }];
  const projects = [
    pr("a", "Work Live", "work", "active"),
    pr("b", "Work Done", "work", "done"),
    pr("c", "Home Done One", "home", "done"),
    pr("d", "Home Done Two", "home", "done"),
  ];
  const goalRow = (id: string, title: string, area: string) => ({ id, data: { title, state: "achieved" as const, achievedOn: "2026-09-12", tags: [area] } });
  const pickArea = (name: string) => {
    fireEvent.click(document.querySelector('.hdr-controls .dd[aria-label="Area"]')!);
    fireEvent.click(screen.getByRole("menuitemradio", { name }));
  };
  const projectsPage = () => render(
    <BiggerPicturePage lens="projects" segments={<div />} goals={[]} reachOfGoal={reach} projectRows={projects} sections={sections}
      onAddGoal={() => {}} onOpenGoal={() => {}} onAddProject={() => {}} onOpenProject={() => {}} />,
  );
  const goalsPage = () => render(
    <BiggerPicturePage lens="goals" segments={<div />} reachOfGoal={reach} projectRows={[]} sections={sections}
      goals={[goalRow("g1", "Run a Half", "home"), goalRow("g2", "Ship the Site", "work"), goalRow("g3", "Ship the Deck", "work")]}
      onAddGoal={() => {}} onOpenGoal={() => {}} onAddProject={() => {}} onOpenProject={() => {}} />,
  );
  const receipt = () => document.querySelector(".receipt-line .rl-t")?.textContent;

  it("Area counts and opens only that area's finished projects", () => {
    projectsPage();
    expect(receipt()).toBe("3 Done Projects");
    pickArea("Work");
    expect(receipt()).toBe("1 Done Project");
    fireEvent.click(document.querySelector(".receipt-line")!);
    expect(screen.getByText("Work Done")).toBeInTheDocument();
    expect(screen.queryByText("Home Done One")).toBeNull();
    expect(screen.queryByText("Home Done Two")).toBeNull();
  });

  it("the search counts only the finished projects it matches, and a search matching none draws no receipt", () => {
    projectsPage();
    fireEvent.change(screen.getByPlaceholderText("Search Projects"), { target: { value: "two" } });
    expect(receipt()).toBe("1 Done Project");
    fireEvent.change(screen.getByPlaceholderText("Search Projects"), { target: { value: "zzz" } });
    expect(receipt()).toBeUndefined();
  });

  it("the Goals lens does the same for achieved goals", () => {
    goalsPage();
    expect(receipt()).toBe("3 Done Goals");
    pickArea("Home");
    expect(receipt()).toBe("1 Done Goal");
    fireEvent.click(document.querySelector(".receipt-line")!);
    expect(screen.getByText("Run a Half")).toBeInTheDocument();
    expect(screen.queryByText("Ship the Site")).toBeNull();
    pickArea("All Areas");
    fireEvent.change(screen.getByPlaceholderText("Search Goals"), { target: { value: "deck" } });
    expect(receipt()).toBe("1 Done Goal");
  });
});

// THE CATALOG HARD GATE (Dave 2026-10-05): Title Case on every line the app
// writes, and a separator is drawn by CSS, never typed into a string (R6). The
// search scope read "Active projects" beside Tasks' "Today Tasks"; the Options
// sheet's value baked a middle dot ("Active \u00b7 Health", "All Statuses \u00b7
// All Areas") into one grey run.
describe("BiggerPicturePage: the catalog (scope words, Options value)", () => {
  const goals = [
    { id: "g1", data: { title: "Run Three Times a Week", state: "on_track" as const, tags: ["health"] } },
    { id: "g2", data: { title: "Run a Half", state: "achieved" as const, achievedOn: "2026-09-12", tags: ["health"] } },
  ];
  const sections = [{ id: "health", name: "Health", color: "green" }];
  const goalsPage = () => render(
    <BiggerPicturePage lens="goals" segments={<div />} goals={goals} reachOfGoal={reach} projectRows={[]}
      sections={sections} onAddGoal={() => {}} onOpenGoal={() => {}} onAddProject={() => {}} onOpenProject={() => {}} />,
  );
  const projectsPage = () => render(
    <BiggerPicturePage lens="projects" segments={<div />} goals={[]} reachOfGoal={reach} projectRows={[row({ category: "health" })]}
      sections={sections} onAddGoal={() => {}} onOpenGoal={() => {}} onAddProject={() => {}} onOpenProject={() => {}} />,
  );
  const scope = () => document.querySelector(".hdr-scope-n")?.textContent ?? "";

  it("the scope's place is Title Case on both lenses", () => {
    goalsPage();
    fireEvent.change(screen.getByPlaceholderText("Search Goals"), { target: { value: "run" } });
    expect(scope()).toBe("1 Result in Active Goals");
    cleanup();
    projectsPage();
    fireEvent.change(screen.getByPlaceholderText("Search Projects"), { target: { value: "remodel" } });
    expect(scope()).toBe("1 Result in Active Projects");
  });

  it("the Options value is one comma list, never a middle dot in the string", () => {
    goalsPage();
    // Narrow by area so the value carries two answers.
    fireEvent.click(document.querySelector('.hdr-controls .dd[aria-label="Area"]')!);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Health/ }));
    fireEvent.click(screen.getByLabelText("Goals Options"));
    const narrowed = document.querySelector(".opt-val")!.textContent!;
    expect(narrowed).toBe("Active, Health");
    expect(narrowed).not.toContain("\u00b7");
    fireEvent.click(screen.getByText("Show Everything"));
    fireEvent.click(screen.getByLabelText("Goals Options"));
    const all = document.querySelector(".opt-val")!.textContent!;
    expect(all).toBe("All Statuses, All Areas");
    expect(all).not.toContain("\u00b7");
  });
});

// CLEAN ROWS, SECTION ACTIONS ON THE HEAD (Dave 2026-10-05, locked). The Add Project and Add Goal rows that ended the lists, and
// the lone capsule under a list with no receipt, are gone: the header's New Project and New Goal are the one door. A project
// whose work is all done wears no Close capsule: Close is its swipe and one quiet word on the row.
describe("BiggerPicturePage: no foot adds, no pill on a row", () => {
  const closable = (): ProjectRow => ({ ...row({ category: "work" }), progress: { done: 3, total: 3, pct: 100 } });
  const lens = (l: "projects" | "goals", extra: Record<string, unknown> = {}) =>
    render(
      <BiggerPicturePage
        lens={l}
        segments={<div />}
        goals={l === "goals" ? [{ id: "g1", data: { title: "Run a Half", state: "on_track" as const, tags: ["work"] } }] : []}
        reachOfGoal={reach}
        projectRows={l === "projects" ? [closable()] : []}
        sections={[{ id: "work", name: "Work", color: "blue" }]}
        onAddGoal={() => {}}
        onOpenGoal={() => {}}
        onAddProject={() => {}}
        onOpenProject={() => {}}
        {...extra}
      />,
    );

  it("the Projects lens ends with no Add Project row, and the header holds the one Add", () => {
    const onAddProject = vi.fn();
    const { container } = lens("projects", { onAddProject });
    fireEvent.click(container.querySelector(".bp-viewtog")!);
    expect(screen.queryByText("Add Project")).toBeNull();
    expect(container.querySelectorAll(".row-create, .row-act, .list-tail")).toHaveLength(0);
    fireEvent.click(screen.getByLabelText("New Project"));
    expect(onAddProject).toHaveBeenCalledTimes(1);
  });

  it("the Goals lens ends with no Add Goal row, and the header holds the one Add", () => {
    const onAddGoal = vi.fn();
    const { container } = lens("goals", { onAddGoal });
    fireEvent.click(container.querySelector(".bp-viewtog")!);
    expect(screen.queryByText("Add Goal")).toBeNull();
    expect(container.querySelectorAll(".row-create, .row-act")).toHaveLength(0);
    fireEvent.click(screen.getByLabelText("New Goal"));
    expect(onAddGoal).toHaveBeenCalledTimes(1);
  });

  it("a project with all its work done shows Close as a swipe and one quiet word, never a capsule", () => {
    const onClose = vi.fn();
    const { container } = lens("projects", { onCloseProject: onClose });
    fireEvent.click(container.querySelector(".bp-viewtog")!);
    expect(container.querySelectorAll(".pill-act, .proj-close")).toHaveLength(0);
    expect(container.querySelector(".proj-row-ruled .row-ctx")).toHaveTextContent("Close");
    expect([...container.querySelectorAll(".task-swipe > .task-verb")].map((b) => b.textContent)).toEqual(["Close"]);
    fireEvent.click(container.querySelector(".proj-row-ruled .row-ctx")!);
    expect(onClose).toHaveBeenCalledWith("p1");
  });
});
