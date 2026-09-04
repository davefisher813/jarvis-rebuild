// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useCategories, useProjects } from "../data/NotesProvider";
import CategoryDetail from "./CategoryDetail";

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
  it("plain category: Up Next with the open task, Add rows, NO Projects block", async () => {
    render(<NotesProvider userId="u1"><Seeded /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Email Sam")).toBeInTheDocument());
    expect(screen.getByText("Up Next")).toBeInTheDocument();
    expect(screen.getByText("Add Task")).toBeInTheDocument();
    // Bridge suggests plain, so the org module must not render
    expect(screen.queryByText("Projects")).not.toBeInTheDocument();
    // nothing happened yet: no Record section, no fake receipt
    expect(screen.queryByText("Record")).not.toBeInTheDocument();
  });

  it("org kind adds the Projects block with next actions, born-tagged Add Project", async () => {
    render(<NotesProvider userId="u2"><Seeded kind="org" /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Projects")).toBeInTheDocument());
    expect(screen.getByText("Golf Event")).toBeInTheDocument();
    expect(screen.getByText("Add Project")).toBeInTheDocument();
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

describe("CategoryDetail health loggers (S5-Q29)", () => {
  it("offers all four loggers with no sub-line before anything is logged", async () => {
    render(<NotesProvider userId="hl1"><SeededHealth /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Log It")).toBeInTheDocument());
    expect(screen.getByText("Lights Out")).toBeInTheDocument();
    expect(screen.getByText("Took It")).toBeInTheDocument();
    expect(screen.getByText("Call It")).toBeInTheDocument();
    expect(screen.getByText("Point at It")).toBeInTheDocument();
    // Ate Before, the fifth of the module's own "one-tap loggers," stays
    // dormant: it needs a source of calendar candidates this page has none
    // of yet.
    expect(screen.queryByText("Ate Before")).not.toBeInTheDocument();
  });

  it("Lights Out logs through HealthService and the row remembers it on return", async () => {
    render(<NotesProvider userId="hl2"><SeededHealth /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Lights Out")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Lights Out"));
    await waitFor(() => expect(screen.getByText("One Tap, One Time")).toBeInTheDocument());
    // The screen's nav title and its own big button both read "Lights Out";
    // the button is the one with the primary class.
    fireEvent.click(screen.getByText("Lights Out", { selector: "button" }));
    await waitFor(() => expect(screen.getByText("Good night.")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => expect(screen.getByText("Logged Today")).toBeInTheDocument());
  });

  it("Call It logs an RPE and the row shows it back, out of 10", async () => {
    render(<NotesProvider userId="hl3"><SeededHealth /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Call It")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Call It"));
    await waitFor(() => expect(screen.getByText("How Hard Was That")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Effort 7 of 10"));
    await waitFor(() => expect(screen.getByText("Logged 7 Of 10")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => expect(screen.getByText("Logged Today · 7/10")).toBeInTheDocument());
  });

  it("Point at It logs a tapped spot and stays honest: no severity, no name, anywhere on the row", async () => {
    render(<NotesProvider userId="hl4"><SeededHealth /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Point at It")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Point at It"));
    await waitFor(() => expect(screen.getByText("Where Is It")).toBeInTheDocument());
    const map = document.querySelector(".body-map") as HTMLElement;
    map.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 300, right: 200, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.click(map, { clientX: 100, clientY: 60 });
    await waitFor(() => expect(screen.getByText("Logged")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => expect(screen.getByText("Point at It").closest(".task-row")).toHaveTextContent("Logged Today"));
    expect(screen.queryByText(/\d\/10|severe|mild|injury/i)).not.toBeInTheDocument();
  });
});
