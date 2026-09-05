// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useProjects } from "../data/NotesProvider";
import BiggerPictureFlow from "../bigger/BiggerPictureFlow";
import { linkThread } from "../messages/threadLink";
import { useEffect } from "react";

function Seed() { const p = useProjects(); useEffect(() => { void p.create({ title: "Kitchen remodel", status: "active" }); }, [p]); return null; }

beforeEach(() => localStorage.clear());

describe("Project detail", () => {
  it("tapping a project opens its detail with an Edit action", async () => {
    render(<NotesProvider userId="u1"><Seed /><BiggerPictureFlow /></NotesProvider>);
    const row = await screen.findByText("Kitchen remodel");
    fireEvent.click(row.closest(".proj-row")!);
    await waitFor(() => expect(screen.getByText("Details")).toBeInTheDocument());
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  // EMAIL-F-19 (2026-09-05): "Project link chips are write-only: nothing ever
  // reads a thread's project." Tapping a project chip in Email toasted "Filed
  // under Ridgeley" and the project page never showed the conversation. The
  // chip's own store is the seam; this is its first reader.
  it("shows a conversation filed under the project, and opens it in Email", async () => {
    let opened: string | null = null;
    function SeedLinked() {
      const p = useProjects();
      useEffect(() => {
        void p.create({ title: "Ridgeley waiver", status: "active" }).then((id) => {
          if (id) linkThread("t9", { type: "project", id, label: "Ridgeley waiver", subject: "The waiver", from: "Ridgeley" });
        });
      }, [p]);
      return null;
    }
    render(
      <NotesProvider userId="u2">
        <SeedLinked />
        <BiggerPictureFlow onGoEmail={(threadId) => { opened = threadId; }} />
      </NotesProvider>,
    );
    const row = await screen.findByText("Ridgeley waiver");
    fireEvent.click(row.closest(".proj-row")!);
    await waitFor(() => expect(screen.getByText("Linked Conversations")).toBeInTheDocument());
    fireEvent.click(screen.getByText("The waiver"));
    expect(opened).toBe("t9");
  });
});
