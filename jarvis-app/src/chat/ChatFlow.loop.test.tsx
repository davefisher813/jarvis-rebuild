// @vitest-environment jsdom
// PHASE 0.5, THE FIRST MAGIC LOOP IN CHAT (PHASE05-DESIGN.md 2.4). A capture
// typed into Chat matches contacts the way Quick Capture does, behind
// memory_v1, so "Need to follow up with Mike about summer roster" lands on
// Mike's card from either box. AI off throughout.
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
const flags = vi.hoisted(() => ({ memoryOn: true }));
vi.mock("../substrate/flags", async (orig) => {
  const real = await orig<typeof import("../substrate/flags")>();
  return { ...real, flagOn: (f: Parameters<typeof real.flagOn>[0]) => (f === "memory_v1" ? flags.memoryOn : real.flagOn(f)) };
});

let tasksRef: ReturnType<typeof useTasks> | null = null;
let mikeId = "";
function Seed({ children }: { children: React.ReactNode }) {
  const people = usePeople();
  tasksRef = useTasks();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      mikeId = (await people.create({ name: "Mike Rossi", group: "contacts" }))!;
      setReady(true);
    })();
  }, [people]);
  return ready ? <>{children}</> : null;
}

async function captureInChat(userId: string) {
  render(<NotesProvider userId={userId}><Seed><ChatFlow /></Seed></NotesProvider>);
  fireEvent.change(await screen.findByPlaceholderText("Ask, Tell or Paste"), { target: { value: "Need to follow up with Mike about summer roster" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(screen.getByText(/^Saved: /)).toBeInTheDocument());
  return (await tasksRef!.listTasks()).find((t) => /summer roster/i.test(t.data.text))!;
}

beforeEach(() => { tasksRef = null; mikeId = ""; });

describe("Chat: a capture links the one contact it names (memory_v1)", () => {
  it("flag on, the task is Mike's", async () => {
    flags.memoryOn = true;
    const t = await captureInChat("u-chat-loop-on");
    expect(t.data.personId).toBe(mikeId);
  });

  it("flag off, exactly as before: nobody is filed", async () => {
    flags.memoryOn = false;
    const t = await captureInChat("u-chat-loop-off");
    expect(t.data.personId).toBeUndefined();
  });
});
