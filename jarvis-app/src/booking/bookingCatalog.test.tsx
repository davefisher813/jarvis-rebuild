// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { lineCase } from "../shared/casing";
import CancelBookingSheet from "./CancelBookingSheet";
import DayOffSheet from "./DayOffSheet";
import PublicBookingPage from "./PublicBookingPage";
import PublicCancelPage from "./PublicCancelPage";
import { WHO_LABEL } from "./settings";
import type { BookingFace } from "./bookedEvents";

// THE VISUAL CATALOG, HELD ON BOOKING (Dave 2026-10-05, "I am sick of this").
// The owner's two sheets and the two public pages a stranger sees, rendered
// through the real components and read from the DOM.
//
// The public pages and the guest's confirmation are prose to somebody else, a
// sentence-case surface by the casing roster (laws/sentenceCase.ts), so what
// is pinned there is structure: a fact is a .fact with no typed dot, a grey
// line under a time is one run, and no inline colour is raw.

const MIDDOT = "·";
const norm = (e: Element) => (e.textContent ?? "").replace(/\s+/g, " ").trim();
const START = Date.parse("2026-09-22T18:00:00.000Z");
const END = Date.parse("2026-09-22T18:30:00.000Z");

const booking = (guestName: string): BookingFace => ({
  id: "bk-1", title: "Intro Call", guestName, guestEmail: "ada@example.com", startMs: START, endMs: END,
});

/** Every note under a field is one sentence or dot-joined fragments, and opens with a capital. */
function notesOf(root: ParentNode): string[] {
  return [...root.querySelectorAll(".input-hint")].map(norm);
}

describe("the owner's booking sheets follow the catalog", () => {
  it("Cancel Booking: a guest with no name is still a capital and a grammatical subject", () => {
    render(<CancelBookingSheet booking={booking("")} busy={false} error={null} onCancel={() => {}} onConfirm={() => {}} />);
    const notes = notesOf(document.body);
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) {
      expect(n[0], `"${n}" opens lowercase`).toBe(n[0]!.toUpperCase());
      expect(n).not.toMatch(/\. [A-Z]/);
    }
    expect(notes.some((n) => n.startsWith("The guest gets an email"))).toBe(true);
    expect(notes.some((n) => /^them gets/.test(n))).toBe(false);
  });

  it("Cancel Booking: a named guest is the subject as written", () => {
    render(<CancelBookingSheet booking={booking("Ada Lovelace")} busy={false} error={null} onCancel={() => {}} onConfirm={() => {}} />);
    expect(notesOf(document.body).some((n) => n.startsWith("Ada Lovelace gets an email"))).toBe(true);
  });

  it("Cancel Booking: the time in its first note is 12-hour with AM or PM even in a 24-hour region", () => {
    const real = Date.prototype.toLocaleTimeString;
    vi.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function (this: Date, loc?: Intl.LocalesArgument, opts?: Intl.DateTimeFormatOptions) {
      return loc === "en-US" && opts?.hour12 ? real.call(this, loc, opts) : "18:05";
    });
    render(<CancelBookingSheet booking={booking("Ada Lovelace")} busy={false} error={null} onCancel={() => {}} onConfirm={() => {}} />);
    const first = notesOf(document.body)[0]!;
    expect(first).toMatch(/ at \d{1,2}:\d{2} (AM|PM)$/);
    vi.restoreAllMocks();
  });

  it("A Day Off: its notes and labels are one sentence each, and its titles are Title Case", () => {
    render(<DayOffSheet taken={[]} busy={false} error={null} onCancel={() => {}} onAdd={() => {}} />);
    for (const n of notesOf(document.body)) expect(n).not.toMatch(/\. [A-Z]/);
    for (const el of document.querySelectorAll(".input-label, .xs-group-label, .sheet-title, h2, h3")) {
      const t = norm(el);
      if (t) expect(lineCase(t), t).toBe(t);
    }
  });

  it("the Who Can Book answer keeps its small word small", () => {
    expect(WHO_LABEL.anyone).toBe("Anyone with the Link");
    expect(lineCase(WHO_LABEL.anyone)).toBe(WHO_LABEL.anyone);
  });
});

const res = (body: unknown, status = 200): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);

describe("the public pages follow the catalog's structure", () => {
  it("the cancel page: the zone is one small-caps date fact with no typed dot, and no colour is raw", async () => {
    const f = vi.fn(async () => res({ booking: { name: "Intro Call", status: "confirmed", startMs: START, endMs: END } })) as unknown as typeof fetch;
    const { container } = render(<PublicCancelPage bookingId="3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b" fetchImpl={f} />);
    await screen.findByText("Intro Call");
    const facts = container.querySelector(".facts")!;
    expect(facts.querySelectorAll(".fact")).toHaveLength(1);
    expect(facts.querySelector(".fact")).toHaveClass("date");
    expect(norm(facts)).not.toContain(MIDDOT);
    for (const el of container.querySelectorAll<HTMLElement>("[style]")) expect(el.getAttribute("style")).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    // The title is Title Case even on a sentence-case surface.
    expect(norm(container.querySelector(".pagehead-title")!)).toBe("Cancel This Booking");
  });

  it("the cancelled page says one thing, in one quiet line", async () => {
    const f = vi.fn(async () => res({ booking: { name: "Intro Call", status: "cancelled", startMs: START, endMs: END } })) as unknown as typeof fetch;
    const { container } = render(<PublicCancelPage bookingId="3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b" fetchImpl={f} />);
    await screen.findByText("Already Cancelled");
    expect(container.querySelectorAll(".bk-note")).toHaveLength(1);
    expect(container.querySelector(".facts")).toBeNull();
  });

  it("the booking page's grid heads and chips carry no typed dot in a fact", async () => {
    const f = vi.fn(async () => res({ name: "Intro Call", durationMin: 30, timezone: "America/New_York", slots: [{ startMs: START, endMs: END, date: "2026-09-22" }] })) as unknown as typeof fetch;
    const { container } = render(<PublicBookingPage slug="wide-harbour" fetchImpl={f} />);
    await screen.findByText("Intro Call");
    for (const el of container.querySelectorAll(".fact, .facts, .conn-meta")) expect(norm(el)).not.toContain(MIDDOT);
    for (const el of container.querySelectorAll(".sh2 .t, .pagehead-title, .eyebrow")) {
      const t = norm(el);
      if (t && !/\d{4}$/.test(t)) expect(lineCase(t), t).toBe(t);
    }
  });
});
