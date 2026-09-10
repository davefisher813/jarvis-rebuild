// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useCategories, useProjects } from "../data/NotesProvider";
import CategoryDetail from "./CategoryDetail";

// The one log section (Dave 2026-09-10: "Daily logs should be combined with
// metrics in the most efficient way possible").
const LOG_HEAD = "Daily Log";

// The category page (2026-08-03): a receipts-and-actions page, not an archive.

function Seeded({ kind }: { kind?: "org" }) {
  const tasks = useTasks();
  const cats = useCategories();
  const projects = useProjects();
  const [cid, setCid] = useState("");
  useEffect(() => {
    (async () => {
      const id = await cats.create("Bridge", "blue");
      if (kind) await cats.update(id!, { kind });
      await tasks.createTask("Email Sam", { category: id! });
      await projects.create({ title: "Golf Event", category: id!, status: "active" });
      setCid(id!);
    })();
  }, [tasks, cats, projects, kind]);
  return cid ? <CategoryDetail categoryId={cid} onBack={() => {}} /> : null;
}

describe("CategoryDetail", () => {
  // EVERY AREA PAGE SHOWS ALL FOUR (Dave 2026-09-09, ruling it directly:
  // "every single page that shows your categories shows goals shows projects
  // shows tasks it should show events and they should all have an add
  // button"). Projects used to be gated on the area being an ORG, which this
  // test asserted; that gate is gone, so the assertion inverts.
  it("every area page shows Projects, Goals Here, Coming Up and Up Next, each with its add", async () => {
    render(<NotesProvider userId="u1"><Seeded /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Email Sam")).toBeInTheDocument());
    for (const head of ["Projects", "Goals Here", "Coming Up", "Up Next"]) {
      expect(screen.getByText(head), head + " must stand on every area page").toBeInTheDocument();
    }
    for (const add of ["Add Project", "Add Goal", "Add Event", "Add Task"]) {
      expect(screen.getByText(add), add + " must be offered on every area page").toBeInTheDocument();
    }
    // nothing happened yet: no Record section, no fake receipt
    expect(screen.queryByText("Record")).not.toBeInTheDocument();
  });

  it("org kind adds the Projects block with next actions, born-tagged Add Project", async () => {
    render(<NotesProvider userId="u2"><Seeded kind="org" /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Projects")).toBeInTheDocument());
    expect(screen.getByText("Golf Event")).toBeInTheDocument();
    expect(screen.getByText("Add Project")).toBeInTheDocument();
  });

  // Dave 2026-09-09, from the Bridge area: "I should be able to add goals from
  // the screen in the pic. I can with tasks and projects only." Goals Here was
  // gated on there already BEING a goal, so an area with none showed no
  // section and offered no door: the only way to start one was to leave for
  // Bigger Picture and tag it back to the area by hand.
  it("Goals Here stands on an area with no goals, and its Add Goal opens the sheet", async () => {
    render(<NotesProvider userId="u3"><Seeded /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Email Sam")).toBeInTheDocument());
    // The section is there before any goal is, exactly as Projects is.
    expect(screen.getByText("Goals Here")).toBeInTheDocument();
    const add = screen.getByText("Add Goal");
    expect(add).toBeInTheDocument();
    fireEvent.click(add);
    await waitFor(() => expect(screen.getByText("New Goal")).toBeInTheDocument());
  });

  // Dave 2026-09-09, on the Bridge page: "There's also no events section on
  // these pages." There was one, and it was gated on the area already HAVING
  // an event and sat below Up Next, Notes and People, which is under the fold
  // on a phone. It now stands like Projects does, above the task list, with
  // its own door.
  it("Coming Up stands on an area with no events, and its Add Event opens the sheet", async () => {
    render(<NotesProvider userId="u4"><Seeded /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Email Sam")).toBeInTheDocument());
    expect(screen.getByText("Coming Up")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Add Event"));
    await waitFor(() => expect(screen.getByText("New Event")).toBeInTheDocument());
  });

  // The calendar is the most time-bound thing an area owns, so it goes above
  // the task list rather than below everything.
  it("Coming Up sits above Up Next, not under the fold", async () => {
    const { container } = render(<NotesProvider userId="u5"><Seeded /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Email Sam")).toBeInTheDocument());
    const heads = [...container.querySelectorAll(".sh2 .t")].map((e) => e.textContent);
    expect(heads.indexOf("Coming Up")).toBeGreaterThan(-1);
    expect(heads.indexOf("Coming Up")).toBeLessThan(heads.indexOf("Up Next"));
  });
});

// People-kind pages become people pages (2026-08-10, Dave: "actual features
// with real value not a place for tasks"). The page shows the people tagged
// to the category, upcoming birthdays, and the category's coming events.
import { useSchedule, usePeople } from "../data/NotesProvider";
import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";

function SeededFamily({ onOpenPerson, onOpenContacts }: { onOpenPerson?: (id: string) => void; onOpenContacts?: () => void }) {
  const cats = useCategories();
  const people = usePeople();
  const schedule = useSchedule();
  const [cid, setCid] = useState("");
  useEffect(() => {
    (async () => {
      const id = await cats.create("Family", "pink"); // name suggests kind people
      await people.create({ name: "Mom", group: "contacts", relationship: "Mother", categoryIds: [id!] });
      await people.create({ name: "Randy", group: "contacts" }); // untagged: must NOT appear
      const in3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      await schedule.createEvent("Sunday Dinner", { date: in3, start: "18:00", category: id! });
      setCid(id!);
    })();
  }, [cats, people, schedule]);
  return cid ? <CategoryDetail categoryId={cid} onBack={() => {}} onOpenPerson={onOpenPerson} onOpenContacts={onOpenContacts} /> : null;
}

describe("CategoryDetail people kind (2026-08-10)", () => {
  it("shows the category's people with relationship, not untagged people", async () => {
    render(<NotesProvider userId="pk1"><SeededFamily /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Your People")).toBeInTheDocument());
    expect(screen.getByText("Mom")).toBeInTheDocument();
    expect(screen.getByText(/Mother/)).toBeInTheDocument();
    expect(screen.queryByText("Randy")).not.toBeInTheDocument();
  });

  it("tapping a person hands off through onOpenPerson", async () => {
    const onOpenPerson = vi.fn();
    render(<NotesProvider userId="pk2"><SeededFamily onOpenPerson={onOpenPerson} /></NotesProvider>);
    fireEvent.click(await screen.findByText("Mom"));
    expect(onOpenPerson).toHaveBeenCalled();
  });

  // SPEC MOVED (V2 anatomy, approved 2026-08-15): a future event shows its
  // DAY as the right-side label; the clock time appears only day-of, when it
  // is what matters. The old day-and-time eyebrow was the repeated-prose
  // pattern Dave rejected.
  it("Coming Up shows a future event with its day, time reserved for day-of", async () => {
    render(<NotesProvider userId="pk4"><SeededFamily /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Coming Up")).toBeInTheDocument());
    expect(screen.getByText("Sunday Dinner")).toBeInTheDocument();
    expect(screen.queryByText(/6:00 PM/)).not.toBeInTheDocument();
  });

  it("empty people list explains how to link, and Open Contacts is offered", async () => {
    function SeededEmpty({ onOpenContacts }: { onOpenContacts: () => void }) {
      const cats = useCategories();
      const [cid, setCid] = useState("");
      useEffect(() => { (async () => setCid((await cats.create("Friends", "green"))!))(); }, [cats]);
      return cid ? <CategoryDetail categoryId={cid} onBack={() => {}} onOpenContacts={onOpenContacts} /> : null;
    }
    const onOpenContacts = vi.fn();
    render(<NotesProvider userId="pk3"><SeededEmpty onOpenContacts={onOpenContacts} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("No People Here Yet")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Open Contacts"));
    expect(onOpenContacts).toHaveBeenCalled();
  });
});

// BRAIN-F-07 (2026-09-05): Coming Up compared an event's anchor date to
// today, so a weekly practice anchored three weeks ago was never coming up.
// It now walks the days ahead through occursOn, the same as the Schedule.
import { addDays as addCalDays } from "../schedule/calendar";
import { todayISO as brainToday } from "../tasks/grouping";

function SeededRepeating() {
  const cats = useCategories();
  const schedule = useSchedule();
  const [cid, setCid] = useState("");
  useEffect(() => {
    (async () => {
      const id = await cats.create("Bridge", "blue");
      // Anchored three weeks back, so it repeats onto today's weekday.
      await schedule.createEvent("Practice", { date: addCalDays(brainToday(), -21), start: "17:00", category: id!, recurrence: "weekly" });
      setCid(id!);
    })();
  }, [cats, schedule]);
  return cid ? <CategoryDetail categoryId={cid} onBack={() => {}} /> : null;
}

describe("CategoryDetail Coming Up (BRAIN-F-07)", () => {
  it("shows a weekly series anchored in the past, dated to its next run", async () => {
    render(<NotesProvider userId="cu1"><SeededRepeating /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Coming Up")).toBeInTheDocument());
    expect(screen.getByText("Practice")).toBeInTheDocument();
    // Once, not once per day it lands on inside the window.
    expect(screen.getAllByText("Practice")).toHaveLength(1);
  });
});

// BRAIN-F-09 (2026-09-05): the sheets on this page latch Save on the first
// tap (B12), and none of the page's three saves was guarded, so a failed
// write left the button reading "Saving" forever with no toast.
import { subscribeToast } from "../shared/toast";
import { WRITE_FAILED_MESSAGE } from "../shared/guard";

let tasksRef: ReturnType<typeof useTasks> | null = null;
function SeededForSave() {
  const cats = useCategories();
  const tasks = useTasks();
  const [cid, setCid] = useState("");
  useEffect(() => {
    (async () => { tasksRef = tasks; setCid((await cats.create("Bridge", "blue"))!); })();
  }, [cats, tasks]);
  return cid ? <CategoryDetail categoryId={cid} onBack={() => {}} /> : null;
}

describe("CategoryDetail save guard (BRAIN-F-09)", () => {
  it("a failed Add Task says so and gives the button back", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    try {
      render(<NotesProvider userId="sg1"><SeededForSave /></NotesProvider>);
      fireEvent.click(await screen.findByText("Add Task"));
      fireEvent.change(await screen.findByPlaceholderText("What needs doing?"), { target: { value: "Call the club" } });
      tasksRef!.createTask = () => Promise.reject(new Error("offline"));
      fireEvent.click(screen.getByText("Save"));
      await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
      // The sheet is still open on the typing, and Save is tappable again.
      expect(screen.getByDisplayValue("Call the club")).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText("Save")).toBeInTheDocument());
      expect(screen.queryByText("Saving")).not.toBeInTheDocument();
    } finally {
      stop();
    }
  });
});

// BRAIN-F-12 (2026-09-05): the check on a task row wrote with no guard, so a
// failed one un-checked itself with nothing said at all.
function SeededOpenTask() {
  const cats = useCategories();
  const tasks = useTasks();
  const [cid, setCid] = useState("");
  useEffect(() => {
    (async () => {
      const id = await cats.create("Bridge", "blue");
      await tasks.createTask("Email Sam", { category: id! });
      tasksRef = tasks;
      setCid(id!);
    })();
  }, [cats, tasks]);
  return cid ? <CategoryDetail categoryId={cid} onBack={() => {}} /> : null;
}

describe("CategoryDetail check guard (BRAIN-F-12)", () => {
  it("a check that does not stick says so", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    try {
      render(<NotesProvider userId="cg1"><SeededOpenTask /></NotesProvider>);
      await screen.findByText("Email Sam");
      tasksRef!.toggleDone = () => Promise.reject(new Error("offline"));
      fireEvent.click(document.querySelector(".task-check-tap") as HTMLElement);
      await waitFor(() => expect(seen).toContain(WRITE_FAILED_MESSAGE));
      expect(screen.getByText("Email Sam")).toBeInTheDocument();
    } finally {
      stop();
    }
  });
});

// Org pages become health boards (2026-08-10, Dave: "improve the orgs page
// as well to make it more than just a list"). Rows carry the next action
// with its due date, overdue counts, stalled states, and the org's tagged
// people show with the same staying-in-touch machinery as Family.
import { useGoals } from "../data/NotesProvider";

function SeededOrg({ onOpenPerson }: { onOpenPerson?: (id: string) => void }) {
  const tasks = useTasks();
  const cats = useCategories();
  const projects = useProjects();
  const goals = useGoals();
  const people = usePeople();
  const [cid, setCid] = useState("");
  useEffect(() => {
    (async () => {
      const id = await cats.create("Work", "blue"); // name suggests org
      const gid = await goals.create({ title: "Grow the league", state: "on_track" });
      const pid = await projects.create({ title: "Sponsor Push", category: id!, status: "active", goalId: gid! });
      await tasks.createTask("Email sponsors", { category: id!, projectId: pid!, due: "2020-01-01" }); // long overdue
      await projects.create({ title: "Empty Project", category: id!, status: "active" });
      await people.create({ name: "Coach Ray", group: "contacts", relationship: "League director", categoryIds: [id!] });
      setCid(id!);
    })();
  }, [tasks, cats, projects, goals, people]);
  return cid ? <CategoryDetail categoryId={cid} onBack={() => {}} onOpenPerson={onOpenPerson} /> : null;
}

describe("CategoryDetail org health (2026-08-10)", () => {
  it("project rows carry the next action with its due and the overdue count on one line", async () => {
    render(<NotesProvider userId="org1"><SeededOrg /></NotesProvider>);
    // The project's name is the row, and the task under Up Next names it as
    // its parent line too (the shared task row), so it appears twice.
    await waitFor(() => expect(screen.getAllByText("Sponsor Push").length).toBeGreaterThan(0));
    // ONE GREY LINE (Dave 2026-09-02): the next move as the line, the
    // overdue count as a chip ahead of it; the goal it moves is the Goals
    // Here card, not a third line.
    expect(screen.getByText(/Next: Email sponsors/)).toBeInTheDocument();
    expect(screen.getByText("1 late")).toHaveClass("u-late");
    expect(screen.queryByText(/Moves Grow the league/)).toBeNull();
  });

  it("a project with no open task says Stalled out loud", async () => {
    render(<NotesProvider userId="org2"><SeededOrg /></NotesProvider>);
    // SPEC MOVED (V2): "Stalled" is a red state span, the reason follows.
    await waitFor(() => expect(screen.getByText(/Stalled/)).toBeInTheDocument());
    expect(screen.getByText(/Stalled/)).toHaveClass("r-stalled");
    expect(screen.getByText(/No next action/)).toBeInTheDocument();
  });

  it("an org with tagged people gets the People section, tap-through included", async () => {
    const onOpenPerson = vi.fn();
    render(<NotesProvider userId="org3"><SeededOrg onOpenPerson={onOpenPerson} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("People")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Coach Ray"));
    expect(onOpenPerson).toHaveBeenCalled();
  });
});

// The Record (2026-08-10, Dave: "records and insight... tracking what
// someone has done is important"). The bare This Week count becomes named
// history: the actual completions with their days.

function SeededRecord() {
  const tasks = useTasks();
  const cats = useCategories();
  const [cid, setCid] = useState("");
  useEffect(() => {
    (async () => {
      const id = await cats.create("Chores", "green");
      const tid = await tasks.createTask("Take out trash", { category: id! });
      await tasks.toggleDone(tid!); // writes the Time Sense sample
      setCid(id!);
    })();
  }, [tasks, cats]);
  return cid ? <CategoryDetail categoryId={cid} onBack={() => {}} /> : null;
}

describe("CategoryDetail record (2026-08-10)", () => {
  // SPEC MOVED (V2 anatomy, approved 2026-08-15): the count is a tinted stat
  // tile, completions group under one day divider, and the section is This
  // Week. "1 thing done" prose is exactly what Dave rejected.
  it("shows the count as a stat tile and the completion under its day", async () => {
    render(<NotesProvider userId="rec1"><SeededRecord /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("This Week")).toBeInTheDocument());
    // The home page's quiet tile (Brain onto the rulings, 2026-09-02): a
    // number and a lowercase word, the word ALL CAPS only through CSS.
    expect(screen.getByText("done")).toHaveClass("st-w");
    expect(screen.getByText("Take out trash")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    // done, so it must not also sit in Up Next
    expect(screen.getAllByText("Take out trash")).toHaveLength(1);
  });
});

// S5-Q29 (2026-09-04): four of the dormant Health module's five one-tap
// loggers, grafted onto this same page (kind === "health") through the
// newly-registered HealthService. "Health" as a category name is enough to
// pick up kind === "health" with zero setup (categories/kinds.ts).
function SeededHealth() {
  const cats = useCategories();
  const [cid, setCid] = useState("");
  useEffect(() => {
    (async () => { setCid((await cats.create("Health", "blue"))!); })();
  }, [cats]);
  return cid ? <CategoryDetail categoryId={cid} onBack={() => {}} /> : null;
}

// THE ROWS ARE NOUNS THAT SAY WHAT THEY DO (Dave 2026-09-10: "the log it
// names make no sense and there has to be a much cleaner way to do that.
// Right now I won't even attempt to use it"). The gesture names moved to the
// big button inside each screen, where a verb is what you are telling the app
// rather than what you are choosing between.
describe("CategoryDetail health loggers (S5-Q29)", () => {
  // ONE GRID (Dave 2026-09-10: "Daily logs should be combined with metrics in
  // the most efficient way possible"), and medication behind its own door
  // ("medication related stuff should all be its own page").
  it("keeps only the daily things on the home page, as tiles in the one log grid", async () => {
    render(<NotesProvider userId="hl1"><SeededHealth /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(LOG_HEAD)).toBeInTheDocument());
    const tile = (name: string) => screen.getByText(name).closest(".h-tile") as HTMLElement;
    expect(tile("Bedtime")).toHaveTextContent("When the night ended");
    // Every tile takes a hue off the activity ramp, by position.
    expect(tile("Bedtime").className).toMatch(/\bhue-hl-/);
    // WORKOUT LOGGING BELONGS WITH THE WORKOUT (Dave 2026-09-10): rating a
    // session and pointing at what hurts are facts about ONE workout, so they
    // are offered on the session, not beside bedtime and bodyweight.
    for (const gone of ["How Hard It Was", "Where It Hurts"]) {
      expect(screen.queryByText(gone), gone + " is not on the home page").not.toBeInTheDocument();
    }
    // Medication is a door to its own page, not a tile in the grid.
    expect(screen.getByText("Medication").closest(".h-tile")).toBeNull();
    expect(screen.getByText("Medication").closest(".task-row")).toBeTruthy();
    // The gesture names are gone from the page itself.
    for (const gone of ["Lights Out", "Took It", "Call It", "Point at It"]) {
      expect(screen.queryByText(gone), gone + " is not a name on this page any more").not.toBeInTheDocument();
    }
    // Ate Before, the fifth of the module's own "one-tap loggers," stays
    // dormant: it needs a source of calendar candidates this page has none
    // of yet.
    expect(screen.queryByText("Ate Before")).not.toBeInTheDocument();
  });

  it("Medication opens a page of its own, with the dose and the rest of it", async () => {
    render(<NotesProvider userId="hl5"><SeededHealth /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(LOG_HEAD)).toBeInTheDocument());
    fireEvent.click(screen.getByText("Medication"));
    await waitFor(() => expect(screen.getByText("Log a Dose")).toBeInTheDocument());
    expect(screen.getByText("Refill Runway")).toBeInTheDocument();
    expect(screen.getByText("The Med Window")).toBeInTheDocument();
  });

  it("Bedtime logs through HealthService and the tile remembers it on return", async () => {
    render(<NotesProvider userId="hl2"><SeededHealth /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Bedtime")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Bedtime"));
    await waitFor(() => expect(screen.getByText("One Tap, One Time")).toBeInTheDocument());
    // Inside the screen the verb is the point: the button is what you press
    // when the night is over.
    fireEvent.click(screen.getByText("Lights Out", { selector: "button" }));
    await waitFor(() => expect(screen.getByText("Good night.")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Done"));
    // The tile's VALUE slot is the last log now, not a sentence on line two.
    await waitFor(() => expect(screen.getByText("Bedtime").closest(".h-tile")).toHaveTextContent("Today"));
  });

  // (The RPE rater and the body map moved into the gym on 2026-09-10 -- they
  // are facts about a session, so they are offered on the receipt and on any
  // logged session reopened from Recent or History. GymFlow's own tests cover
  // the rows; HealthService's cover the records.)
});

// BRAIN-F-02 (2026-09-05): "Moved to tomorrow" was a no-op east of UTC.
// snoozeTask serialised local midnight with toISOString(), which reads the
// UTC date; in Tokyo tomorrow's midnight is 15:00 UTC today, so the due
// date it wrote back was today. The real page, the real swipe button, a
// zone nine hours ahead of Greenwich.
import { todayISO as localToday } from "../tasks/grouping";

let snoozed: { svc: ReturnType<typeof useTasks>; id: string } | null = null;
function SeededDueToday() {
  const tasks = useTasks();
  const cats = useCategories();
  const [cid, setCid] = useState("");
  useEffect(() => {
    (async () => {
      const id = await cats.create("Bridge", "blue");
      const tid = await tasks.createTask("Email Sam", { category: id!, due: localToday() });
      snoozed = { svc: tasks, id: tid! };
      setCid(id!);
    })();
  }, [tasks, cats]);
  return cid ? <CategoryDetail categoryId={cid} onBack={() => {}} /> : null;
}

describe("CategoryDetail snooze (BRAIN-F-02)", () => {
  it("Tomorrow lands on the next local day under Asia/Tokyo", async () => {
    const prevTz = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    try {
      render(<NotesProvider userId="tz-brain-02"><SeededDueToday /></NotesProvider>);
      await waitFor(() => expect(screen.getByRole("button", { name: "Move to tomorrow" })).toBeInTheDocument());
      const today = localToday();
      const d = new Date(); d.setDate(d.getDate() + 1);
      const want = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      expect(want).not.toBe(today);
      fireEvent.click(screen.getByRole("button", { name: "Move to tomorrow" }));
      await waitFor(async () => {
        const t = await snoozed!.svc.task(snoozed!.id);
        expect(t?.due).toBe(want);
      });
    } finally {
      process.env.TZ = prevTz;
    }
  });
});

// BRAIN-F-15 (2026-09-05): the "Log deleted · Undo" toast fired outside
// metricWrite's success callback, so a failed delete showed both it and
// "Couldn't save that metric", and its Undo re-logged a value that had never
// been removed.
import { useMetrics } from "../data/NotesProvider";
import { newMetricDefData } from "../gym/metrics";

let metricsRef: ReturnType<typeof useMetrics> | null = null;
function SeededMetric() {
  const cats = useCategories();
  const metrics = useMetrics();
  const [cid, setCid] = useState("");
  useEffect(() => {
    (async () => {
      const id = (await cats.create("Health", "blue"))!;
      const defId = (await metrics.createDef(newMetricDefData("Sleep", "number", "h", undefined, localToday(), 0)))!;
      await metrics.logMetric(defId, localToday(), { value: 7 });
      metricsRef = metrics;
      setCid(id);
    })();
  }, [cats, metrics]);
  return cid ? <CategoryDetail categoryId={cid} onBack={() => {}} /> : null;
}

describe("CategoryDetail metric log delete (BRAIN-F-15)", () => {
  it("says deleted only once the delete landed", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    try {
      render(<NotesProvider userId="ml1"><SeededMetric /></NotesProvider>);
      fireEvent.click(await screen.findByText("Sleep"));
      const del = await screen.findByText("Delete");

      const real = metricsRef!.removeLog.bind(metricsRef);
      metricsRef!.removeLog = () => Promise.reject(new Error("offline"));
      fireEvent.click(del);
      await waitFor(() => expect(seen.some((m) => m.startsWith("Couldn't save that metric"))).toBe(true));
      expect(seen).not.toContain("Log deleted");

      // With the connection back, the same tap says it, once it is true.
      metricsRef!.removeLog = real;
      fireEvent.click(screen.getByText("Delete"));
      await waitFor(() => expect(seen).toContain("Log deleted"));
    } finally {
      stop();
    }
  });
});

// BRAIN-F-10 (2026-09-05, fork option A): Undo of an area delete called
// create(), which mints a new id and takes three fields, so the area came back
// empty: every task, note and project that carried the old id stayed untagged
// and the org's kind and settings were gone. Option (c) rides along: the armed
// step says what the delete costs before the second tap.
function SeededArea({ onChanged }: { onChanged?: () => void }) {
  const cats = useCategories();
  const tasks = useTasks();
  const [cid, setCid] = useState("");
  useEffect(() => {
    (async () => {
      const id = (await cats.create("Bridge Club", "blue"))!;
      await cats.update(id, { kind: "org", season: "paused" });
      await tasks.createTask("Email Sam", { category: id });
      catsRef = cats;
      tasksRef = tasks;
      setCid(id);
    })();
  }, [cats, tasks]);
  return cid ? <CategoryDetail categoryId={cid} onBack={() => {}} onChanged={onChanged} /> : null;
}

let catsRef: ReturnType<typeof useCategories> | null = null;

describe("CategoryDetail area delete (BRAIN-F-10)", () => {
  it("says what the delete untags, and Undo brings the area back with its tags and settings", async () => {
    const seen: { message: string; onAction?: () => void }[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t); });
    try {
      render(<NotesProvider userId="area-f10"><SeededArea /></NotesProvider>);
      await screen.findAllByText("Email Sam");
      const before = (await catsRef!.list())[0]!;

      fireEvent.click(screen.getByText("Edit"));
      fireEvent.click(await screen.findByText("Delete Category"));
      // The armed step names the cost, in real numbers, before the second tap.
      expect(await screen.findByText("Untags 1 task")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Tap Again to Delete"));
      await waitFor(async () => expect(await catsRef!.list()).toHaveLength(0));

      const toast = seen[seen.length - 1]!;
      expect(toast.message).toBe("Area deleted");
      toast.onAction!();
      await waitFor(async () => expect(await catsRef!.list()).toHaveLength(1));

      const back = (await catsRef!.list())[0]!;
      // The same id, so the task that carried it is tagged with it still.
      expect(back.id).toBe(before.id);
      expect(back.data.kind).toBe("org");
      expect(back.data.season).toBe("paused");
      const t = (await tasksRef!.listTasks()).find((x) => x.data.text === "Email Sam")!;
      expect(t.data.category).toBe(back.id);
    } finally {
      stop();
    }
  });
});

// HMN-F-06 (2026-09-05), fork option A: S5-Q29 grafted four loggers onto this
// page and left the other seventeen health screens written, tested and
// unreachable. They open from the More row now, on the Student template, with
// the candidate props built from the real calendar.
import { useProfile } from "../data/NotesProvider";
import type { TemplateKey } from "../categories/defaults";
import { addDays } from "../schedule/calendar";
import { resetToasts } from "../shared/toast";

const seenToasts: string[] = [];
// UP-ATH-10 (2026-09-06): the action too, because an offer that makes a real
// thing has to be takeable back.
let lastToast: { message: string; actionLabel?: string } | null = null;
subscribeToast((t) => { if (t) { seenToasts.push(t.message); lastToast = t; } });

function SeededHealthMore({ template }: { template: TemplateKey }) {
  const cats = useCategories();
  const profile = useProfile();
  const schedule = useSchedule();
  const [cid, setCid] = useState("");
  useEffect(() => {
    (async () => {
      await profile.save({ template });
      // An org area is a team or a program: that is what makes its events
      // sport sessions to the health screens.
      const org = await cats.create("Elite Squad", "red");
      await cats.update(org!, { kind: "org" });
      await schedule.createEvent("Practice", { date: localToday(), start: "16:00", end: "18:00", category: org! });
      // Tomorrow's fixed thing, which is what The Night Before anchors on.
      await schedule.createEvent("Bus Leaves", { date: addDays(localToday(), 1), start: "07:00", category: org! });
      setCid((await cats.create("Health", "blue"))!);
    })();
  }, [cats, profile, schedule, template]);
  return cid ? <CategoryDetail categoryId={cid} onBack={() => {}} /> : null;
}

describe("CategoryDetail: the rest of the health module (HMN-F-06)", () => {
  afterEach(() => { seenToasts.length = 0; resetToasts(); });

  it("Student gets the More row, and it opens the screens that have a real source", async () => {
    render(<NotesProvider userId="hm1"><SeededHealthMore template="student" /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("More")).toBeInTheDocument());
    fireEvent.click(screen.getByText("More"));

    await waitFor(() => expect(screen.getByText("The Share Line")).toBeInTheDocument());
    expect(screen.getByText("What They See")).toBeInTheDocument();
    expect(screen.getByText("The Locker")).toBeInTheDocument();
    expect(screen.getByText("The Handoff")).toBeInTheDocument();
    // The Bag binds to a real event, and there is one on the calendar.
    expect(screen.getByText("The Bag")).toBeInTheDocument();
    // The three with nothing honest behind them are not offered.
    expect(screen.queryByText("Ate Before")).not.toBeInTheDocument();
    expect(screen.queryByText("The Age Rule")).not.toBeInTheDocument();
    expect(screen.queryByText("The Season Feed")).not.toBeInTheDocument();

    // The consent screen opens over the same HealthService the page uses.
    fireEvent.click(screen.getByText("The Share Line"));
    await waitFor(() => expect(screen.getByText("Areas")).toBeInTheDocument());
    expect(screen.getByText("Mood and Mind")).toBeInTheDocument();
  });

  it("Week Shape counts the real calendar, not a stand-in", async () => {
    render(<NotesProvider userId="hm2"><SeededHealthMore template="student" /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("More")).toBeInTheDocument());
    fireEvent.click(screen.getByText("More"));
    fireEvent.click(await screen.findByText("Week Shape"));
    // The 16:00 to 18:00 practice on the org area, read through the calendar.
    await waitFor(() => expect(screen.getByText("1 · 2 Hours")).toBeInTheDocument());
  });

  // UP-ATH-10 (2026-09-06): this case asserted the OLD behaviour, which
  // HMN-F-06 shipped as the honest half of a bigger fix: every offer, whatever
  // it was, landed as one untimed task on this area's list. Protecting an
  // hour tonight is not a to-do, so Add Wind Down writes a protected block on
  // the routine instead, the receipt says which thing it made, and it can be
  // taken back.
  it("Add Wind Down protects the hour on the routine, and says so only after the write", async () => {
    render(<NotesProvider userId="hm4"><SeededHealthMore template="student" /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("More")).toBeInTheDocument());
    fireEvent.click(screen.getByText("More"));
    fireEvent.click(await screen.findByText("The Night Before"));
    fireEvent.click(await screen.findByText("Add Wind Down"));
    await waitFor(() => expect(seenToasts.some((m) => m === "Wind Down added to your routine")).toBe(true));
    expect(lastToast!.actionLabel).toBe("Undo");
    // And it is NOT a row on the list any more: that was the flattening.
    fireEvent.click(screen.getByLabelText("Back"));
    await waitFor(() => expect(screen.getByText("The Night Before")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Back"));
    await waitFor(() => expect(screen.getByText(LOG_HEAD)).toBeInTheDocument());
    expect(screen.queryByText(/^Wind Down at /)).not.toBeInTheDocument();
  });

  // UP-ATH-01 (2026-09-06): Personal used to get no More row at all, so the
  // default template, which is the one the app is actually used on, could
  // open none of the fourteen screens. It gets the medication half, because
  // an adult on a monthly script has the same use for it as an athlete, and
  // none of the parent or season half, because those questions do not exist
  // on a Personal page.
  // The medication screens moved off More and onto their own page (Dave
  // 2026-09-10: "medication related stuff should all be its own page"), so
  // Personal reaches them through Medication and More holds the rest.
  it("Personal reaches the medication screens through Medication, and no parent or season ones anywhere", async () => {
    render(<NotesProvider userId="hm3"><SeededHealthMore template="personal" /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(LOG_HEAD)).toBeInTheDocument());
    expect(screen.getByText("Bedtime")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Medication"));
    expect(await screen.findByText("Refill Runway")).toBeInTheDocument();
    expect(screen.getByText("The Med Window")).toBeInTheDocument();
    expect(screen.getByText("Take This to the Doctor")).toBeInTheDocument();
    expect(screen.queryByText("The Share Line")).not.toBeInTheDocument();
    expect(screen.queryByText("The Third Practice")).not.toBeInTheDocument();
    expect(screen.queryByText("The Handoff")).not.toBeInTheDocument();
  });
});

// ONE OF EACH SECTION, ONE OF EACH ADD (Dave 2026-09-10: "there's duplicate
// add buttons on the page"). HealthBody drew its own Goals Here and Up Next;
// the shared area block drew Projects, Goals Here, Coming Up and Up Next; the
// health page rendered both. The block is handed to HealthBody now, so there
// is exactly one definition of those sections in the app.
describe("CategoryDetail health page: no section is drawn twice (2026-09-10)", () => {
  it("shows one Add Project, one Add Goal, one Add Event and one Add Task", async () => {
    render(<NotesProvider userId="hd1"><SeededHealth /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(LOG_HEAD)).toBeInTheDocument());
    for (const label of ["Add Project", "Add Goal", "Add Event", "Add Task"]) {
      expect(screen.getAllByText(label), label + " appears exactly once").toHaveLength(1);
    }
    // On a health area the goals section is named for what it holds (Dave
    // 2026-09-10: "health specific goals are like workout goals... That should
    // be a little bit different to me"), and it offers the gym's own lift-goal
    // door as a second, quieter row.
    for (const head of ["Projects", "Training Goals", "Coming Up", "Up Next"]) {
      expect(screen.getAllByText(head), head + " is one section").toHaveLength(1);
    }
    expect(screen.queryByText("Goals Here"), "the generic head is not used on a health area").toBeNull();
    expect(screen.getByText("Set a Lift Goal in the Gym")).toBeInTheDocument();
  });

  // THE TRAINING CARD IS A CHOICE (Dave 2026-09-10: "There's not even a header
  // above it. It should encourage the user to select a workout for the day or
  // begin one from scratch").
  it("puts a head over the training card and offers a session from scratch", async () => {
    render(<NotesProvider userId="hd2"><SeededHealth /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(LOG_HEAD)).toBeInTheDocument());
    expect(screen.getByText("Training")).toBeInTheDocument();
    // With no program yet there is nothing to pick between, so the card says
    // so and the chip row stays away rather than offering an empty choice.
    expect(screen.getByText("Set Up a Program")).toBeInTheDocument();
    expect(document.querySelector(".h-pick")).toBeNull();
  });
});
