// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useSchedule } from "../data/NotesProvider";
import { HyperfocusLine, useHyperfocusGuard } from "./useHyperfocusGuard";
import { useEffect, useState } from "react";
import { todayISO } from "../tasks/grouping";

// UP-CORE-06 (2026-09-05): the guard was built for any focus surface and
// mounted on exactly one. These pin the shared hook the note editor and the
// live gym session now use: it reads today's real events, it renders the
// same line Up Next renders, and outside a provider it says nothing rather
// than throwing (a preview or a harness must still mount).

function Probe({ at = "08:00" }: { at?: string }) {
  const guard = useHyperfocusGuard(() => at);
  return <HyperfocusLine guard={guard} />;
}

// Seeds one event far enough ahead to be a fact rather than a warning, then
// mounts the probe on the same store.
function Seeded() {
  const schedule = useSchedule();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void schedule.createEvent("Team sync", { date: todayISO(), start: "15:00" }).then(() => setReady(true));
  }, [schedule]);
  return ready ? <Probe /> : null;
}

describe("useHyperfocusGuard", () => {
  it("states the next commitment on any surface that mounts it", async () => {
    render(<NotesProvider userId="u-guard"><Seeded /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(/Team sync at 3 PM/)).toBeInTheDocument());
  });

  it("says nothing outside a provider, rather than refusing to mount", () => {
    render(<Probe />);
    expect(document.querySelector(".conn-meta")).toBeNull();
  });

  it("renders the warn tone only when the producer says so", () => {
    const { rerender } = render(<HyperfocusLine guard={{ text: "Team sync in 9 min", warn: true }} />);
    expect(document.querySelector(".urgency-warn")).toBeTruthy();
    rerender(<HyperfocusLine guard={{ text: "Team sync at 3 PM", warn: false }} />);
    expect(document.querySelector(".urgency-warn")).toBeNull();
    expect(screen.getByText("Team sync at 3 PM")).toBeInTheDocument();
  });
});
