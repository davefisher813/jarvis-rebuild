// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { AIService } from "../ai/AIService";
import TodaySuggestions from "./TodaySuggestions";
import { emit, eventLog } from "../events";

// The suggestion card: at most ONE row, never echoing a visible Up Next
// task. It renders headless inside Today's Heads Up stream (2026-08-19),
// so presence is asserted on the row itself and on its dismiss control.

describe("TodaySuggestions", () => {
  it("renders nothing when AI is off and no pattern exists", () => {
    render(<NotesProvider userId="u1"><TodaySuggestions ai={new AIService({ available: false })} /></NotesProvider>);
    expect(screen.queryByLabelText("Dismiss")).not.toBeInTheDocument();
  });

  it("shows exactly one AI row, dismissible on the swipe", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ text: '["Email Sam the Q3 Plan","Reach out to Maya"]' }),
      text: async () => "",
    })) as unknown as typeof fetch;
    render(<NotesProvider userId="u2"><TodaySuggestions ai={new AIService({ available: true, getToken: () => "t", fetchImpl })} /></NotesProvider>);
    // Law 3E: the insight is a whisper until tapped.
    await waitFor(() => expect(screen.getByText(/Noticed · Email Sam the Q3 Plan/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Noticed · Email Sam the Q3 Plan/));
    await waitFor(() => expect(screen.getByText("Email Sam the Q3 Plan")).toBeInTheDocument());
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
    // one row at a time: the second suggestion waits its turn
    expect(screen.queryByText("Reach out to Maya")).not.toBeInTheDocument();
    // dismissing from the corner reveals the next candidate
    fireEvent.click(screen.getByText("Dismiss"));
    await waitFor(() => expect(screen.queryByText("Email Sam the Q3 Plan")).not.toBeInTheDocument());
  });
});

describe("TodaySuggestions planning pattern (Brain Personalization Phase 2, 2026-08-06)", () => {
  beforeEach(() => { eventLog.clear(); });

  it("surfaces a real duration-correction pattern, and Remember This clears it", async () => {
    for (let i = 0; i < 3; i++) {
      emit({ type: "plan.duration_corrected", entityType: "task", entityId: `t${i}`, props: { category: "work", n: 20 } });
    }
    render(<NotesProvider userId="u3"><TodaySuggestions ai={new AIService({ available: false })} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(/^Noticed ·/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/^Noticed ·/));
    await waitFor(() => expect(screen.getByText("Dismiss")).toBeInTheDocument());
    expect(screen.getByText(/work tasks run 20 min long/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Remember This"));
    await waitFor(() => expect(screen.queryByText(/Your work tasks/)).not.toBeInTheDocument());
  });

  it("shows nothing from a single correction, not enough evidence for a pattern", () => {
    emit({ type: "plan.duration_corrected", entityType: "task", entityId: "t1", props: { category: "work", n: 20 } });
    render(<NotesProvider userId="u4"><TodaySuggestions ai={new AIService({ available: false })} /></NotesProvider>);
    expect(screen.queryByText("Dismiss")).not.toBeInTheDocument();
  });
});

// The routine that builds itself (2026-08-09): repeated events surface as a
// one-tap routine block through the same JARVIS Noticed row.
describe("TodaySuggestions routine candidate", () => {
  beforeEach(() => { eventLog.clear(); });

  function Seed({ done }: { done: () => void }) {
    const schedule = useSchedule();
    useEffect(() => {
      void (async () => {
        const d = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
        await schedule.createEvent("Gym", { date: d(2), start: "06:00", end: "07:00" });
        await schedule.createEvent("Gym", { date: d(9), start: "06:00", end: "07:00" });
        await schedule.createEvent("Gym", { date: d(16), start: "06:00", end: "07:00" });
        done();
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }

  it("offers the learned block and Add to Routine actually writes it", async () => {
    let seeded = false;
    const ai = new AIService({ available: false });
    const { rerender } = render(
      <NotesProvider userId="u-routine"><Seed done={() => { seeded = true; }} /></NotesProvider>,
    );
    await waitFor(() => expect(seeded).toBe(true));
    // Mount the suggestions AFTER seeding so its one read sees the events.
    rerender(
      <NotesProvider userId="u-routine"><RoutineProbe /><TodaySuggestions ai={ai} /></NotesProvider>,
    );
    await waitFor(() => expect(screen.getByText(/^Noticed ·/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/^Noticed ·/));
    await waitFor(() => expect(screen.getByText(/Gym · Around 6 AM/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("Add to Routine"));
    await waitFor(() => expect(screen.queryByText(/Gym has landed/)).not.toBeInTheDocument());
    await waitFor(async () => {
      expect(probedRoutine?.protectedBlocks?.some((b) => b.label === "Gym" && b.startMin === 360)).toBe(true);
    });
  });
});

// Reads the live routine record so the test can assert the accept actually
// persisted the block, not just closed the row.
import { useSchedule, useRoutine } from "../data/NotesProvider";
import { useEffect } from "react";
import type { RoutineData } from "../routine/types";
let probedRoutine: RoutineData | null = null;
function RoutineProbe() {
  const routine = useRoutine();
  useEffect(() => {
    const id = setInterval(() => { void routine.get().then((r) => { probedRoutine = r; }); }, 50);
    return () => clearInterval(id);
  }, [routine]);
  return null;
}

// BEING-KNOWN MOMENTS (Brain Layer 2, item 04). Derivations on the durable
// event log surface through the same one-row Noticed pipeline; accepting one
// writes a strand with its receipts, and the moment never comes back.
describe("TodaySuggestions being-known moments", () => {
  beforeEach(() => { eventLog.clear(); });

  const completions = (n: number, hour: number) => {
    const base = new Date();
    for (let i = 0; i < n; i++) {
      const at = new Date(base.getTime() - i * 86400000);
      at.setHours(hour, 30, 0, 0);
      vi.setSystemTime(at);
      emit({ type: "task.completed", entityType: "task", entityId: `c${i}`, props: { category: "work" } });
    }
    vi.useRealTimers();
  };

  it("says nothing on a thin log, which is most days", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    completions(4, 10);
    render(<NotesProvider userId="b1"><TodaySuggestions ai={new AIService({ available: false })} /></NotesProvider>);
    await waitFor(() => expect(screen.queryByText("Dismiss")).not.toBeInTheDocument());
  });

  it("surfaces the completion window once the evidence is real, with its own count", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    completions(14, 10);
    render(<NotesProvider userId="b2"><TodaySuggestions ai={new AIService({ available: false })} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(/^Noticed ·/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/^Noticed ·/));
    await waitFor(() => expect(screen.getByText(/Your tasks get done between/)).toBeInTheDocument());
    // The Notice law's sub line carries the receipt, so the claim is checkable
    // before the user ever taps.
    // The quiet line wraps the figure in its own bright span (Law 3E), so the
    // match reads the composed line rather than one text node.
    expect(screen.getByText((_, el) => el?.className === "conn-meta" && /14 Finishes there/.test(el.textContent ?? ""))).toBeInTheDocument();
    expect(screen.getByText("Remember This")).toBeInTheDocument();
  });

  it("Remember This clears the moment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    completions(14, 10);
    render(<NotesProvider userId="b3"><TodaySuggestions ai={new AIService({ available: false })} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(/^Noticed ·/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/^Noticed ·/));
    await waitFor(() => expect(screen.getByText("Remember This")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Remember This"));
    await waitFor(() => expect(screen.queryByText(/Your tasks get done between/)).not.toBeInTheDocument());
  });
});

// S4-Q21 (2026-09-04): the nightly pass can pick up to three moments in one
// day (brain/nightly.ts's DAILY_PROPOSAL_CAP), but only the single one that
// won the race against every other candidate ever had anywhere to render --
// dismissing it never advanced to the next, and nothing else on the app ever
// showed it. Today's one-row law is right and stays; these prove the other
// half: What JARVIS Knows renders every moment the pass chose.
describe("TodaySuggestions the whole day's moments (S4-Q21)", () => {
  // The nightly pass holds its pick for the rest of the (real) calendar day
  // in localStorage, keyed by today's date -- cleared here so each test
  // gets a fresh pass over exactly what it seeds, not a stale pick a sibling
  // test already wrote for today.
  beforeEach(() => { eventLog.clear(); localStorage.clear(); });

  // Two independently real derivations sharing one window: ordinary task
  // completions bunched at 10 AM (completion_window) and workout completions
  // bunched at 6 PM (training_window, gated on kind: "workout" so the two
  // never compete for the same band).
  const seedTwoMoments = () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const base = new Date();
    for (let i = 0; i < 14; i++) {
      const at = new Date(base.getTime() - i * 86400000);
      at.setHours(10, 30, 0, 0);
      vi.setSystemTime(at);
      emit({ type: "task.completed", entityType: "task", entityId: `c${i}`, props: { category: "work" } });
    }
    for (let i = 0; i < 14; i++) {
      const at = new Date(base.getTime() - i * 86400000);
      at.setHours(18, 30, 0, 0);
      vi.setSystemTime(at);
      emit({ type: "task.completed", entityType: "task", entityId: `w${i}`, props: { kind: "workout" } });
    }
    vi.useRealTimers();
  };

  it("Today still shows exactly one, its quiet row untouched", async () => {
    seedTwoMoments();
    render(<NotesProvider userId="b-today"><TodaySuggestions ai={new AIService({ available: false })} /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(/^Noticed ·/)).toBeInTheDocument());
    // One row only: the second moment gets no whisper, no card, no trace.
    expect(screen.getAllByText(/^Noticed ·/)).toHaveLength(1);
    expect(screen.queryByText(/You train between/)).not.toBeInTheDocument();
  });

  it("What JARVIS Knows renders both, not just whichever one won the row", async () => {
    seedTwoMoments();
    render(<NotesProvider userId="b-brain"><TodaySuggestions ai={new AIService({ available: false })} always /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(/Your tasks get done between/)).toBeInTheDocument());
    // The second moment is not a whisper here -- What JARVIS Knows opens
    // every card it holds, immediately.
    expect(screen.getByText(/You train between/)).toBeInTheDocument();
    expect(screen.getAllByText("Remember This")).toHaveLength(2);
  });

  it("dismissing the extra moment removes only that one", async () => {
    seedTwoMoments();
    render(<NotesProvider userId="b-dismiss"><TodaySuggestions ai={new AIService({ available: false })} always /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(/You train between/)).toBeInTheDocument());
    // The primary row renders first, so its own Dismiss is first in the DOM;
    // the extra card's is last.
    const dismissButtons = screen.getAllByText("Dismiss");
    fireEvent.click(dismissButtons[dismissButtons.length - 1]!);
    await waitFor(() => expect(screen.queryByText(/You train between/)).not.toBeInTheDocument());
    expect(screen.getByText(/Your tasks get done between/)).toBeInTheDocument();
  });

  it("accepting the extra moment writes the strand and clears just that card", async () => {
    seedTwoMoments();
    render(<NotesProvider userId="b-accept"><TodaySuggestions ai={new AIService({ available: false })} always /></NotesProvider>);
    await waitFor(() => expect(screen.getByText(/You train between/)).toBeInTheDocument());
    const remember = screen.getAllByText("Remember This");
    fireEvent.click(remember[remember.length - 1]!);
    await waitFor(() => expect(screen.queryByText(/You train between/)).not.toBeInTheDocument());
    expect(screen.getByText(/Your tasks get done between/)).toBeInTheDocument();
  });
});
