import { describe, expect, it } from "vitest";
import { savedEventTwin, titleOverlap } from "./eventTwin";
import type { EventItem } from "../schedule/types";
import type { EventPayload } from "../substrate/contracts";

// IS THIS CARD ALREADY ON THE SCHEDULE? (2026-10-17, the NEVERSTOPMOVING interview proposed twice after it was saved.)
const saved = (title: string, date: string, start: string, extra: Partial<EventItem["data"]> = {}): EventItem =>
  ({ id: "e-" + title, data: { title, date, start, end: "18:30", category: "work", ...extra } });
const card = (title: string, start: string, end: string): EventPayload =>
  ({ kind: "event", title, location: null, external_uid: null, time: { all_day: false, start_at: start, end_at: end, timezone: "America/New_York", selected_offset: "" } });
const ctx = { threadId: "t-1", sender: "Jason Shenloogian", zone: "America/New_York" };
// Fri Oct 16 2026, 6:00 PM New York = 22:00Z.
const events = [saved("NEVERSTOPMOVING Interview", "2026-10-16", "18:00", { notes: "Video interview with Jason Shenloogian" })];

describe("savedEventTwin", () => {
  it("the same meeting said loosely is the saved one: same day, start within a quarter hour, titles alike", () => {
    expect(savedEventTwin(card("Video Interview for David Fisher", "2026-10-16T22:00:00Z", "2026-10-16T22:30:00Z"), [saved("Video Interview", "2026-10-16", "18:00")], { ...ctx, sender: "" })).not.toBeNull();
    // Different end (the email's hour-long default) is still one interview.
    expect(savedEventTwin(card("Neverstopmoving Interview", "2026-10-16T22:00:00Z", "2026-10-16T23:00:00Z"), events, { ...ctx, sender: "" })).not.toBeNull();
  });
  it("a booking named after the sender matches the saved event that names the sender in its notes", () => {
    expect(savedEventTwin(card("Booking at Jason Shenloogian", "2026-10-16T22:00:00Z", "2026-10-16T23:00:00Z"), events, ctx)).not.toBeNull();
  });
  it("an event made from this very thread is the card's twin whatever it is called", () => {
    const fromThread = [saved("Something Else Entirely", "2026-10-16", "18:10", { source: { type: "email", ref: "t-1", ts: 1 } })];
    expect(savedEventTwin(card("Video Interview", "2026-10-16T22:00:00Z", "2026-10-16T22:30:00Z"), fromThread, { ...ctx, sender: "" })).not.toBeNull();
  });
  it("another day, another hour, or an unrelated title at the same hour is not a twin", () => {
    expect(savedEventTwin(card("Neverstopmoving Interview", "2026-10-17T22:00:00Z", "2026-10-17T22:30:00Z"), events, { ...ctx, sender: "" })).toBeNull();
    expect(savedEventTwin(card("Neverstopmoving Interview", "2026-10-16T20:00:00Z", "2026-10-16T20:30:00Z"), events, { ...ctx, sender: "" })).toBeNull();
    expect(savedEventTwin(card("Dentist", "2026-10-16T22:00:00Z", "2026-10-16T22:30:00Z"), events, { threadId: "t-9", sender: "Bright Smiles", zone: ctx.zone })).toBeNull();
  });
  it("a recurring saved event never stands in for a one-off card", () => {
    expect(savedEventTwin(card("Neverstopmoving Interview", "2026-10-16T22:00:00Z", "2026-10-16T22:30:00Z"), [saved("Neverstopmoving Interview", "2026-10-16", "18:00", { recurrence: { kind: "weekly" } as never })], ctx)).toBeNull();
  });
});

describe("titleOverlap", () => {
  it("ignores the words that say only what kind of meeting it is", () => {
    expect(titleOverlap("Invitation: Phone Interview with Equinox", "Equinox Interview")).toBe(1);
    expect(titleOverlap("Meeting", "Call")).toBe(0);
  });
});
