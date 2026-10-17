// @vitest-environment jsdom
// THE NOTE FIELD ON A PROJECT (Dave 2026-10-17: "one normal-size note field
// with the Add Note action on the detail surface, matching the app's standard
// entry treatment"). The flow makes the note born connected to the project,
// titled by his words, and the page stays: the new row appears under the field
// (the Logging Standard, rule 4). The head's Add a Note capsule, which opened
// the editor, is gone from this page by his word.
import { describe, it, expect } from "vitest";
import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useNotes, useProjects } from "../data/NotesProvider";
import type { NotesService } from "../notes/NotesService";
import BiggerPictureFlow from "./BiggerPictureFlow";

let ref: { notes: NotesService; id: string } | null = null;
function Seed() {
  const projects = useProjects();
  const notes = useNotes();
  const [pid, setPid] = useState("");
  useEffect(() => {
    void (async () => {
      const projectId = (await projects.create({ title: "Kitchen Remodel", status: "active" }))!;
      ref = { notes, id: projectId };
      setPid(projectId);
    })();
  }, [projects, notes]);
  return pid ? <BiggerPictureFlow openId={pid} /> : null;
}

describe("BiggerPictureFlow: the note field on the project page", () => {
  it("Return makes a note linked to the project, titled by the words, and stays on the project", async () => {
    localStorage.clear();
    render(<NotesProvider userId="bigger-note-field-1"><Seed /></NotesProvider>);
    const field = await screen.findByPlaceholderText("Add a Note");
    // No capsule on the head, and no editor door.
    expect(screen.queryByRole("button", { name: "Add a Note" })).toBeNull();
    fireEvent.change(field, { target: { value: "Call the plumber" } });
    fireEvent.keyDown(field, { key: "Enter" });
    // The new row is under the field, in Title Case, and the count is on the head.
    await screen.findByText("Call the Plumber");
    expect(field).toHaveValue("");
    const head = [...document.querySelectorAll(".sh2")].find((h) => h.querySelector(".t")?.textContent === "Linked Notes")!;
    expect(head.querySelector(".n")!.textContent).toBe("1");
    expect(head.querySelector("button")).toBeNull();
    // Still the project page: its nav title and its hero, no note editor.
    expect(document.querySelector(".nav-title")!.textContent).toBe("Project");
    expect(screen.getByText("Kitchen Remodel")).toBeInTheDocument();
    // The record: one note, his words as the title, connected to this project with the same link the capsule made.
    const linked = await ref!.notes.notesLinkedTo(ref!.id);
    expect(linked.map((n) => n.title)).toEqual(["Call the plumber"]);
    const stored = (await ref!.notes.listNotes()).find((n) => n.id === linked[0]!.id)!;
    expect((stored.data as { connections: { kind: string; targetId: string; label: string }[] }).connections)
      .toEqual([{ id: "proj-" + ref!.id, kind: "project", label: "Kitchen Remodel", targetId: ref!.id }]);
    // The next note goes in the same field, which is still there.
    fireEvent.change(field, { target: { value: "Ask about grout" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await screen.findByText("Ask About Grout");
    await waitFor(() => expect(head.querySelector(".n")!.textContent).toBe("2"));
  });
});
