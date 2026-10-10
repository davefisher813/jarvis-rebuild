// @vitest-environment jsdom
// SPEC MOVED (2026-08-15, Smart Paste, addendum item 1): capture no longer
// previews and asks for a confirm tap. It saves INSTANTLY and offers
// post-action correction (refile chips, undo) on the receipt. These tests
// replaced the old preview-flow tests deliberately; the old behavior was not
// broken, it was retired.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect, useState } from "react";
import type React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useOptionalStrands, useTasks, useCategories, usePeople, useLedger } from "../data/NotesProvider";
import type { LedgerService } from "../money/ledger/LedgerService";
import { AIService } from "../ai/AIService";
import QuickCapture from "./QuickCapture";
import { recordCapture } from "../paste/captureLog";
import { TasksService } from "../tasks/TasksService";

// S4-Q22 (2026-09-04) needs to see the honest "Brain is full" toast text,
// which the earlier tests in this file never had to inspect. Same mock shape
// as ProfilePage.test.tsx: a captured fn standing in for the real module.
const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (...a: unknown[]) => showToast(...a) }));

// Phase 0 (2026-10-10): the two flags this door reads, on the seam every
// flagged test uses (connections/google/sync.test.ts). Both off by default,
// so every test above runs against the build's own answer.
const flags = vi.hoisted(() => ({ trustOn: false, memoryOn: false }));
vi.mock("../substrate/flags", async (orig) => {
  const real = await orig<typeof import("../substrate/flags")>();
  return {
    ...real,
    flagOn: (f: Parameters<typeof real.flagOn>[0]) =>
      f === "trust_v1" ? flags.trustOn : f === "memory_v1" ? flags.memoryOn : real.flagOn(f),
  };
});

beforeEach(() => localStorage.clear());

let strandsRef: ReturnType<typeof useOptionalStrands> | null = null;
let tasksRef: ReturnType<typeof useTasks> | null = null;
let catsRef: ReturnType<typeof useCategories> | null = null;
function CaptureStrands() {
  strandsRef = useOptionalStrands();
  tasksRef = useTasks();
  catsRef = useCategories();
  return null;
}

describe("QuickCapture (Smart Paste)", () => {
  it("saves instantly with no AI in the build and shows the receipt with refile chips", async () => {
    const onClose = vi.fn();
    render(
      <NotesProvider userId="u1">
        <QuickCapture ai={new AIService({ available: false })} onClose={onClose} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "Renew the domain" } });
    fireEvent.click(screen.getByText("Capture"));
    // Instant save: the receipt appears without any confirm step.
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(screen.getByText("Renew the Domain")).toBeInTheDocument();
    expect(screen.getByText("Undo")).toBeInTheDocument();
    // The kind chips are present for post-action correction.
    expect(screen.getByText("Task")).toBeInTheDocument();
    expect(screen.getByText("Event")).toBeInTheDocument();
    expect(screen.getByText("Note")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("asks the AI only for unconfident text and saves its answer instantly", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ text: '{"kind":"event","title":"Standup","start":"09:00"}' }),
      text: async () => "",
    })) as unknown as typeof fetch;
    render(
      <NotesProvider userId="u1">
        <QuickCapture ai={new AIService({ available: true, getToken: () => "tok", fetchImpl })} onClose={() => {}} />
      </NotesProvider>,
    );
    // "standup tomorrow": a date with no time and no imperative opener is
    // the deterministic layer's unconfident case, so the AI gets a say.
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "standup tomorrow" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(screen.getByText("Standup")).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a confident paste never calls the AI at all", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ text: "{}" }), text: async () => "" })) as unknown as typeof fetch;
    render(
      <NotesProvider userId="u1">
        <QuickCapture ai={new AIService({ available: true, getToken: () => "tok", fetchImpl })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "call the plumber back" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("the exact same paste within 7 days is flagged, with Save Anyway as the override", async () => {
    const ai = new AIService({ available: false });
    const { unmount } = render(
      <NotesProvider userId="u1">
        <QuickCapture ai={ai} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "call the plumber back" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    unmount();

    render(
      <NotesProvider userId="u1">
        <QuickCapture ai={ai} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "call the plumber back" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText(/You captured this exact text/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("Save Anyway"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });
});

// S4-Q22 (2026-09-04): selfFact.ts has always said "the receipt renders the
// category with chips to change it, same as every other capture" -- these
// prove that sentence is now true. No prior test file touched the fact
// lane's category chips at all.
describe("QuickCapture fact category chips (S4-Q22)", () => {
  beforeEach(() => { showToast.mockReset(); strandsRef = null; });

  it("offers the strand's six buckets, with the guessed one already active", async () => {
    render(
      <NotesProvider userId="u-fact-buckets">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    // selfFact.ts's own example sentence: SHAPES matches "I never...", and the
    // weekday bucket (routine) matches before any other, since "Sundays" hits
    // no energy words first.
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "I never work out on Sundays" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    // §AM (2026-09-26): the bucket is the lit chip, and the receipt line no
    // longer says it again ("Fact · Routine · From your paste" repeated both
    // chips word for word). A plain self-fact has nothing else to say.
    expect(document.querySelector(".capture-saved .conn-meta")).toBeNull();
    expect(document.querySelector(".capture-saved .facts")).toBeNull();
    expect(screen.getByRole("radio", { name: "Routine" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Energy" })).toHaveAttribute("aria-checked", "false");
    for (const label of ["Energy", "Work Style", "Writing", "People", "Values", "Routine"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
  });

  it("tapping a different bucket moves the fact", async () => {
    render(
      <NotesProvider userId="u-fact-move">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "I never work out on Sundays" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "Energy" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Energy" })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("radio", { name: "Routine" })).toHaveAttribute("aria-checked", "false");
  });

  it("a full bucket refuses honestly, and the chip stays where it was", async () => {
    render(
      <NotesProvider userId="u-fact-full">
        <CaptureStrands />
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    await waitFor(() => expect(strandsRef).toBeTruthy());
    await act(async () => {
      for (let i = 0; i < 12; i++) await strandsRef!.add("v " + i, "energy", "2026-01-01");
    });

    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "I never work out on Sundays" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("radio", { name: "Energy" }));
    // Casing sweep 3 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "About 1 Min").
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: "The Brain Is Full · Prune It in What JARVIS Knows" }));

    // The refusal moved nothing: the fact is still under Routine.
    expect(screen.getByRole("radio", { name: "Routine" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Energy" })).toHaveAttribute("aria-checked", "false");
  });

  // SHELL-F-02 (2026-09-05): the Fact chip on a saved task, with the Brain
  // full. This used to delete the task and say nothing. Now it says the
  // Brain is full, the receipt keeps saying Task, and the task is still in
  // Tasks.
  it("refiling a task to Fact when the Brain is full says so and keeps the task", async () => {
    showToast.mockClear();
    render(
      <NotesProvider userId="u-refile-full">
        <CaptureStrands />
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    await waitFor(() => expect(strandsRef).toBeTruthy());
    await act(async () => {
      // "call the plumber back" matches no fact shape, so it would file
      // under values: fill that bucket to its cap.
      for (let i = 0; i < 12; i++) await strandsRef!.add("v " + i, "values", "2026-01-01");
    });

    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "call the plumber back" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(screen.getByRole("radio", { name: "Task" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: "Fact" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: "The Brain Is Full · Prune It in What JARVIS Knows" }));

    expect(screen.getByRole("radio", { name: "Task" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Fact" })).toHaveAttribute("aria-checked", "false");
    expect(await strandsRef!.list()).toHaveLength(12);
    expect(await tasksRef!.listTasks()).toHaveLength(1);
  });
});

// §AM (2026-09-26): WHAT IT READ, AS FACTS. The receipt line was one grey
// string with its dots typed in, and every fact on it the same grey. Each
// fact now wears what it is: every when in small caps, a bill's amount in
// white, and the dots drawn by the stylesheet, never carried in the words.
describe("QuickCapture receipt reads as facts (§AM)", () => {
  // 2026-09-26: the receipt shows EVERY fact it read, so its facts sit in the
  // wrapping, unclamped .conn-meta, never the one-line .facts whose last fact
  // gives way (a reminder's days and its project were being cut off).
  const receiptFacts = () => Array.from(document.querySelectorAll(".capture-saved .conn-meta > .fact"));

  // THE CLOCK LAW (Dave 2026-10-05): 12-hour with AM or PM whatever the phone's region says.
  it("a reminder's time is 12-hour with AM or PM even where the phone's region is 24-hour", async () => {
    const orig = Date.prototype.toLocaleTimeString;
    Date.prototype.toLocaleTimeString = function (loc?: string | string[], o?: Intl.DateTimeFormatOptions) { return orig.call(this, Array.isArray(loc) && loc.length === 0 ? "en-GB" : loc, o); };
    try {
      render(
        <NotesProvider userId="u-receipt-remind-24h">
          <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
        </NotesProvider>,
      );
      fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "remind me to water the plants at 9pm" } });
      fireEvent.click(screen.getByText("Capture"));
      await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
      expect(receiptFacts().map((f) => f.textContent)[0]).toMatch(/^Reminder 9:00\sPM$/);
    } finally { Date.prototype.toLocaleTimeString = orig; }
  });

  it("a reminder says so beside its time, and every when is small caps", async () => {
    render(
      <NotesProvider userId="u-receipt-remind">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "remind me to water the plants at 9pm" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    const facts = receiptFacts();
    expect(facts.map((f) => f.textContent)).toEqual([expect.stringMatching(/^Reminder 9:00\sPM$/), "Daily"]);
    for (const f of facts) expect(f.className).toBe("fact date");
    expect(document.querySelector(".capture-saved .facts"), "the receipt is never a one-line facts row").toBeNull();
    const line = document.querySelector(".capture-saved .conn-meta")!;
    expect(line.textContent).not.toContain("\u00b7");
    expect(line.textContent).not.toContain("From your paste");
  });

  // UP-CORE-01: a paste read as a bill says so. No chip under the receipt
  // names a bill, so the word is the read; the amount after it is white.
  it("a bill says Bill before its amount, and the amount is a white number", async () => {
    render(
      <NotesProvider userId="u-receipt-bill">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "pay rent $1,200 every month" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    // 2026-09-26: the short whens lead and the bill, the line's words,
    // trails, so a narrow line loses the tail of a name, never the repeat.
    const facts = receiptFacts();
    expect(facts.map((f) => f.textContent)).toEqual(["Monthly", expect.stringMatching(/^Bill \$1,200/)]);
    expect(facts[0]!.className).toBe("fact date");
    const bill = facts[facts.length - 1]!;
    expect(bill.className).toBe("fact");
    expect(bill.querySelector("b")?.textContent).toMatch(/1,200/);
    expect(bill.querySelector("b")?.textContent).not.toContain("Bill");
  });

  // §AK (2026-09-26): the word Bill is already the line's one grey run, so a
  // bill for somebody names them inside that fact ("Bill $50 for Marco")
  // instead of a second grey fact beside it.
  it("a bill for a person is one fact, and the person is not a second grey", async () => {
    let peopleRef: ReturnType<typeof usePeople> | null = null;
    function CapturePeople() { peopleRef = usePeople(); return null; }
    render(
      <NotesProvider userId="u-receipt-bill-who">
        <CapturePeople />
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    await waitFor(() => expect(peopleRef).toBeTruthy());
    await act(async () => { await peopleRef!.create({ name: "Marco", group: "contacts" }); });
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "pay Marco $50 every month" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    const facts = receiptFacts();
    expect(facts.map((f) => f.textContent)).toEqual(["Monthly", expect.stringMatching(/^Bill \$50(\.00)? for Marco$/)]);
    expect(facts[1]!.className).toBe("fact");
    expect(facts[1]!.querySelector("b")?.textContent).toMatch(/^\$50/);
    // The only plain grey fact on the line is the bill; Marco is inside it.
    expect(facts.filter((f) => f.className === "fact")).toHaveLength(1);
  });

  // MONEY LEDGER (hard rule 1): the receipt of a bill says where it went, offers
  // no way to turn it into a task, an event or a note, and Undo takes it out of
  // Money. Pasting it again says it is already there, and files nothing.
  it("a bill's receipt says In Money, offers no task chip, undoes out of Money, and a repeat is refused out loud", async () => {
    let ledgerRef: LedgerService | null = null;
    let taskRef: ReturnType<typeof useTasks> | null = null;
    function Grab() { ledgerRef = useLedger(); taskRef = useTasks(); return null; }
    render(
      <NotesProvider userId="u-receipt-bill-money">
        <Grab />
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    const box = screen.getByLabelText("Paste or Type");
    fireEvent.change(box, { target: { value: "pay Geico $214" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(screen.getByText("In Money")).toBeInTheDocument();
    expect(screen.queryByText("Task")).toBeNull();
    expect(screen.queryByText("Event")).toBeNull();
    expect((await ledgerRef!.listBills()).map((b) => b.data.vendor)).toEqual(["Geico"]);
    expect(await taskRef!.listTasks()).toEqual([]);

    // Undo takes it out of Money.
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(async () => expect(await ledgerRef!.listBills()).toEqual([]));

    // Filed again, then pasted a third time with "Save Anyway": already there.
    fireEvent.click(screen.getByText("Redo"));
    await waitFor(async () => expect(await ledgerRef!.listBills()).toHaveLength(1));
    fireEvent.click(screen.getByText("Capture Another"));
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "pay Geico $214" } });
    fireEvent.click(screen.getByText("Capture"));
    fireEvent.click(await screen.findByText("Save Anyway"));
    expect(await screen.findByText("Already in Money · Geico $214.00")).toBeInTheDocument();
    expect(await ledgerRef!.listBills()).toHaveLength(1);
  });

  // §AM R8 (2026-09-26): a task's date is a due date, so it wears the due
  // window every task row wears: tomorrow is amber, not a neutral date. An
  // event's date only says when, so it stays small caps.
  it("a task due tomorrow is amber; an event's date stays small caps", async () => {
    const { unmount } = render(
      <NotesProvider userId="u-receipt-task-due">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "Renew the domain tomorrow" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    // The resolved date is the task's one fact, and it is amber.
    expect(receiptFacts().map((f) => f.className)).toEqual(["fact warn"]);
    unmount();

    render(
      <NotesProvider userId="u-receipt-event-date">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "Dinner with Sam tomorrow at 7pm" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    // The same day on an event, and its clock time: both neutral.
    expect(receiptFacts().map((f) => f.className)).toEqual(["fact date", "fact date"]);
  });

  it("a recent capture is its kind in grey and its time in small caps", async () => {
    recordCapture({ id: "old-note-2", kind: "note", title: "Gate code", ts: Date.now() - 60000 });
    render(
      <NotesProvider userId="u-recent-facts">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "Renew the domain" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    const row = screen.getByText("Gate code").closest(".row")!;
    const facts = Array.from(row.querySelectorAll(".facts > .fact"));
    expect(facts.map((f) => f.className)).toEqual(["fact", "fact date"]);
    expect(facts[0]!.textContent).toBe("Note");
    expect(row.textContent).not.toContain("\u00b7");
  });

  // THE CLOCK LAW (Dave 2026-10-05): a recent capture's time is 12-hour with AM or PM in a 24-hour region too.
  it("a recent capture's time says AM or PM even where the phone's region is 24-hour", async () => {
    const orig = Date.prototype.toLocaleTimeString;
    Date.prototype.toLocaleTimeString = function (loc?: string | string[], o?: Intl.DateTimeFormatOptions) { return orig.call(this, Array.isArray(loc) && loc.length === 0 ? "en-GB" : loc, o); };
    try {
      recordCapture({ id: "old-note-24h", kind: "note", title: "Locker code", ts: Date.now() - 60000 });
      render(
        <NotesProvider userId="u-recent-24h">
          <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
        </NotesProvider>,
      );
      fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "Renew the domain" } });
      fireEvent.click(screen.getByText("Capture"));
      await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
      const row = screen.getByText("Locker code").closest(".row")!;
      // Today's captures show the clock; the clock must carry its meridiem.
      expect(row.querySelector(".fact.date")!.textContent).toMatch(/^\d{1,2}:\d{2}\s?(AM|PM)$/);
    } finally { Date.prototype.toLocaleTimeString = orig; }
  });
});

// S6-Q35 (2026-09-04): "Recent Captures rows do nothing." A row is the
// receipt for something that already exists somewhere real; tapping it
// should open that thing, not sit there dead.
describe("QuickCapture: Recent Captures opens what it created (S6-Q35)", () => {
  it("tapping a row hands its kind and id to onOpen, then closes the sheet", async () => {
    recordCapture({ id: "old-task-1", kind: "task", title: "Renew the passport", ts: Date.now() - 60000 });
    const onClose = vi.fn();
    const onOpen = vi.fn();
    render(
      <NotesProvider userId="u-recent-open">
        <QuickCapture ai={new AIService({ available: false })} onClose={onClose} onOpen={onOpen} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "Renew the domain" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    expect(screen.getByText("Recent Captures")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Renew the passport"));
    expect(onOpen).toHaveBeenCalledWith("task", "old-task-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("with no onOpen wired, a row stays inert: no role, no crash on tap", async () => {
    recordCapture({ id: "old-note-1", kind: "note", title: "Ideas for the offsite", ts: Date.now() - 60000 });
    render(
      <NotesProvider userId="u-recent-inert">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "Water the plants" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    const row = screen.getByText("Ideas for the offsite").closest(".row")!;
    expect(row).not.toHaveAttribute("role");
    fireEvent.click(row); // must not throw
  });
});

// SHELL-F-16 (2026-09-05): the receipt's category chips were cats.slice(0, 4)
// for row width. Every template seeds six areas, so a capture that belonged
// in the fifth or sixth showed no active chip and could not be moved there at
// all, which also meant the learned-rules loop could never be taught them.
describe("QuickCapture receipt offers every area", () => {
  it("shows all six areas, and filing under the sixth lands on the record", async () => {
    render(
      <NotesProvider userId="u-six-areas">
        <CaptureStrands />
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    const names = ["Work", "Family", "Health", "Money", "Friends", "Personal"];
    const ids: string[] = [];
    await act(async () => {
      for (const n of names) ids.push((await catsRef!.create(n, "blue"))!);
    });

    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "Renew the domain" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());

    for (const n of names) expect(screen.getByText(n)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Personal"));
    await waitFor(async () => {
      const t = (await tasksRef!.listTasks())[0]!;
      expect(t.data.category).toBe(ids[5]);
    });
  });
});

// SHELL-F-24 (2026-09-05): Cancel and the scrim stayed live during
// "Saving...", and the save is a promise this sheet cannot abort. Tapping
// either one closed the sheet while the write went on to succeed: the task
// existed, with no receipt, no toast and no undo anywhere.
describe("QuickCapture while the save is in flight", () => {
  it("cannot be dismissed, so nothing lands without a receipt", async () => {
    let land: (id: string) => void = () => {};
    const create = vi.spyOn(TasksService.prototype, "createTask")
      .mockReturnValue(new Promise<string>((r) => { land = r; }));
    const onClose = vi.fn();
    render(
      <NotesProvider userId="u-inflight">
        <QuickCapture ai={new AIService({ available: false })} onClose={onClose} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "Renew the domain" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saving...")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(document.querySelector(".sheet-scrim")!);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { land("task-1"); });
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    // And it closes normally again once there is something to close on.
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    create.mockRestore();
  });
});

// UP-ATH-18 (2026-09-06, option A): while a session is live the bar is
// standing next to the athlete, and "225 for 5" used to become a task called
// "225 For 5". The branch runs before any AI call and refuses everything it
// is not certain about.
import { writeLive, readLive, clearLive } from "../gym/liveSession";
import { todayISO } from "../ai/useAIContext";

describe("QuickCapture: a set goes to the live session", () => {
  const liveBench = () => writeLive({
    programId: "p", dayId: "d", dayName: "Push", date: todayISO(), startedAt: Date.now(), idx: 0,
    exercises: [{ exerciseId: "e1", name: "Bench Press", kind: "weight_reps", unit: "lb", sets: [] }],
  });

  beforeEach(() => { clearLive(); showToast.mockClear(); });

  it("logs the set on the exercise the athlete is on, and closes", async () => {
    liveBench();
    const onClose = vi.fn();
    render(
      <NotesProvider userId="qc-gym-1">
        <QuickCapture ai={new AIService({ available: false })} onClose={onClose} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "225 for 5" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(readLive()!.exercises[0]!.sets).toHaveLength(1);
    expect(readLive()!.exercises[0]!.sets[0]).toMatchObject({ w: 225, r: 5 });
    // Casing sweep 1 (2026-09-26): Title Case by the whole rule (§H2), units spelled "Min".
    expect(showToast.mock.calls[0]![0].message).toBe("Logged 225 Lb × 5");
    expect(showToast.mock.calls[0]![0].actionLabel).toBe("Undo");
  });

  it("the Undo puts the strip back exactly as it was", async () => {
    liveBench();
    render(
      <NotesProvider userId="qc-gym-2">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "225 for 5" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(readLive()!.exercises[0]!.sets).toHaveLength(1));
    act(() => showToast.mock.calls[0]![0].onAction());
    expect(readLive()!.exercises[0]!.sets).toHaveLength(0);
  });

  it("text that is not a set still routes normally, even mid-session", async () => {
    liveBench();
    render(
      <NotesProvider userId="qc-gym-3">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "Renew the domain" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(readLive()!.exercises[0]!.sets).toHaveLength(0);
  });

  it("with no session live the same words are a task, not a set", async () => {
    render(
      <NotesProvider userId="qc-gym-4">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "225 for 5" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });
});

// UNDO ANSWERS ON SCREEN (2026-10-01, live audit): after Undo the record was
// gone but the sheet carried on with no word, so it was unclear anything had
// happened. The row stays where it was and says Removed, with a Redo.
describe("QuickCapture: Undo shows a Removed state with a Redo", () => {
  it("Undo deletes the record and the row reads Removed; Redo brings it back", async () => {
    render(
      <NotesProvider userId="u-undo-removed">
        <CaptureStrands />
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "Renew the domain" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(await tasksRef!.listTasks()).toHaveLength(1);

    fireEvent.click(screen.getByText("Undo"));
    await waitFor(async () => expect(await tasksRef!.listTasks()).toHaveLength(0));
    // The sheet says what happened and stays on the receipt.
    await waitFor(() => expect(screen.getByText("Removed", { selector: ".fact" })).toBeInTheDocument());
    expect(screen.getByText("Renew the Domain")).toBeInTheDocument();
    expect(screen.queryByText("Undo")).toBeNull();
    expect(screen.queryByPlaceholderText(/Paste or type/), "it does not silently fall back to an empty input").toBeNull();

    fireEvent.click(screen.getByText("Redo"));
    await waitFor(() => expect(screen.getByText("Undo")).toBeInTheDocument());
    expect(screen.queryByText("Removed", { selector: ".fact" })).toBeNull();
    expect(await tasksRef!.listTasks()).toHaveLength(1);
  });

  it("Done after removing everything does not claim anything was saved", async () => {
    showToast.mockClear();
    const onClose = vi.fn();
    render(
      <NotesProvider userId="u-undo-done">
        <QuickCapture ai={new AIService({ available: false })} onClose={onClose} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "Renew the domain" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Undo"));
    await waitFor(() => expect(screen.getByText("Removed", { selector: ".fact" })).toBeInTheDocument());
    fireEvent.click(screen.getByText("Done"));
    expect(onClose).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});

// RECENT CAPTURES CAN BE CLEARED BY THE OWNER (2026-10-01, live audit: old
// test captures sat in the strip with no way to remove them). The strip lives
// in this device's localStorage, so clearing the row is the whole fix; the
// task, event or note it points at is not touched.
describe("QuickCapture: a Recent Captures row can be removed", () => {
  it("the X clears that row from the strip and from storage, and opens nothing", async () => {
    recordCapture({ id: "old-1", kind: "task", title: "Audit test", ts: Date.now() - 60000 });
    recordCapture({ id: "old-2", kind: "note", title: "Ideas for the offsite", ts: Date.now() - 50000 });
    const onOpen = vi.fn();
    render(
      <NotesProvider userId="u-recent-remove">
        <QuickCapture ai={new AIService({ available: false })} onClose={() => {}} onOpen={onOpen} />
      </NotesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: "Water the plants" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Recent Captures")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Remove Audit test from Recent Captures" }));
    expect(screen.queryByText("Audit test")).toBeNull();
    expect(screen.getByText("Ideas for the offsite")).toBeInTheDocument();
    expect(onOpen, "removing a row must not open it").not.toHaveBeenCalled();
    const stored = JSON.parse(localStorage.getItem("jarvis.captures.v1") || "[]") as { id: string }[];
    expect(stored.map((r) => r.id)).not.toContain("old-1");
    expect(stored.map((r) => r.id)).toContain("old-2");
  });
});

// THE SMART PASTE SHEET, AS THE ROUND-1 REVIEW LEFT IT (Dave 2026-10-05: "Everything should look PERFECT."). The placeholder was
// "Paste or type · dinner with Marco Thursday 7pm": a typed dot, lowercase words, a 7pm that is not the 12-hour form, and (drawn
// as bright as typed text) it read as content already in the field. Speak, Log the Decision and Remember This stood stacked under
// Cancel, 9px from the sheet's foot, with Speak 20px off the field's column.
describe("QuickCapture: the sheet reads field, aids, Capture, Cancel", () => {
  const open = () => render(<NotesProvider userId="u-layout"><QuickCapture ai={new AIService({ available: false })} onClose={() => {}} /></NotesProvider>);

  it("the placeholder is a Title Case example in the 12-hour form, with no typed dot, and the field is labelled for what it takes", () => {
    open();
    const box = screen.getByLabelText("Paste or Type") as HTMLTextAreaElement;
    expect(box.placeholder).toBe("Dinner with Marco Thursday 7:00 PM");
    expect(box.placeholder).not.toContain("·");
    expect(box.placeholder).toMatch(/\b\d{1,2}:\d{2} (AM|PM)\b/);
  });

  it("Speak sits in ONE quiet row directly under the field, before Capture, and nothing hangs under Cancel", () => {
    open();
    const form = document.querySelector(".sheet-form")!;
    const kids = [...form.children];
    const box = kids.findIndex((k) => k.tagName === "TEXTAREA");
    const aids = kids.findIndex((k) => k.classList.contains("msg-quiet-acts"));
    const actions = kids.findIndex((k) => k.classList.contains("sheet-actions"));
    expect(aids, "the aids are a row of their own").toBeGreaterThan(-1);
    expect(aids).toBe(box + 1);
    expect(actions).toBeGreaterThan(aids);
    expect(kids[aids]!.textContent).toContain("Speak");
    // Cancel is last: nothing follows the actions
    expect(kids.slice(actions + 1).filter((k) => k.classList.contains("msg-quiet-acts"))).toHaveLength(0);
    expect(kids[actions]!.querySelectorAll("button")).toHaveLength(2);
    expect(kids[actions]!.lastElementChild!.textContent).toBe("Cancel");
  });
});

// THE TRUST CHECKPOINT (Phase 0 D4, 2026-10-10). Dave, 2026-09-28: "a filing
// never says Saved before it reaches the server". Behind trust_v1 this door
// reads the Store through useStore(); while it is pending (offline, or a
// queue still on the phone) the receipt eyebrow says Filed · Will Sync and the Done
// toast says Will Sync. The offline Store is passed through NotesProvider's
// test seam (store prop), built on the same InMemoryAdapter and held offline.
import { Store, InMemoryAdapter } from "@core";

function offlineStore(): Store {
  const s = new Store(new InMemoryAdapter());
  s.goOffline();
  return s;
}

async function captureAndDone(text: string, store?: Store) {
  showToast.mockClear();
  const onClose = vi.fn();
  const r = render(
    <NotesProvider userId="u-trust" {...(store ? { store } : {})}>
      <QuickCapture ai={new AIService({ available: false })} onClose={onClose} />
    </NotesProvider>,
  );
  fireEvent.change(screen.getByLabelText("Paste or Type"), { target: { value: text } });
  fireEvent.click(screen.getByText("Capture"));
  await waitFor(() => expect(screen.getAllByText("Undo").length).toBeGreaterThan(0));
  const eyebrow = document.querySelector(".eyebrow")!.textContent;
  fireEvent.click(screen.getByText("Done"));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  r.unmount();
  return { eyebrow, toast: (showToast.mock.calls[0]?.[0] as { message: string } | undefined)?.message };
}

describe("QuickCapture: the trust checkpoint (trust_v1)", () => {
  beforeEach(() => { flags.trustOn = true; flags.memoryOn = false; });

  it("online, the receipt says Saved and Done says Saved, as today", async () => {
    const got = await captureAndDone("Renew the domain");
    expect(got.eyebrow).toBe("Saved");
    expect(got.toast).toBe("Saved");
  });

  it("offline, the receipt says Filed and Done says Filed · Will Sync", async () => {
    const got = await captureAndDone("Renew the domain", offlineStore());
    expect(got.eyebrow).toBe("Filed · Will Sync");
    expect(got.toast).toBe("Filed · Will Sync");
  });

  it("offline with two captures, Done counts them and still never says Saved", async () => {
    const got = await captureAndDone("Renew the domain\ncall the plumber back", offlineStore());
    expect(got.toast).toBe("Filed 2 Items · Will Sync");
  });

  it("flag off, an offline Store changes nothing: Saved, byte for byte", async () => {
    flags.trustOn = false;
    const got = await captureAndDone("Renew the domain\ncall the plumber back", offlineStore());
    expect(got.eyebrow).toBe("Saved");
    expect(got.toast).toBe("Saved 2 items");
  });
});

// Phase 0 D11: a contact's aliases reach the capture behind memory_v1, so
// "Mom" files onto Linda's card the way "Linda" does.
let seededPeople: ReturnType<typeof usePeople> | null = null;
function SeedMom({ children }: { children: React.ReactNode }) {
  const people = usePeople();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      await people.create({ name: "Linda Fisher", group: "contacts", aliases: ["Mom"] });
      seededPeople = people;
      setReady(true);
    })();
  }, [people]);
  return ready ? <>{children}</> : null;
}

describe("QuickCapture: aliases reach the capture (memory_v1)", () => {
  async function captureMom(userId: string) {
    render(
      <NotesProvider userId={userId}>
        <SeedMom><QuickCapture ai={new AIService({ available: false })} onClose={() => {}} /></SeedMom>
      </NotesProvider>,
    );
    fireEvent.change(await screen.findByLabelText("Paste or Type"), { target: { value: "call Mom about thanksgiving" } });
    fireEvent.click(screen.getByText("Capture"));
    await waitFor(() => expect(screen.getByText("Undo")).toBeInTheDocument());
  }

  it("flag on, Mom is Linda on the receipt", async () => {
    flags.memoryOn = true;
    await captureMom("u-alias-on");
    expect(screen.getByText("Linda Fisher", { selector: ".fact" })).toBeInTheDocument();
    expect(seededPeople).not.toBeNull();
  });

  it("flag off, the alias is not read and nobody is filed", async () => {
    flags.memoryOn = false;
    await captureMom("u-alias-off");
    expect(screen.queryByText("Linda Fisher", { selector: ".fact" })).toBeNull();
  });
});
