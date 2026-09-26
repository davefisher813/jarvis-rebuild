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

// Life mounts the flow as its Projects segment, which opens on the cards; the
// ruled list is one tap away on the header's view toggle. The test walks the
// same way in, then taps the project's row.
async function openRow(title: string) {
  await screen.findByText(title);
  fireEvent.click(document.querySelector(".bp-viewtog")!);
  fireEvent.click(screen.getByText(title).closest(".proj-row-ruled")!);
}

describe("Project detail", () => {
  it("tapping a project opens its detail with an Edit action", async () => {
    render(<NotesProvider userId="u1"><Seed /><BiggerPictureFlow lens="projects" segments={<div />} /></NotesProvider>);
    await openRow("Kitchen remodel");
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
        <BiggerPictureFlow lens="projects" segments={<div />} onGoEmail={(threadId) => { opened = threadId; }} />
      </NotesProvider>,
    );
    await openRow("Ridgeley waiver");
    await waitFor(() => expect(screen.getByText("Linked Conversations")).toBeInTheDocument());
    fireEvent.click(screen.getByText("The waiver"));
    expect(opened).toBe("t9");
  });
});
