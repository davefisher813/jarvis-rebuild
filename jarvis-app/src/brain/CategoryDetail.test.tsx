// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, useCategories } from "../data/NotesProvider";
import CategoryDetail from "./CategoryDetail";

function Seeded() {
  const tasks = useTasks();
  const cats = useCategories();
  const [cid, setCid] = useState("");
  useEffect(() => {
    (async () => {
      const id = await cats.create("Work", "blue");
      await tasks.createTask("Email Sam", { category: id! });
      setCid(id!);
    })();
  }, [tasks, cats]);
  return cid ? <CategoryDetail categoryId={cid} name="Work" color="blue" onBack={() => {}} /> : null;
}

describe("CategoryDetail", () => {
  it("shows items tagged with the category", async () => {
    render(<NotesProvider userId="u1"><Seeded /></NotesProvider>);
    await waitFor(() => expect(screen.getByText("Email Sam")).toBeInTheDocument());
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });

  it("shows an empty message when nothing is tagged", async () => {
    render(
      <NotesProvider userId="u1">
        <CategoryDetail categoryId="missing" name="Health" color="green" onBack={() => {}} />
      </NotesProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Nothing tagged Health yet/)).toBeInTheDocument());
  });
});
