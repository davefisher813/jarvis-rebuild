// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useEffect, useState } from "react";
import { NotesProvider, useGoals, useProjects, useTasks, useCategories } from "../data/NotesProvider";
import type { GoalService } from "../life/GoalService";
import type { TasksService } from "../tasks/TasksService";
import type { ProjectsService } from "../projects/ProjectsService";
import { subscribeToast } from "../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";
import BiggerPictureFlow from "./BiggerPictureFlow";

// LIFE-F-18 (2026-09-05): "Savings entries are dated in UTC." Logging $200
// to a savings goal at 9pm Eastern on the 31st dated the receipt row the 1st
// and the month rollup counted it there. The entry must carry the local day.

let goalsRef: { svc: GoalService; id: string } | null = null;
function Seed() {
  const goals = useGoals();
  const [id, setId] = useState("");
  useEffect(() => {
    (async () => {
      const gid = await goals.create({ title: "Emergency Fund", state: "on_track", moneyTarget: 5000 });
      goalsRef = { svc: goals, id: gid! };
      setId(gid!);
    })();
  }, [goals]);
  return id ? <BiggerPictureFlow openGoalId={id} /> : null;
}

describe("BiggerPictureFlow savings (LIFE-F-18)", () => {
  it("dates a savings entry on the local day, late in the evening east of the UTC midnight", async () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    // 9pm Eastern on Aug 31 is already Sept 1 in UTC.
    vi.useFakeTimers({ now: new Date("2026-08-31T21:00:00"), toFake: ["Date"] });
    try {
      render(<NotesProvider userId="u-savings-tz"><Seed /></NotesProvider>);
      fireEvent.click(await screen.findByText("Add to Savings"));
      fireEvent.change(screen.getByLabelText("Amount in dollars"), { target: { value: "200" } });
      fireEvent.click(screen.getByText("Save"));
      await waitFor(async () => {
        const g = await goalsRef!.svc.get(goalsRef!.id);
        expect(g?.data.saved).toEqual([{ d: "2026-08-31", amount: 200 }]);
      });
    } finally {
      vi.useRealTimers();
      process.env.TZ = prevTz;
    }
  });
});

// LIFE-F-14 (2026-09-05): the Edit Task sheet opened from inside a project
// predated multi-category, recurrence and plans. It showed Repeat as None and
// no Project row, and its Save wrote setCategory, which replaces the whole
// set: opening a step and pressing Save wiped every extra area off it.

let stepRef: { tasks: TasksService; id: string } | null = null;

function SeedStep() {
  const projects = useProjects();
  const tasks = useTasks();
  const cats = useCategories();
  const [pid, setPid] = useState("");
  useEffect(() => {
    (async () => {
      const work = (await cats.create("Work", "blue"))!;
      const family = (await cats.create("Family", "green"))!;
      const projectId = (await projects.create({ title: "Remodel", status: "active", category: work }))!;
      const id = (await tasks.createTask("Call the contractor", {
        projectId, category: work, extraCategories: [family], due: "2026-09-20", recurrence: "weekly",
      }))!;
      stepRef = { tasks, id };
      setPid(projectId);
    })();
  }, [projects, tasks, cats]);
  return pid ? <BiggerPictureFlow openId={pid} /> : null;
}

describe("BiggerPictureFlow step editing (LIFE-F-14)", () => {
  it("saving a project's step keeps its extra areas, repeat and project", async () => {
    render(<NotesProvider userId="u-step-f14"><SeedStep /></NotesProvider>);
    fireEvent.click(await screen.findByText("Call the contractor"));
    await screen.findByText("Edit Task");
    // The sheet knows what this task already is, so the rows it hid before
    // are on screen with real values.
    expect(screen.getByText("Weekly")).toBeInTheDocument();
    // The project's name is on the page behind and now in the sheet's own
    // Project row too.
    expect(screen.getAllByText("Remodel").length).toBeGreaterThan(1);
    fireEvent.click(screen.getByText("Save"));
    await waitFor(async () => {
      const t = await stepRef!.tasks.task(stepRef!.id);
      expect(t?.extraCategories?.length).toBe(1);
      expect(t?.recurrence).toBe("weekly");
      expect(t?.projectId).toBeTruthy();
      expect(t?.due).toBe("2026-09-20");
    });
  });
});

// LIFE-F-17 (2026-09-05): Mark Done discarded attemptWrite's boolean, so the
// celebration played and the page closed even when the status write had
// failed, with "Couldn't save" showing underneath and the project still open.

let projRef: { svc: ProjectsService; id: string } | null = null;

function SeedFinish() {
  const projects = useProjects();
  const [pid, setPid] = useState("");
  useEffect(() => {
    (async () => {
      const id = (await projects.create({ title: "Kitchen remodel", status: "active" }))!;
      projRef = { svc: projects, id };
      setPid(id);
    })();
  }, [projects]);
  return pid ? <BiggerPictureFlow openId={pid} /> : null;
}

describe("BiggerPictureFlow finish guard (LIFE-F-17)", () => {
  it("a failed Mark Done says so and does not celebrate", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    try {
      render(<NotesProvider userId="u-finish-f17"><SeedFinish /></NotesProvider>);
      const done = await screen.findByText("Mark Done");
      projRef!.svc.update = () => Promise.reject(new Error("offline"));
      fireEvent.click(done);
      await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
      expect(screen.queryByText("Project done")).not.toBeInTheDocument();
      expect(screen.getByText("Mark Done")).toBeInTheDocument();
      expect((await projRef!.svc.get(projRef!.id))?.data.status).toBe("active");
    } finally {
      stop();
    }
  });
});

// LIFE-F-25 (2026-09-05): Undo of a project delete recreated the record under
// a NEW id, so the six tasks filed under it came back reading "No project".
// The record returns under its own id now, which is what makes the links real.

let linkRef: { projects: ProjectsService; tasks: TasksService; pid: string; tid: string } | null = null;

function SeedLinked() {
  const projects = useProjects();
  const tasks = useTasks();
  const [pid, setPid] = useState("");
  useEffect(() => {
    (async () => {
      const p = (await projects.create({ title: "Calder website", status: "active" }))!;
      const t = (await tasks.createTask("Draft the copy", { projectId: p }))!;
      linkRef = { projects, tasks, pid: p, tid: t };
      setPid(p);
    })();
  }, [projects, tasks]);
  return pid ? <BiggerPictureFlow openId={pid} /> : null;
}

describe("BiggerPictureFlow delete Undo (LIFE-F-25)", () => {
  it("puts the project back with its work still filed under it", async () => {
    let undo: (() => void) | undefined;
    const stop = subscribeToast((t) => { if (t?.message === "Project deleted") undo = t.onAction; });
    try {
      render(<NotesProvider userId="u-undo-f25"><SeedLinked /></NotesProvider>);
      fireEvent.click(await screen.findByText("Edit"));
      fireEvent.click(await screen.findByText("Delete Project"));
      await waitFor(() => expect(undo).toBeTruthy());
      expect(await linkRef!.projects.get(linkRef!.pid)).toBeNull();
      undo!();
      await waitFor(async () => {
        expect((await linkRef!.projects.get(linkRef!.pid))?.data.title).toBe("Calder website");
      });
      const task = await linkRef!.tasks.task(linkRef!.tid);
      expect(task?.projectId).toBe(linkRef!.pid);
    } finally {
      stop();
    }
  });
});

// LIFE-F-16 (2026-09-05): Mark Achieved was one quiet tap sitting right above
// Drop This Goal, with no confirm, no Undo and no state control in the edit
// sheet: a mis-tap was permanent short of a database edit.

let achRef: { svc: GoalService; id: string } | null = null;

function SeedAchieve() {
  const goals = useGoals();
  const projects = useProjects();
  const tasks = useTasks();
  const [id, setId] = useState("");
  useEffect(() => {
    (async () => {
      const gid = (await goals.create({ title: "Run a half marathon", state: "on_track" }))!;
      // A goal with work still open is the case that shows Mark Achieved in
      // the quiet tier: finishing early is allowed, it is just not shouted.
      const pid = (await projects.create({ title: "Training block", status: "active", goalId: gid }))!;
      await tasks.createTask("Long run", { projectId: pid });
      achRef = { svc: goals, id: gid };
      setId(gid);
    })();
  }, [goals, projects, tasks]);
  return id ? <BiggerPictureFlow openGoalId={id} /> : null;
}

describe("BiggerPictureFlow Mark Achieved (LIFE-F-16)", () => {
  it("offers an Undo that puts the goal back and clears the achieved date", async () => {
    let undo: (() => void) | undefined;
    const stop = subscribeToast((t) => { if (t?.message === "Goal achieved") undo = t.onAction; });
    try {
      render(<NotesProvider userId="u-achieve-f16"><SeedAchieve /></NotesProvider>);
      fireEvent.click(await screen.findByText("Mark Achieved"));
      await waitFor(async () => {
        expect((await achRef!.svc.get(achRef!.id))?.data.state).toBe("achieved");
      });
      expect((await achRef!.svc.get(achRef!.id))?.data.achievedOn).toBeTruthy();
      expect(undo).toBeTruthy();
      undo!();
      await waitFor(async () => {
        const g = await achRef!.svc.get(achRef!.id);
        expect(g?.data.state).toBe("on_track");
        expect(g?.data.achievedOn ?? null).toBeNull();
      });
      // and the celebration is gone with it
      await waitFor(() => expect(screen.queryByText("Goal achieved")).not.toBeInTheDocument());
    } finally {
      stop();
    }
  });
});

// 2026-09-11: unpicking a goal's last area saved nothing, because the sheet
// left the tags key out and the service merge kept the old ones.

let areaRef: { svc: GoalService; id: string } | null = null;

function SeedGoalArea() {
  const goals = useGoals();
  const cats = useCategories();
  const [id, setId] = useState("");
  useEffect(() => {
    (async () => {
      const health = (await cats.create("Health", "green"))!;
      const gid = (await goals.create({ title: "Sleep by eleven", state: "on_track", tags: [health] }))!;
      areaRef = { svc: goals, id: gid };
      setId(gid);
    })();
  }, [goals, cats]);
  return id ? <BiggerPictureFlow openGoalId={id} /> : null;
}

describe("BiggerPictureFlow goal areas (2026-09-11)", () => {
  it("removing every area from a goal clears them for good", async () => {
    render(<NotesProvider userId="u-goal-areas"><SeedGoalArea /></NotesProvider>);
    fireEvent.click(await screen.findByText("Edit"));
    await screen.findByText("Edit Goal");
    fireEvent.click(screen.getByLabelText("Areas"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /^None$/ }));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(async () => {
      expect((await areaRef!.svc.get(areaRef!.id))?.data.tags ?? []).toEqual([]);
    });
  });
});

// 2026-09-11: the step sheet inside a project showed Length as None and
// dropped any change to it; it reads and writes it the way TasksFlow does.

let lenRef: { tasks: TasksService; id: string } | null = null;

function SeedLength() {
  const projects = useProjects();
  const tasks = useTasks();
  const [pid, setPid] = useState("");
  useEffect(() => {
    (async () => {
      const projectId = (await projects.create({ title: "Garage", status: "active" }))!;
      const id = (await tasks.createTask("Sort the shelves", { projectId, estimateMin: 30 }))!;
      lenRef = { tasks, id };
      setPid(projectId);
    })();
  }, [projects, tasks]);
  return pid ? <BiggerPictureFlow openId={pid} /> : null;
}

describe("BiggerPictureFlow step length (2026-09-11)", () => {
  it("shows the step's length and saves a change to it", async () => {
    render(<NotesProvider userId="u-step-length"><SeedLength /></NotesProvider>);
    fireEvent.click(await screen.findByText("Sort the shelves"));
    await screen.findByText("Edit Task");
    const length = screen.getByLabelText("Length");
    expect(length.textContent).toContain("30m");
    fireEvent.click(length);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^1h 30m$/ }));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(async () => {
      expect((await lenRef!.tasks.task(lenRef!.id))?.estimateMin).toBe(90);
    });
  });
});
