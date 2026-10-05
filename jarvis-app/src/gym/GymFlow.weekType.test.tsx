// @vitest-environment jsdom
//
// A BACK-OFF WEEK IS A LABEL, AND THE SHEET SAYS SO (2026-10-04). The flag on
// a program week is stored and shown back as the Back-Off fact; no session,
// target or progression reads it to change a weight or a set. The chips sat
// under a heading of "Load", which promised exactly that, so they now sit under
// "Week Type". Driven through the real flow: Manage, Add a Week.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useGym } from "../data/NotesProvider";
import type { GymService } from "./GymService";
import GymFlow from "./GymFlow";

vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

beforeEach(() => { localStorage.clear(); });

const PROGRAM = {
  name: "Block",
  weeks: [{ id: "w1", label: "Week 1", days: [{ id: "d1", name: "Push", exercises: [] }] }],
};

const TWO_WEEKS = {
  name: "Block",
  weeks: [
    { id: "w1", label: "Week 1", days: [{ id: "d1", name: "Push", exercises: [] }] },
    { id: "w2", label: "Week 2", backOff: true, days: [{ id: "d2", name: "Push", exercises: [] }] },
  ],
};

async function mount(user: string, program: typeof PROGRAM = PROGRAM) {
  let gym: GymService | null = null;
  function Grab() { gym = useGym(); return null; }
  const view = render(<NotesProvider userId={user}><Grab /></NotesProvider>);
  await waitFor(() => expect(gym).toBeTruthy());
  await act(async () => { await gym!.createProgram(program); });
  view.rerender(<NotesProvider userId={user}><Grab /><GymFlow onBack={() => {}} /></NotesProvider>);
}

describe("GymFlow: the week sheet names the back-off chips for what they are", () => {
  it("New Week offers Normal Week and Back-Off Week under Week Type, never Load", async () => {
    await mount("gym-week-type-new");
    fireEvent.click(await screen.findByText("Manage", undefined, { timeout: 4000 }));
    fireEvent.click(await screen.findByText("Add a Week"));
    await waitFor(() => expect(screen.getByText("New Week")).toBeInTheDocument());
    expect(screen.getByText("Week Type")).toBeInTheDocument();
    expect(screen.getByText("Back-Off Week")).toBeInTheDocument();
    expect(screen.queryByText("Load")).toBeNull();
  });

  it("Duplicate and Bump asks for the same Week Type, since only the steppers change a weight", async () => {
    await mount("gym-week-type-bump", TWO_WEEKS as unknown as typeof PROGRAM);
    // The stored flag is shown back as an amber fact on the week's line (no pill in a row, Dave 2026-10-05).
    expect(await screen.findByText(/, Back-Off$/, { selector: ".fact" }, { timeout: 4000 })).toBeInTheDocument();
    fireEvent.click(await screen.findByText("Week 1"));
    fireEvent.click(await screen.findByText(/Duplicate Week 1/));
    await waitFor(() => expect(screen.getByText("Add to Every Weight")).toBeInTheDocument());
    expect(screen.getByText("Week Type")).toBeInTheDocument();
    expect(screen.queryByText("Load")).toBeNull();
  });
});
