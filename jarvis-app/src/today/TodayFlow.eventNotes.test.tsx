// @vitest-environment jsdom
// 2026-10-04: Today's event page drew its linked notes with a chevron and no
// door, so tapping one did nothing (the same page on Schedule opens it). The
// notes door that lived on Today's Now card was taken out on 2026-09-17, and
// its notedEvents and openEventNote state sat unread; that state is gone.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider, useSchedule, useNotes } from "../data/NotesProvider";
import { GoogleSessionProvider } from "../connections/google/GoogleSession";
import { makeFakeGoogleApi } from "../connections/google/fakeApi";
import { setCategoryRegistry } from "../shared/categories";
import { notifyFreshLists } from "../data/store";
import { ENTITY_EVENT } from "../schedule/types";
import { todayISO, addDays } from "../schedule/calendar";
import type { AIService } from "../ai/AIService";
import type { ScheduleService } from "../schedule/ScheduleService";
import { NotesService } from "../notes/NotesService";
import TodayFlow from "./TodayFlow";

vi.mock("../shared/toast", () => ({ showToast: () => {}, hideToast: () => {} }));
vi.mock("../ai/useAI", () => ({ useAI: () => ({ available: false } as unknown as AIService) }));
vi.mock("../people/MessageDraftSheet", () => ({ default: () => null }));
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

let sched: ScheduleService | null = null;
let notes: NotesService | null = null;
function Grab() { sched = useSchedule(); notes = useNotes(); return null; }

async function openEventPage(onOpenNote?: (id: string) => void) {
  render(
    <NotesProvider userId={"today-event-notes-" + Math.random().toString(36).slice(2)}>
      <GoogleSessionProvider requestToken={async () => "tok"} makeApi={() => makeFakeGoogleApi()}>
        <Grab />
        <TodayFlow onGoSchedule={() => {}} onGoTasks={() => {}} onOpenNote={onOpenNote} />
      </GoogleSessionProvider>
    </NotesProvider>,
  );
  await waitFor(() => expect(sched).toBeTruthy());
  const tomorrow = addDays(todayISO(), 1);
  const eventId = (await sched!.createEvent("Planning Review", { date: tomorrow, start: "17:30", end: "18:30" }))!;
  const noteId = (await notes!.createForEvent({ id: eventId, title: "Planning Review", date: tomorrow }))!;
  notifyFreshLists(ENTITY_EVENT);
  await waitFor(() => expect(screen.getAllByText("Planning Review").length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByText("Planning Review")[0]!);
  return noteId;
}

beforeEach(() => { localStorage.clear(); setCategoryRegistry([]); sched = null; notes = null; });
afterEach(() => { vi.restoreAllMocks(); });

describe("Today's event page: the linked notes", () => {
  it("a tap on a linked note opens that note through the shell's door", async () => {
    const onOpenNote = vi.fn();
    const noteId = await openEventPage(onOpenNote);
    const head = await screen.findByText("Notes", { selector: ".sh2 .t" });
    const row = head.parentElement!.nextElementSibling!.querySelector(".row") as HTMLElement;
    fireEvent.click(row);
    expect(onOpenNote).toHaveBeenCalledWith(noteId);
  });

  it("with no note door in hand the page does not offer note rows it cannot open", async () => {
    await openEventPage(undefined);
    await screen.findByRole("button", { name: "Edit" });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Notes", { selector: ".sh2 .t" })).toBeNull();
  });

  // The Now card's Notes pill was taken out on 2026-09-17; the scan that fed
  // it ran on every events change and nothing read its answer.
  it("Today no longer scans the note list for which events have a note", async () => {
    const scan = vi.spyOn(NotesService.prototype, "eventsWithNotes");
    await openEventPage(vi.fn());
    await screen.findByRole("button", { name: "Edit" });
    expect(scan).not.toHaveBeenCalled();
  });
});
