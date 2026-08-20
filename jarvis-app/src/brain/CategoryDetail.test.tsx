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
  it("project rows carry next action with due, overdue count, and the goal they move", async () => {
    render(<NotesProvider userId="org1"><SeededOrg /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Sponsor Push")).toBeInTheDocument());
    // SPEC MOVED (V2): the state leads in its color, the next action follows
    // as a lowercase fragment.
    expect(screen.getByText("Moving")).toBeInTheDocument();
    expect(screen.getByText(/next: Email sponsors/)).toBeInTheDocument();
    expect(screen.getByText(/1 Overdue · Moves Grow the league/)).toBeInTheDocument();
  });

  it("a project with no open task says Stalled out loud", async () => {
    render(<NotesProvider userId="org2"><SeededOrg /></NotesProvider>);
    // SPEC MOVED (V2): "Stalled" is a red state span, the reason follows.
    await waitFor(() => expect(screen.getByText("Stalled")).toBeInTheDocument());
    expect(screen.getByText(/no next action/)).toBeInTheDocument();
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
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Take out trash")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    // done, so it must not also sit in Up Next
    expect(screen.getAllByText("Take out trash")).toHaveLength(1);
  });
});
