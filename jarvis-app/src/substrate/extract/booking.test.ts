// CONFIRMED BOOKINGS ARE SCHEDULE CARDS (Dave 2026-10-12, ruling 6). A restaurant
// table, a hotel stay, a tee time or an appointment the sender confirmed, with an
// explicit date AND a clock, reads as one event card the person approves; nothing
// is written by reading. The negatives are the point: marketing that says "book
// now" settles nothing, a date with no clock is not a timed event, a weekday alone
// is not an explicit date.
import { describe, it, expect } from "vitest";
import { extractCandidates, type ExtractInput } from "./index";
import type { EventPayload } from "../contracts";

const base: Omit<ExtractInput, "from_address" | "from_name" | "subject" | "body"> = {
  account_id: "acct-dave", message_id: "msg-b", account: "dave@example.test", internal_date: "2026-10-12T13:00:00Z", zone: "America/New_York",
};
const mail = (from_address: string, from_name: string, subject: string, body: string): ExtractInput => ({ ...base, from_address, from_name, subject, body });
const events = (i: ExtractInput) => extractCandidates(i).filter((c) => c.kind === "event");

describe("confirmed bookings", () => {
  it("a restaurant reservation with a date, a clock and a zone: one complete card", () => {
    const [c] = events(mail("noreply@opentable.test", "OpenTable", "Your reservation is confirmed", "Your reservation at Nobu Downtown is confirmed.\nTable for 2\nSaturday, October 18, 2026 at 7:30 PM ET\nConfirmation number: 88123"));
    expect(c).toBeDefined();
    const e = c!.payload as EventPayload;
    expect(e.title).toBe("Reservation at Nobu Downtown");
    expect(e.time).toMatchObject({ all_day: false, start_at: "2026-10-18T23:30:00.000Z", timezone: "America/New_York" });
    expect(c!.missing).toEqual([]);
    expect(c!.template).toBe("event.booking");
  });

  it("the live tee time: Date and Time on one line, a weekday before the date is not the date", () => {
    const [c] = events(mail("brennan@chelseareservations.test", "Brennan", "Tee Time Confirmation", "Your Tee Time Booking at Brennan Golf has been accepted for:\nDate: Thursday - October 15, 2026, Time: 11:20 AM, 18 holes, 2 players, Confirm #15172."));
    const e = c!.payload as EventPayload;
    expect(e.title).toBe("Tee Time at Brennan Golf");
    // No zone named: the card asks for it rather than assume one.
    expect(c!.missing).toEqual(["timezone"]);
    expect(e.time.all_day === false && e.time.start_at.startsWith("2026-10-15")).toBe(true);
  });

  it("a hotel check-in and a confirmed appointment", () => {
    const hotel = events(mail("stay@marriott.test", "Marriott", "Booking confirmation", "Thank you for booking. Your stay is confirmed.\nCheck-in: October 20, 2026, 3:00 PM Eastern\nCheck-out: October 22, 2026, 11:00 AM"))[0]!;
    expect((hotel.payload as EventPayload).time).toMatchObject({ start_at: "2026-10-20T19:00:00.000Z" });
    const dentist = events(mail("office@smiles.test", "Bright Smiles Dental", "Appointment confirmed", "Your appointment with Dr. Lee is confirmed for October 14, 2026 at 9:15 AM ET."))[0]!;
    expect((dentist.payload as EventPayload).title).toMatch(/^Appointment/);
    expect(dentist.missing).toEqual([]);
  });

  it("marketing that says book now makes no card, even with a date and a clock", () => {
    expect(events(mail("deals@hotels.test", "Hotels Deals", "Book now and save", "Book now! Reserve your stay today. Sale ends October 20, 2026 at 11:59 PM ET. Booking is easy."))).toEqual([]);
    expect(events(mail("news@restaurant.test", "The Grill", "Reservations open", "Reserve your table for our anniversary dinner. Book now, limited time. Reservations confirmed instantly."))).toEqual([]);
  });

  it("a confirmed booking with a date and no clock is not a timed event", () => {
    expect(events(mail("stay@inn.test", "Seaside Inn", "Reservation confirmed", "Your reservation is confirmed for October 20, 2026. Confirmation number: 4411."))).toEqual([]);
  });

  it("a booking named only by a weekday is not an explicit date", () => {
    expect(events(mail("noreply@resy.test", "Resy", "You're all set", "Your reservation is confirmed for Friday at 8:00 PM."))).toEqual([]);
  });

  it("the same booking read twice is the same card", () => {
    const m = mail("noreply@opentable.test", "OpenTable", "Your reservation is confirmed", "Your reservation at Nobu Downtown is confirmed for October 18, 2026 at 7:30 PM ET.");
    expect(events(m)[0]!.fingerprint).toBe(events(m)[0]!.fingerprint);
  });
});
