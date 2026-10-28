// @vitest-environment jsdom
// A CORRECTION EDITS THE RECEIPT ABOVE IT (Dave, 2026-10-27: "no, Josh Rudd" was saved as a second bogus task).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect, useState } from "react";
import type React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, usePeople } from "../data/NotesProvider";
import { AIService } from "../ai/AIService";
import QuickCapture from "./QuickCapture";

vi.mock("../shared/toast", () => ({ showToast: () => {} }));

let tasksRef: ReturnType<typeof useTasks> | null = null;
const ids = { bucknell: "", rudd: "" };
function Seed({ children, withRudd = true }: { children: React.ReactNode; withRudd?: boolean }) {
  const people = usePeople();
  tasksRef = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      ids.bucknell = (await people.create({ name: "Josh (Bucknell)", group: "contacts" }))!;
      if (withRudd) ids.rudd = (await people.create({ name: "Josh Rudd", group: "contacts" }))!;
      setReady(true);
    })();
  }, [people, withRudd]);
  return ready ? <>{children}</> : null;
}
const mount = (userId: string, withRudd = true) => render(
  <NotesProvider userId={userId}><Seed withRudd={withRudd}><QuickCapture ai={new AIService({ available: false })} onClose={() => {}} /></Seed></NotesProvider>,
);
const send = async (line: string) => {
  fireEvent.change(await screen.findByLabelText("Paste or Type"), { target: { value: line } });
  fireEvent.click(screen.getByText("Capture"));
};

beforeEach(() => { tasksRef = null; localStorage.clear(); });

describe("Quick Capture: a correction fixes the receipt, it is not captured", () => {
  it("'no, Josh Rudd' files him on the same task, lights his chip, and makes no second receipt or task", async () => {
    mount("u-qc-corr-1");
    await send("Call Josh Rudd about the roster");
    await waitFor(() => expect(screen.getByText("Undo")).toBeInTheDocument());
    expect((await tasksRef!.listTasks())[0]!.data.personId).toBeUndefined();

    await send("no, Josh Rudd");
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Josh Rudd" })).toHaveAttribute("aria-checked", "true"));
    const all = await tasksRef!.listTasks();
    expect(all).toHaveLength(1);
    expect(all[0]!.data.personId).toBe(ids.rudd);
    expect(document.querySelectorAll(".capture-saved")).toHaveLength(1);
    // And the lit chip takes him off again.
    fireEvent.click(screen.getByRole("checkbox", { name: "Josh Rudd" }));
    await waitFor(async () => expect((await tasksRef!.listTasks())[0]!.data.personId).toBeUndefined());
  });

  it("words that name no contact fix nothing and save nothing; sent a second time they are a capture", async () => {
    mount("u-qc-corr-2", false);
    await send("Call Josh Rudd about the roster");
    await waitFor(() => expect(screen.getByText("Undo")).toBeInTheDocument());
    await send("no, Josh Rudd");
    await waitFor(() => expect(screen.getByText(/couldn't tell what to fix/)).toBeInTheDocument());
    expect(await tasksRef!.listTasks()).toHaveLength(1);
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(async () => expect(await tasksRef!.listTasks()).toHaveLength(2));
  });
});
