// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useEffect, useState } from "react";
import { NotesProvider, useProjects, useGoals, useTasks, useCategories } from "../data/NotesProvider";
import LifeFlow from "./LifeFlow";
import { todayISO } from "../tasks/grouping";

// LIFE (ruled 2026-09-01): Tasks and Your Life, one tab, three zoom levels.
// Seeds first, mounts the flow after: the flow reads its lists on mount, and
// the test is about the page, not about live repaints.
// The area is seeded as a real category record, not the bare string "money":
// both lenses group by the ids the frame actually holds, so a made-up id lands
// everything in More Work and proves nothing about the heads.
function Seeded({ segment }: { segment?: "areas" | "tasks" | "projects" | "goals" }) {
  const p = useProjects(); const g = useGoals(); const t = useTasks(); const c = useCategories();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      const money = (await c.create("Money", "green"))!;
      const goalId = await g.create({ title: "Build a six-month runway", state: "on_track", tags: [money] });
      await p.create({ title: "Kitchen remodel", status: "active", goalId: goalId ?? undefined, category: money });
      await t.createTask("Pay the deposit", { category: money, due: todayISO() });
      setReady(true);
    })();
  }, [p, g, t, c]);
  return ready ? <LifeFlow segment={segment} /> : null;
}

describe("LifeFlow", () => {
  // LIFE_AREAS_TAB_HANDOFF (2026-09-16): Areas is the default entry point
  // now, ahead of Tasks -- browsing what an area holds is why Life gets
  // opened more often than any one lens is.
  it("lands on Areas under a head called Life, with the five segments", async () => {
    render(<NotesProvider userId="u1"><Seeded /></NotesProvider>);
    // The seeded category is named "Money", which suggestKind infers as
    // money-kind with no explicit kind set -- the same exclusion Brain's own
    // area list always applied (BrainPage's prior "drops money-kind
    // categories" coverage), so the Areas tab correctly shows none here.
    // The empty state is a title and a sub now, not one string glued by a
    // typed dot (Colour Key, 2026-09-26).
    expect(await screen.findByText("No Areas Yet", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("Add one in Settings > Categories")).toBeInTheDocument();
    expect(screen.queryByText("Money")).not.toBeInTheDocument();
    expect(document.querySelector(".pagehead-title")).toHaveTextContent("Life");
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Areas", "Tasks", "Reminders", "Projects", "Goals"]);
    expect(screen.getByRole("tab", { name: "Areas" })).toHaveAttribute("aria-selected", "true");
  });

  it("Projects groups projects under their AREA with the goal-row anatomy; Goals shows goals only", async () => {
    render(<NotesProvider userId="u1"><Seeded /></NotesProvider>);
    await screen.findByText("No Areas Yet", {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole("tab", { name: "Projects" }));
    // AMENDED 2026-09-18 (the approved card mockup). Projects and Goals open
    // on the CARDS now; this test is about the ruled ROW anatomy, which is
    // the other view, so it asks for that view first. Everything it checks
    // below is unchanged, and the toggle is how a person reaches it too.
    await screen.findByText("Add Project");
    fireEvent.click(screen.getByLabelText("Show as a list"));
    const row = screen.getAllByText("Kitchen remodel").map((e) => e.closest(".task-row")).find(Boolean) as HTMLElement;
    expect(row).toBeTruthy();
    // THE CATEGORY IS THE ORGANIZER (Dave 2026-09-09: "projects should be
    // organized much more like goals. The category should be the main
    // organizer. Right now it's a list of projects"). So the head over a
    // project is its area's, with the area dot, exactly as on the Goals lens,
    // and the goal moved onto the row as its .r-is-goal chip. The row still
    // carries the progress pie where a task's check sits.
    const head = row.closest(".pad-x")!.previousElementSibling as HTMLElement;
    expect(head.className).toMatch(/\bsh2\b/);
    expect(head.querySelector(".cat-dot")).toBeTruthy();
    expect(head.className, "the retired goal head is gone").not.toMatch(/gh-goal/);
    // THE PROJECT ROW IS THE GOAL ROW (Dave 2026-09-13): the folder where the
    // goal row carries its target, the count and the bar under it, no pie.
    expect(row.classList.contains("goal-row-ruled")).toBe(true);
    expect(row.querySelector(".gm-slot")).toBeTruthy();
    expect(row.querySelector(".pp")).toBeNull();
    expect(row.querySelector(".r-is-goal")).toHaveTextContent("Build a six-month runway");
    expect(screen.getByText("Add Project")).toBeInTheDocument();
    expect(screen.queryByText("Add Goal")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Goals" }));
    fireEvent.click(await screen.findByLabelText("Show as a list"));
    const goal = await screen.findByText("Build a six-month runway");
    expect(goal.closest(".task-row.goal-row-ruled")).toBeTruthy();
    expect(document.querySelector(".task-row .pp")).toBeNull();
    expect(screen.getByText("Add Goal")).toBeInTheDocument();
    expect(screen.queryByText("Add Project")).toBeNull();
  });

  // THE LOGBOOK, AND THE BADGE (Dave 2026-09-09: "Done should be marker off
  // like 'on track'. Also should done tasks be in their own area? Whatever
  // the best task management apps do is what we should do"). They fold it
  // away and keep it reachable, so an achieved goal leaves the area cards for
  // a folded receipt, and its row wears the DONE capsule with the finish date
  // on the line -- the status said once, in the place status lives.
  it("an achieved goal leaves the live list for a folded Done section", async () => {
    function DoneSeeded() {
      const g = useGoals(); const c = useCategories();
      const [ready, setReady] = useState(false);
      useEffect(() => {
        void (async () => {
          const money = (await c.create("Money", "green"))!;
          await g.create({ title: "Build a six-month runway", state: "on_track", tags: [money] });
          await g.create({ title: "Get Health Insurance", state: "achieved", achievedOn: "2026-09-04", tags: [money] });
          setReady(true);
        })();
      }, [g, c]);
      return ready ? <LifeFlow segment="goals" /> : null;
    }
    render(<NotesProvider userId="u1"><DoneSeeded /></NotesProvider>);
    await screen.findByText("Build a six-month runway", {}, { timeout: 3000 });
    // Folded: the finished goal is not on screen, only its count.
    expect(screen.queryByText("Get Health Insurance")).toBeNull();
    const receipt = screen.getByText("1 Done goal");
    fireEvent.click(receipt);
    const row = (await screen.findByText("Get Health Insurance")).closest(".goal-row-ruled") as HTMLElement;
    expect(row.querySelector(".gstat")).toHaveTextContent("Done");
    // Said ONCE: the line carries the date, not the word again.
    expect(row.querySelector(".r-goal")).toHaveTextContent("Finished September 4");
  });

  it("a deep link picks its segment over the session memory", async () => {
    render(<NotesProvider userId="u1"><Seeded segment="goals" /></NotesProvider>);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Goals" })).toHaveAttribute("aria-selected", "true"));
  });
});

// THE ONE ASK AS A NOTICE ROW (Goals and Projects, 2026-09-02). On the Life
// tab the stalled-project ask sits in the list with the notice-row anatomy
// (tile, name, one line of why, one pill) instead of the promo card.
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: true, complete: async () => "Call the contractor" }) }));

describe("LifeFlow, the one ask", () => {
  it("renders the stalled project as a notice row with a First Step pill, not a promo card", async () => {
    render(<NotesProvider userId="u2"><Seeded segment="projects" /></NotesProvider>);
    await screen.findByText("Add Project", {}, { timeout: 3000 });
    const pill = await screen.findByRole("button", { name: "First Step" });
    expect(pill.closest(".one-ask-row .stream-card .notice-card")).toBeTruthy();
    expect(document.querySelector(".promo-card")).toBeNull();
    expect(screen.getByText("Nothing is moving here")).toBeInTheDocument();
  });
});

// LIFE-F-07 (2026-09-05): BiggerPictureFlow read openId and openGoalId once,
// in useState initialisers, and LifeFlow only remounts it when the LENS
// changes. So searching a project while already on Life > Projects, or a goal
// on Goals, closed the search onto the list it was already showing. The same
// tap worked from any other tab, because that remounts the flow.
function DeepLinked({ lens }: { lens: "projects" | "goals" }) {
  const p = useProjects(); const g = useGoals();
  const [id, setId] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState<{ value?: string; nonce: number }>({ nonce: 0 });
  useEffect(() => {
    void (async () => {
      const goalId = await g.create({ title: "Build a six-month runway", state: "on_track" });
      const projectId = await p.create({ title: "Kitchen remodel", status: "active", goalId: goalId ?? undefined });
      setId((lens === "projects" ? projectId : goalId) ?? undefined);
    })();
  }, [p, g, lens]);
  return id ? (
    <>
      <button onClick={() => setOpen((o) => ({ value: id, nonce: o.nonce + 1 }))}>Link It</button>
      <LifeFlow
        segment={lens}
        projectOpenId={lens === "projects" ? open.value : undefined}
        projectNonce={open.nonce}
        goalOpenId={lens === "goals" ? open.value : undefined}
        goalNonce={open.nonce}
      />
    </>
  ) : null;
}

describe("a deep link into the lens you are already on (LIFE-F-07)", () => {
  it("opens a project detail that arrives after the lens is mounted", async () => {
    render(<NotesProvider userId="deep-life-1"><DeepLinked lens="projects" /></NotesProvider>);
    await screen.findAllByText("Kitchen remodel", {}, { timeout: 3000 });
    // The list, not the detail: the detail carries its own Back.
    expect(screen.queryByLabelText("Back")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Link It"));
    await waitFor(() => expect(screen.getByLabelText("Back")).toBeInTheDocument());
  });

  it("does the same for a goal on the Goals lens", async () => {
    render(<NotesProvider userId="deep-life-2"><DeepLinked lens="goals" /></NotesProvider>);
    await screen.findAllByText("Build a six-month runway", {}, { timeout: 3000 });
    expect(screen.queryByLabelText("Back")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Link It"));
    await waitFor(() => expect(screen.getByLabelText("Back")).toBeInTheDocument());
  });
});

// SHELL-F-12 (2026-09-05): the task and filter intents were consumed at
// TasksFlow's mount and cleared only by a bottom-tab tap, and LifeFlow
// remounts the lens flow on every segment change. So arriving on a task from
// a note, closing its sheet, tapping Projects and tapping Tasks popped the
// same sheet open by itself, and an arrival through Today's Overdue link
// snapped the filter back to Overdue on every return.
function TaskLinked() {
  const t = useTasks();
  const [id, setId] = useState<string | undefined>(undefined);
  const [intent, setIntent] = useState<{ value?: string; nonce: number }>({ nonce: 0 });
  const [filter, setFilter] = useState<{ value?: string; nonce: number }>({ nonce: 0 });
  useEffect(() => { void (async () => setId((await t.createTask("Pay the deposit", { due: todayISO() })) ?? undefined))(); }, [t]);
  return id ? (
    <>
      <button onClick={() => { setIntent((i) => ({ value: id, nonce: i.nonce + 1 })); setFilter((f) => ({ value: "overdue", nonce: f.nonce + 1 })); }}>Link Task</button>
      <LifeFlow
        segment="tasks"
        taskOpenId={intent.value} taskNonce={intent.nonce} onTaskOpened={() => setIntent((i) => ({ nonce: i.nonce }))}
        taskFilter={filter.value} filterNonce={filter.nonce} onFilterApplied={() => setFilter((f) => ({ nonce: f.nonce }))}
      />
    </>
  ) : null;
}

describe("a task link is spent once (SHELL-F-12)", () => {
  it("does not reopen the sheet, or re-apply the filter, after a segment round trip", async () => {
    render(<NotesProvider userId="deep-life-3"><TaskLinked /></NotesProvider>);
    // START NOW (2026-09-16): A Place to Begin names the top-picked task
    // above the list, so the name can legitimately appear twice here. This
    // test is about the list, so it counts rows rather than names.
    const rows = () => screen.queryAllByText("Pay the deposit").filter((el) => !el.classList.contains("start-top-name"));
    await waitFor(() => expect(rows().length).toBeGreaterThan(0), { timeout: 3000 });
    fireEvent.click(screen.getByText("Link Task"));
    await waitFor(() => expect(screen.getByText("Edit Task")).toBeInTheDocument());
    // AMENDED 2026-09-17 (Unified Headers), then 2026-09-18 when the views
    // became one menu on the header's single control line. The capsule
    // states the view, so it is what names the filter a link asked for. What
    // this test is about -- a link is spent once -- is unchanged.
    const view = () => screen.getByLabelText("View");
    expect(view(), "the header says it is on Overdue").toHaveTextContent("Overdue");

    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(screen.queryByText("Edit Task")).not.toBeInTheDocument());

    // Projects, then back to Tasks: the lens flow unmounts and remounts.
    fireEvent.click(screen.getByRole("tab", { name: "Projects" }));
    await waitFor(() => expect(rows().length).toBe(0));
    fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
    await waitFor(() => expect(rows().length).toBeGreaterThan(0), { timeout: 3000 });

    expect(screen.queryByText("Edit Task")).not.toBeInTheDocument();
    // And the filter is the list's own default, not the one that link carried.
    expect(view()).toHaveTextContent("Today");
  });
});

// LIFE-F-08 (2026-09-05): a project or goal link was consumed at
// BiggerPictureFlow's mount and never cleared, and LifeFlow remounts the lens
// flow on every segment change: arrive on a project detail, go Back, tap Goals
// then Projects, and the detail opened itself over the list.
function ProjectLinked() {
  const p = useProjects(); const g = useGoals();
  const [id, setId] = useState<string | undefined>(undefined);
  const [intent, setIntent] = useState<{ value?: string; nonce: number }>({ nonce: 0 });
  const [seg, setSeg] = useState<"projects" | "goals">("projects");
  useEffect(() => {
    void (async () => {
      const goalId = await g.create({ title: "Build a six-month runway", state: "on_track" });
      setId((await p.create({ title: "Kitchen remodel", status: "active", goalId: goalId ?? undefined })) ?? undefined);
    })();
  }, [p, g]);
  return id ? (
    <>
      <button onClick={() => setIntent((i) => ({ value: id, nonce: i.nonce + 1 }))}>Link It</button>
      <LifeFlow
        segment={seg}
        segmentNav={seg === "projects" ? 1 : 2}
        projectOpenId={intent.value}
        projectNonce={intent.nonce}
        onProjectOpened={() => setIntent((i) => ({ nonce: i.nonce }))}
      />
      <button onClick={() => setSeg(seg === "projects" ? "goals" : "projects")}>Flip Lens</button>
    </>
  ) : null;
}

describe("a project link is spent once (LIFE-F-08)", () => {
  it("does not reopen the detail after a segment round trip", async () => {
    render(<NotesProvider userId="deep-life-4"><ProjectLinked /></NotesProvider>);
    await screen.findAllByText("Kitchen remodel", {}, { timeout: 3000 });
    fireEvent.click(screen.getByText("Link It"));
    await waitFor(() => expect(screen.getByLabelText("Back")).toBeInTheDocument());

    // Back to the list, then Goals, then Projects.
    fireEvent.click(screen.getByLabelText("Back"));
    await waitFor(() => expect(screen.queryByLabelText("Back")).not.toBeInTheDocument());
    fireEvent.click(screen.getByText("Flip Lens"));
    await waitFor(() => expect(screen.getByText("Add Goal")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Flip Lens"));
    await screen.findAllByText("Kitchen remodel", {}, { timeout: 3000 });

    expect(screen.queryByLabelText("Back")).not.toBeInTheDocument();
  });
});
