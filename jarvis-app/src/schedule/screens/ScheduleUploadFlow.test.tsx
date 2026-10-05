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

// The photo path draws the thumbnail card; the encoder needs a canvas the test environment lacks.
vi.mock("../../shared/imageEncode", () => ({ encodeImageForVision: async () => ({ data: "AAAA", mediaType: "image/png" }) }));

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
    // Casing sweep 2 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "1h 30m").
    expect(screen.getByText(/No Time Found/)).toBeInTheDocument();
    const add = screen.getByText("Add 2 to Calendar");
    expect(add).toBeDisabled();
    expect(screen.getByText(/1 Row Has No Time Yet/)).toBeInTheDocument();
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
      expect(seen?.message).toBe("Couldn't Add Them All · 1 Added Before It Stopped");
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

// 2026-09-26: this screen exists to check the times it read, so a review
// row's facts sit in the wrapping, unclamped .conn-meta, never the one-line
// .facts whose last fact gives way (the end time and "Updates existing" were
// being cut off at 390px).
describe("Schedule upload: the review row shows every fact it read", () => {
  it("keeps the date and the time range in a wrapping meta line", async () => {
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), "u-upload-4");
    await review(fakeAI(reply([
      { title: "Practice", month: 9, day: 13, year: 2026, start: "17:00", end: "18:30", location: "" },
    ])), svc);
    const row = screen.getByText("Practice").closest(".row") as HTMLElement;
    expect(row.querySelector(".facts"), "never the one-line facts row").toBeNull();
    const facts = Array.from(row.querySelectorAll(".conn-meta > .fact"));
    expect(facts.map((f) => f.className)).toEqual(["fact date", "fact date"]);
    expect(facts[1]!.textContent).toMatch(/5:00.*6:30/);
  });
});

// THE FIX SHEET'S OTHER ANSWERS ARE WRITTEN (2026-10-04). applyFix copied
// eight columns and dropped the rest, so a repeating row fixed with "Until 30
// Nov" imported as an endless series, and the Link, Notes, Every 2 Weeks and
// Training door the sheet drew were accepted and thrown away.
describe("Schedule upload: what the fix sheet sets reaches the calendar", () => {
  async function fixRow(svc: ScheduleService) {
    render(
      <ScheduleUploadFlow ai={fakeAI(reply([
        { title: "Practice", month: 9, day: 13, year: 2026, start: "17:00", end: "18:30", location: "" },
      ]))} svc={svc} categories={CATS} existingEvents={[]} onDone={vi.fn()} onCancel={() => {}} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste the Schedule/), { target: { value: "anything" } });
    fireEvent.click(screen.getByText("Read the Pasted Text"));
    await screen.findByText("Review the Schedule");
  }

  it("a repeating row keeps its end, cadence, link, notes and training door", async () => {
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), "u-upload-fix-1");
    await fixRow(svc);
    fireEvent.click(screen.getByText("Once")); // Repeats weekly
    fireEvent.click(screen.getByLabelText("Fix Practice"));
    // Apply To means nothing on a staged row, so it is not offered.
    expect(screen.queryByLabelText("Apply to")).toBeNull();
    fireEvent.click(screen.getByLabelText("Until"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Pick a Date" }));
    fireEvent.change(screen.getByLabelText("Until date"), { target: { value: "2026-11-30" } });
    fireEvent.click(screen.getByLabelText("Every"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "2 Weeks" }));
    fireEvent.change(screen.getByLabelText("Meeting Link"), { target: { value: "https://zoom.example/j/1" } });
    fireEvent.change(screen.getByLabelText("Meeting Notes"), { target: { value: "Bring cleats" } });
    fireEvent.click(screen.getByLabelText("Training door"));
    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(await screen.findByText("Add 1 to Calendar"));
    await waitFor(async () => expect(await svc.listEvents()).toHaveLength(1));
    const [ev] = await svc.listEvents();
    expect(ev!.data).toMatchObject({
      recurrence: "weekly", until: "2026-11-30", interval: 2,
      url: "https://zoom.example/j/1", notes: "Bring cleats", gym: true,
    });
  });

  it("travel and buffer set beside a place are written", async () => {
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), "u-upload-fix-2");
    await fixRow(svc);
    fireEvent.click(screen.getByLabelText("Fix Practice"));
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Rink 2" } });
    fireEvent.click(screen.getByLabelText("Travel"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "20 Min" }));
    fireEvent.click(screen.getByLabelText("Buffer"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "10 Min" }));
    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(await screen.findByText("Add 1 to Calendar"));
    await waitFor(async () => expect(await svc.listEvents()).toHaveLength(1));
    expect((await svc.listEvents())[0]!.data).toMatchObject({ location: "Rink 2", travelMin: 20, bufferMin: 10 });
  });

  it("an update to a matched 2 Weeks series keeps its cadence, and Undo puts the whole event back", async () => {
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), "u-upload-fix-3");
    const id = (await svc.createEvent("Practice", { date: "2026-09-13", start: "17:00", end: "18:00", recurrence: "weekly", interval: 2, url: "https://old.example", category: "c1" }))!;
    const existing = await svc.listEvents();
    const onDone = vi.fn();
    render(
      <ScheduleUploadFlow ai={fakeAI(reply([
        { title: "Practice", month: 9, day: 13, year: 2026, start: "17:00", end: "18:30", location: "" },
      ]))} svc={svc} categories={CATS} existingEvents={existing} onDone={onDone} onCancel={() => {}} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste the Schedule/), { target: { value: "anything" } });
    fireEvent.click(screen.getByText("Read the Pasted Text"));
    await screen.findByText("Review the Schedule");
    fireEvent.click(screen.getByText("Once")); // Repeats weekly
    // Opening the fix sheet and changing something else must not reset it.
    fireEvent.click(screen.getByLabelText("Fix Practice"));
    expect(screen.getByLabelText("Every").textContent).toContain("2 Weeks");
    fireEvent.click(screen.getByLabelText("Until"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Pick a Date" }));
    fireEvent.change(screen.getByLabelText("Until date"), { target: { value: "2026-11-30" } });
    fireEvent.change(screen.getByLabelText("Meeting Link"), { target: { value: "https://new.example" } });
    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(await screen.findByText("Add 1 to Calendar"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const after = (await svc.event(id))!;
    expect(after).toMatchObject({ interval: 2, end: "18:30", until: "2026-11-30", url: "https://new.example" });
    await onDone.mock.calls[0]![0].undo();
    const back = (await svc.event(id))!;
    expect(back.end).toBe("18:00");
    expect(back.interval).toBe(2);
    expect(back.url).toBe("https://old.example");
    expect(back.until).toBeUndefined();
  });
  // 2026-10-05: the other tap order. Fix and Save while the row is Once (the
  // sheet hands back no interval), then Repeats: the seeded 2 Weeks survives.
  it("a matched 2 Weeks series keeps its cadence when it is fixed before Repeats is tapped", async () => {
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), "u-upload-fix-3b");
    const id = (await svc.createEvent("Practice", { date: "2026-09-13", start: "17:00", end: "18:00", recurrence: "weekly", interval: 2, category: "c1" }))!;
    const existing = await svc.listEvents();
    const onDone = vi.fn();
    render(
      <ScheduleUploadFlow ai={fakeAI(reply([
        { title: "Practice", month: 9, day: 13, year: 2026, start: "17:00", end: "18:00", location: "" },
      ]))} svc={svc} categories={CATS} existingEvents={existing} onDone={onDone} onCancel={() => {}} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste the Schedule/), { target: { value: "anything" } });
    fireEvent.click(screen.getByText("Read the Pasted Text"));
    await screen.findByText("Review the Schedule");
    fireEvent.click(screen.getByLabelText("Fix Practice"));
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Rink 2" } });
    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(await screen.findByText("Once")); // Repeats weekly, after the fix
    fireEvent.click(await screen.findByText("Add 1 to Calendar"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(await svc.event(id)).toMatchObject({ recurrence: "weekly", interval: 2, location: "Rink 2" });
  });
  it("an update to a matched event writes the trip and the training door the sheet set", async () => {
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), "u-upload-fix-4");
    const id = (await svc.createEvent("Practice", { date: "2026-09-13", start: "17:00", end: "18:00", category: "c1" }))!;
    const existing = await svc.listEvents();
    const onDone = vi.fn();
    render(
      <ScheduleUploadFlow ai={fakeAI(reply([
        { title: "Practice", month: 9, day: 13, year: 2026, start: "17:00", end: "18:30", location: "" },
      ]))} svc={svc} categories={CATS} existingEvents={existing} onDone={onDone} onCancel={() => {}} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste the Schedule/), { target: { value: "anything" } });
    fireEvent.click(screen.getByText("Read the Pasted Text"));
    await screen.findByText("Review the Schedule");
    fireEvent.click(screen.getByLabelText("Fix Practice"));
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Rink 2" } });
    fireEvent.click(screen.getByLabelText("Travel"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "20 Min" }));
    fireEvent.click(screen.getByLabelText("Training door"));
    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(await screen.findByText("Add 1 to Calendar"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(await svc.event(id)).toMatchObject({ location: "Rink 2", travelMin: 20, gym: true });
  });
});

// THE NUMBER RULE (Dave 2026-10-05, "Earlier 2 blocks"): the thumbnail card's count is a title,
// and the word behind the number is capitalized, singular and plural.
describe("Schedule upload: the photo card follows the number rule (2026-10-05)", () => {
  const readPhoto = async (events: Record<string, unknown>[], uid: string) => {
    const svc = new ScheduleService(new Store(new InMemoryAdapter()), uid);
    render(
      <ScheduleUploadFlow ai={fakeAI(reply(events))} svc={svc} categories={CATS} existingEvents={[]} onDone={() => {}} onCancel={() => {}} />,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "s.png", { type: "image/png" })] } });
    await screen.findByText("Review the Schedule");
    return document.body;
  };
  const ev = (title: string, day: number) => ({ title, month: 9, day, year: 2026, start: "17:00", end: "18:00", location: "" });

  it("says '2 Events Found' for two and '1 Event Found' for one", async () => {
    const two = await readPhoto([ev("A", 12), ev("B", 13)], "u-upload-count-2");
    expect(two.querySelector(".upload-thumb")!.parentElement!.querySelector(".conn-name")!.textContent).toBe("2 Events Found");
  });

  it("singular", async () => {
    const one = await readPhoto([ev("A", 12)], "u-upload-count-1");
    expect(one.querySelector(".upload-thumb")!.parentElement!.querySelector(".conn-name")!.textContent).toBe("1 Event Found");
  });
});
