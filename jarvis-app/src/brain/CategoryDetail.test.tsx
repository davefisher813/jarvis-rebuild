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
    // nothing happened yet: no This Week section, no fake receipt
    expect(screen.queryByText("This Week")).not.toBeInTheDocument();
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

  it("Coming Up shows the category's future events with a day and time", async () => {
    render(<NotesProvider userId="pk4"><SeededFamily /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Coming Up")).toBeInTheDocument());
    expect(screen.getByText("Sunday Dinner")).toBeInTheDocument();
    expect(screen.getByText(/6:00 PM/)).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText("No people here yet")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Open Contacts"));
    expect(onOpenContacts).toHaveBeenCalled();
  });
});
