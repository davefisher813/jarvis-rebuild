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
