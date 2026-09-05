// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import ScheduleUploadFlow from "./ScheduleUploadFlow";
import { ScheduleService } from "../ScheduleService";
import type { AIService } from "../../ai/AIService";
import { subscribeToast, resetToasts } from "../../shared/toast";
import type { ToastState } from "../../shared/toast";

const CATS = [{ id: "c1", name: "Sports", color: "blue" as const }];

// The model's answer, as the parser receives it.
const reply = (events: Record<string, unknown>[]) => JSON.stringify({ events });

const fakeAI = (text: string) => ({ available: true, complete: async () => text }) as unknown as AIService;

// Get to the review list the way the user does: paste, read, review.
async function review(ai: AIService, svc: ScheduleService, onDone = vi.fn()) {
  render(
    <ScheduleUploadFlow ai={ai} svc={svc} categories={CATS} existingEvents={[]} onDone={onDone} onCancel={() => {}} />,
  );
  fireEvent.change(screen.getByPlaceholderText(/Paste the Schedule/), { target: { value: "anything" } });
  fireEvent.click(screen.getByText("Read the Pasted Text"));
  await screen.findByText("Review the Schedule");
  return onDone;
}

// SCHED-F-08 (2026-09-05): "No time found rows import at 9:00 AM without
// saying so, and a failed import sticks on Adding...". The row said the
// source gave no time and the importer wrote 09:00 anyway, and the loop had
// no catch, so a write that threw left the button saying "Adding..." for
// good over rows that had already landed.
describe("Schedule upload: a row with no time cannot be imported unreviewed", () => {
  it("holds Add back, says how many need a time, and lets Skip release it", async () => {
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), "u-upload-1");
    await review(fakeAI(reply([
      { title: "vs Eagles", month: 9, day: 12, year: 2026, start: null, end: null, location: "" },
      { title: "Practice", month: 9, day: 13, year: 2026, start: "17:00", end: "18:30", location: "" },
    ])), svc);
    expect(screen.getByText(/No time found/)).toBeInTheDocument();
    const add = screen.getByText("Add 2 to Calendar");
    expect(add).toBeDisabled();
    expect(screen.getByText(/1 Row has no time yet/)).toBeInTheDocument();
    // Skipping the flagged row is the other way out, and it releases Add.
    fireEvent.click(screen.getAllByText("Skip")[0]!);
    await waitFor(() => expect(screen.getByText("Add 1 to Calendar")).toBeEnabled());
    expect(screen.queryByText(/no time yet/)).not.toBeInTheDocument();
  });

  it("writes nothing at all while a flagged row is still active", async () => {
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), "u-upload-2");
    const onDone = await review(fakeAI(reply([
      { title: "vs Eagles", month: 9, day: 12, year: 2026, start: null, end: null, location: "" },
    ])), svc);
    fireEvent.click(screen.getByText("Add 1 to Calendar"));
    await waitFor(() => expect(screen.getByText("Add 1 to Calendar")).toBeInTheDocument());
    expect(await svc.listEvents()).toHaveLength(0);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("Schedule upload: an import that fails partway says so and offers the way back", () => {
  it("clears Adding..., keeps what landed out of a retry, and the toast can undo it", async () => {
    resetToasts();
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), "u-upload-3");
    const real = svc.createEvent.bind(svc);
    let n = 0;
    vi.spyOn(svc, "createEvent").mockImplementation(async (title, opts) => {
      n += 1;
      if (n === 2) throw new Error("no signal");
      return real(title, opts);
    });
    let toast: ToastState | null = null;
    const stop = subscribeToast((t) => { if (t) toast = t; });
    try {
      const onDone = await review(fakeAI(reply([
        { title: "vs Eagles", month: 9, day: 12, year: 2026, start: "10:00", end: "11:30", location: "" },
        { title: "vs Hawks", month: 9, day: 19, year: 2026, start: "10:00", end: "11:30", location: "" },
      ])), svc);
      fireEvent.click(screen.getByText("Add 2 to Calendar"));
      // The button comes back, on what is left to add.
      await waitFor(() => expect(screen.getByText("Add 1 to Calendar")).toBeInTheDocument());
      expect(screen.queryByText("Adding...")).not.toBeInTheDocument();
      expect(onDone).not.toHaveBeenCalled();
      const seen = toast as ToastState | null;
      expect(seen?.message).toBe("Couldn't add them all · 1 Added before it stopped");
      expect(seen?.actionLabel).toBe("Undo");
      // The one that landed is really there, and Undo takes it back.
      expect(await svc.listEvents()).toHaveLength(1);
      seen?.onAction?.();
      await waitFor(async () => expect(await svc.listEvents()).toHaveLength(0));
    } finally {
      stop();
      vi.restoreAllMocks();
    }
  });
});
