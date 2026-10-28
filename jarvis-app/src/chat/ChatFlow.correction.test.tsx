// @vitest-environment jsdom
// A CORRECTION EDITS THE ITEM JUST CAPTURED (Dave, 2026-10-27). He captured "Text Josh Rudd", it was filed under the wrong contact, he typed
// "no, Josh Rudd", and the correction became a second bogus task. Now the capture files nobody, and a correction right after it fixes that
// item and saves nothing new.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect, useState } from "react";
import type React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useTasks, usePeople } from "../data/NotesProvider";
import ChatFlow from "./ChatFlow";
import type { AIService } from "../ai/AIService";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: false } as unknown as AIService) }));
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

const say = async (line: string) => {
  fireEvent.change(await screen.findByPlaceholderText("Ask, Tell or Paste"), { target: { value: line } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
};
const rows = async () => (await tasksRef!.listTasks());

beforeEach(() => { tasksRef = null; localStorage.clear(); });

describe("Chat: a correction right after a capture edits it", () => {
  it("captures Josh Rudd with nobody filed, then 'no, Josh Rudd' files him on the SAME task and makes no second one", async () => {
    render(<NotesProvider userId="u-corr-1"><Seed><ChatFlow /></Seed></NotesProvider>);
    await say("Call Josh Rudd about the roster");
    await waitFor(() => expect(screen.getByText(/^Saved: /)).toBeInTheDocument());
    let all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.data.personId).toBeUndefined();

    await say("no, Josh Rudd");
    await waitFor(() => expect(screen.getByText(/^Fixed: /)).toBeInTheDocument());
    all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.data.personId).toBe(ids.rudd);
    expect(all[0]!.data.personId).not.toBe(ids.bucknell);
  });

  it("'no, nobody' takes a person off the same task", async () => {
    render(<NotesProvider userId="u-corr-2"><Seed><ChatFlow /></Seed></NotesProvider>);
    await say("Call Josh Rudd about the roster");
    await waitFor(() => expect(screen.getByText(/^Saved: /)).toBeInTheDocument());
    await say("no, Josh Rudd");
    await waitFor(() => expect(screen.getByText(/Fixed: .* · With Josh Rudd/)).toBeInTheDocument());
    await say("no, nobody");
    await waitFor(() => expect(screen.getByText(/Person Taken Off/)).toBeInTheDocument());
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]!.data.personId).toBeUndefined();
  });

  it("a name that is not a contact changes nothing and saves nothing, and the manual buttons are offered", async () => {
    render(<NotesProvider userId="u-corr-3"><Seed withRudd={false}><ChatFlow /></Seed></NotesProvider>);
    await say("Call Josh Rudd about the roster");
    await waitFor(() => expect(screen.getByText(/^Saved: /)).toBeInTheDocument());
    await say("no, Josh Rudd");
    await waitFor(() => expect(screen.getByText(/couldn't tell what to fix/)).toBeInTheDocument());
    expect(await rows()).toHaveLength(1);
    expect(screen.getByText("Save as Task")).toBeInTheDocument();
  });

  it("a line that only starts with the word no is still a capture", async () => {
    render(<NotesProvider userId="u-corr-4"><Seed><ChatFlow /></Seed></NotesProvider>);
    await say("Call Josh Rudd about the roster");
    await waitFor(() => expect(screen.getByText(/^Saved: /)).toBeInTheDocument());
    await say("Call the plumber tomorrow");
    await waitFor(() => expect(screen.getAllByText(/^Saved: /)).toHaveLength(2));
    expect(await rows()).toHaveLength(2);
  });

  it("a correction only reaches the turn right before it", async () => {
    render(<NotesProvider userId="u-corr-5"><Seed><ChatFlow /></Seed></NotesProvider>);
    await say("Call Josh Rudd about the roster");
    await waitFor(() => expect(screen.getByText(/^Saved: /)).toBeInTheDocument());
    await say("hello");
    await waitFor(() => expect(screen.getAllByText(/./).length).toBeGreaterThan(0));
    await say("no, Josh Rudd");
    // Nothing recent to fix: it is read like any other line and no existing task is edited.
    await waitFor(async () => expect((await rows()).filter((t) => t.data.personId).length).toBe(0));
  });
});
