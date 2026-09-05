// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, usePeople, useTasks } from "../data/NotesProvider";
import { useEffect, useState } from "react";
import PeopleFlow from "./PeopleFlow";

// BRAIN-F-24 (2026-09-05): MessageDraftSheet has taken an `about` since
// addendum item 3 built it, and no caller ever passed one, so every draft was
// a generic check-in and the "what the message needs to say" path existed in
// code with no door. The person card's Still Open rows are the surface that
// knows what it is about, and they now open the sheet with it.

const prompts: string[] = [];
vi.mock("../ai/useAI", () => ({
  useAI: () => ({
    available: true,
    complete: async (_msgs: unknown, system: string) => { prompts.push(system); return "Drafted."; },
  }),
}));

function Seeded() {
  const people = usePeople();
  const tasks = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      await people.create({ name: "Marco Vidal", group: "contacts", phone: "555-0142" });
      await tasks.createTask("Send Marco Vidal the roster", { due: "2026-09-09" });
      setReady(true);
    })();
  }, [people, tasks]);
  return ready ? <PeopleFlow onBack={() => {}} /> : null;
}

describe("a message about the thing that is still open (BRAIN-F-24)", () => {
  it("drafts about that task, not a generic check-in", async () => {
    render(<NotesProvider userId="msg-f24"><Seeded /></NotesProvider>);
    fireEvent.click(await screen.findByText("Marco Vidal"));
    await screen.findByText("Still Open");
    expect(screen.getByText("Send Marco Vidal the roster")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Message"));
    await waitFor(() => expect(prompts.length).toBeGreaterThan(0));
    const system = prompts[prompts.length - 1]!;
    expect(system).toContain('What the message needs to say: the open task "Send Marco Vidal the roster", due 2026-09-09');
    expect(system).not.toContain("No topic was given");
  });
});
