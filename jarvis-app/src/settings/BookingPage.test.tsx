// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import BookingPage from "./BookingPage";
import { readBookingSettings } from "../booking/settings";
import type { BookingFace } from "../booking/bookedEvents";
import { subscribeToast } from "../shared/toast";

const LINK = { slug: "wide-harbour", visibility: "link_only", days: 5 };
const BOOKED: BookingFace[] = [{
  id: "bk-1", title: "Intro Call", guestName: "Ada Lovelace", guestEmail: "ada@example.com",
  startMs: Date.parse("2026-09-22T18:00:00Z"), endMs: Date.parse("2026-09-22T18:30:00Z"),
}];
const published = (booked: BookingFace[] | null) => ({
  readLinkImpl: async () => LINK,
  readBookingsImpl: async () => booked,
});

/** The toasts a run produced, since two of them are the point of the test. */
function toasts(): string[] {
  const said: string[] = [];
  // It replays the current toast on subscribe, which at that moment is none.
  subscribeToast((t) => { if (t) said.push(t.message); });
  return said;
}

/** Tap the booking row, then the destructive action in its menu. */
async function openCancel() {
  fireEvent.click(await screen.findByText("Intro Call with Ada Lovelace"));
  fireEvent.click(await screen.findByRole("button", { name: "Cancel This Booking" }));
  return screen.findByRole("button", { name: "Cancel It" });
}

// Track 3 (2026-09-14): Your Times, one screen, writes through as it goes.
describe("BookingPage", () => {
  beforeEach(() => { localStorage.clear(); });
  it("turns availability on, toggles a day and a duration, and offers to publish when no link exists yet", () => {
    render(<BookingPage onBack={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Available for Booking" }));
    expect(readBookingSettings().available).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Saturday" }));
    expect(readBookingSettings().days).toEqual([0, 1, 2, 3, 4, 5]);
    fireEvent.click(screen.getByRole("button", { name: "45 Min" }));
    expect(readBookingSettings().durationMin).toBe(45);
    // AMENDED 2026-09-19 (Track 3): the card offers to publish now. With no
    // session behind the test there is no link, which is the honest empty
    // state rather than an error.
    expect(screen.getByText("No Link Yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish My Times" })).toBeInTheDocument();
  });

  // WHO HAS ACTUALLY BOOKED (Track 3, 2026-09-19). The first question anybody
  // asks after publishing a link is whether the thing works and whether anyone
  // has used it, and the screen that publishes it is where they will look.
  it("shows the address and who has booked on it", async () => {
    render(<BookingPage onBack={() => {}} {...published(BOOKED)} />);
    expect(await screen.findByText(/wide-harbour/)).toBeInTheDocument();
    expect(await screen.findByText("Intro Call with Ada Lovelace")).toBeInTheDocument();
  });

  it("says nobody yet when the link is live and unused", async () => {
    render(<BookingPage onBack={() => {}} {...published([])} />);
    expect(await screen.findByText("Nobody Yet")).toBeInTheDocument();
    expect(screen.getByText(/lands on your schedule/)).toBeInTheDocument();
  });

  // Nobody having booked and not being able to ask are different facts, and
  // reading the second as the first tells him his link is dead when it is not.
  it("says it could not ask, rather than claiming nobody has booked", async () => {
    render(<BookingPage onBack={() => {}} {...published(null)} />);
    expect(await screen.findByText(/Could not reach the booking server/)).toBeInTheDocument();
  });

  it("does not ask about bookings on a link that does not exist yet", async () => {
    render(<BookingPage onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText("No Link Yet")).toBeInTheDocument());
    expect(screen.queryByText("Booked So Far")).toBeNull();
  });

  // CALLING A MEETING OFF (Track 3, 2026-09-19). Two taps to reach the sheet,
  // and nothing happens until the last one: this tells a stranger their meeting
  // is off, which cannot be undone by tapping again.
  it("takes two deliberate steps to reach the cancel sheet, and touches nothing on the way", async () => {
    const cancelImpl = vi.fn(async () => ({ told: true }));
    render(<BookingPage onBack={() => {}} {...published(BOOKED)} cancelImpl={cancelImpl} />);
    await openCancel();
    expect(screen.getByText(/takes it off their calendar/)).toBeInTheDocument();
    expect(cancelImpl).not.toHaveBeenCalled();
  });

  it("cancels with the host's own line, and says the guest was emailed", async () => {
    const said = toasts();
    const cancelImpl = vi.fn(async () => ({ told: true }));
    render(<BookingPage onBack={() => {}} {...published(BOOKED)} cancelImpl={cancelImpl} />);
    const confirm = await openCancel();
    fireEvent.change(screen.getByLabelText("A line for them"), { target: { value: "Something came up" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(cancelImpl).toHaveBeenCalledWith("bk-1", "Something came up"));
    await waitFor(() => expect(said).toContain("Cancelled \u00b7 They Have Been Emailed"));
  });

  // The meeting being off and the guest knowing about it are different facts.
  // Saying only the first leaves him thinking a stranger will not turn up.
  it("says plainly when the guest could not be emailed", async () => {
    const said = toasts();
    render(<BookingPage onBack={() => {}} {...published(BOOKED)} cancelImpl={async () => ({ told: false })} />);
    fireEvent.click(await openCancel());
    await waitFor(() => expect(said).toContain("Cancelled \u00b7 We Could Not Email Them"));
  });

  it("keeps the sheet open and says so when the cancel itself failed", async () => {
    render(<BookingPage onBack={() => {}} {...published(BOOKED)} cancelImpl={async () => { throw new Error("502"); }} />);
    fireEvent.click(await openCancel());
    expect(await screen.findByText("Could not cancel that booking.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel It" })).toBeInTheDocument();
  });

  it("offers the guest's address, because writing to them is the other thing he might want", async () => {
    render(<BookingPage onBack={() => {}} {...published(BOOKED)} />);
    fireEvent.click(await screen.findByText("Intro Call with Ada Lovelace"));
    expect(await screen.findByRole("button", { name: "Copy Their Email" })).toBeInTheDocument();
  });
});
