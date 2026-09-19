import { Store, InMemoryAdapter } from "@core";
import { describe, it, expect, vi } from "vitest";
import { ScheduleService } from "../schedule/ScheduleService";
import { importBookings, readBookings, cancelBooking } from "./importBookings";
import type { BookingFace } from "./bookedEvents";

// BRINGING BOOKINGS IN (Track 3, 2026-09-19). The two rules carried over from
// the Google import are the ones with teeth, and both are tested here: never
// make a second copy, and never delete on an absence the fetch cannot vouch
// for.

const NOW = new Date("2026-09-20T12:00:00.000Z");
const at = (iso: string) => Date.parse(iso);

const B1: BookingFace = {
  id: "bk-1", title: "Intro Call", guestName: "Ada", guestEmail: "ada@example.com",
  startMs: at("2026-09-22T18:00:00Z"), endMs: at("2026-09-22T18:30:00Z"),
};
const B2: BookingFace = {
  id: "bk-2", title: "Intro Call", guestName: "Grace", guestEmail: "grace@example.com",
  startMs: at("2026-09-24T14:00:00Z"), endMs: at("2026-09-24T14:30:00Z"),
};

const svc = () => new ScheduleService(new Store(new InMemoryAdapter()), "u");
const tok = async () => "session-token";
const server = (bookings: BookingFace[] | { status: number }) =>
  vi.fn(async () => ("status" in bookings
    ? { ok: false, status: bookings.status, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => ({ bookings }) })) as unknown as typeof fetch;

describe("readBookings", () => {
  it("asks with the session token, because the server decides whose these are", async () => {
    const f = server([B1]);
    expect(await readBookings(f, tok)).toEqual([B1]);
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer session-token");
  });
  // Null and an empty list are different answers, and the difference decides
  // whether anything gets deleted.
  it("is null, not empty, when there is no session or the server says no", async () => {
    expect(await readBookings(server([B1]), async () => null)).toBeNull();
    expect(await readBookings(server({ status: 503 }), tok)).toBeNull();
    expect(await readBookings((() => { throw new Error("offline"); }) as unknown as typeof fetch, tok)).toBeNull();
  });
});

describe("importBookings", () => {
  it("creates an event for each booking, naming who took the hour", async () => {
    const schedule = svc();
    expect(await importBookings(schedule, server([B1, B2]), tok, NOW)).toEqual({ created: 2, removed: 0 });
    const all = await schedule.listEvents();
    expect(all.map((e) => e.data.title).sort()).toEqual(["Intro Call with Ada", "Intro Call with Grace"]);
    expect(all.every((e) => !!(e.data as { bookingId?: string }).bookingId)).toBe(true);
  });

  // Rule 1. This runs on every app open, so a second run must be silent.
  it("makes no second copy on a re-run", async () => {
    const schedule = svc();
    await importBookings(schedule, server([B1, B2]), tok, NOW);
    expect(await importBookings(schedule, server([B1, B2]), tok, NOW)).toEqual({ created: 0, removed: 0 });
    expect((await schedule.listEvents()).length).toBe(2);
  });

  it("removes the event for a booking that has since been cancelled", async () => {
    const schedule = svc();
    await importBookings(schedule, server([B1, B2]), tok, NOW);
    expect(await importBookings(schedule, server([B2]), tok, NOW)).toEqual({ created: 0, removed: 1 });
    const all = await schedule.listEvents();
    expect(all.length).toBe(1);
    expect(all[0]!.data.title).toBe("Intro Call with Grace");
  });

  // Rule 2, the expensive one. The endpoint asks about yesterday to 90 days
  // out. A booking event beyond that was never asked about, and deleting it
  // because of a query's limits would delete a real meeting.
  it("leaves a booking event outside the asked-about window alone", async () => {
    const schedule = svc();
    await schedule.createEvent("Intro Call with Someone", {
      date: "2027-03-01", start: "10:00", end: "10:30", bookingId: "bk-far",
    });
    expect(await importBookings(schedule, server([]), tok, NOW)).toEqual({ created: 0, removed: 0 });
    expect((await schedule.listEvents()).length).toBe(1);
  });

  it("never touches an event that did not come from a booking", async () => {
    const schedule = svc();
    await schedule.createEvent("Dentist", { date: "2026-09-21", start: "09:00" });
    await schedule.createEvent("Standup", { date: "2026-09-21", start: "10:00", gcalId: "g1" });
    expect(await importBookings(schedule, server([]), tok, NOW)).toEqual({ created: 0, removed: 0 });
    expect((await schedule.listEvents()).length).toBe(2);
  });

  // Every one of these is an ordinary day for a device with no booking server
  // behind it, and the schedule has to come out of it unchanged.
  it("changes nothing when there is no session, no server, or no network", async () => {
    for (const [f, t] of [
      [server([]), async () => null],
      [server({ status: 503 }), tok],
      [(() => { throw new Error("offline"); }) as unknown as typeof fetch, tok],
    ] as [typeof fetch, () => Promise<string | null>][]) {
      const schedule = svc();
      await schedule.createEvent("Intro Call with Ada", {
        date: "2026-09-22", start: "18:00", end: "18:30", bookingId: "bk-1",
      });
      expect(await importBookings(schedule, f, t, NOW)).toEqual({ created: 0, removed: 0 });
      expect((await schedule.listEvents()).length).toBe(1);
    }
  });

  it("skips a booking whose times are not times, rather than filing a fake hour", async () => {
    const schedule = svc();
    const broken = { ...B1, id: "bk-broken", endMs: B1.startMs };
    expect(await importBookings(schedule, server([broken, B2]), tok, NOW)).toEqual({ created: 1, removed: 0 });
    expect((await schedule.listEvents())[0]!.data.title).toBe("Intro Call with Grace");
  });
});

describe("cancelBooking", () => {
  const answering = (body: unknown, status = 200) =>
    vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;

  it("names the booking and carries the host's line", async () => {
    const f = answering({ cancelled: true, told: true });
    expect(await cancelBooking("bk-1", " Something came up ", f, tok)).toEqual({ told: true });
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual({ id: "bk-1", reason: "Something came up" });
  });

  it("sends no reason at all rather than an empty one", async () => {
    const f = answering({ cancelled: true, told: true });
    await cancelBooking("bk-1", "   ", f, tok);
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ id: "bk-1" });
  });

  // Cancelled and the guest having been told are different facts, and the
  // screen has to be able to say which one happened.
  it("reports that nobody was emailed, without claiming the cancel failed", async () => {
    expect(await cancelBooking("bk-1", "", answering({ cancelled: true, told: false }), tok)).toEqual({ told: false });
  });

  // The one outcome the person pressing the button must not be allowed to
  // believe is that a meeting is off when it is not.
  it("throws when the cancellation itself did not happen", async () => {
    await expect(cancelBooking("bk-1", "", answering({ error: "No such booking" }, 404), tok)).rejects.toBeTruthy();
    await expect(cancelBooking("bk-1", "", answering({}, 502), tok)).rejects.toBeTruthy();
    await expect(cancelBooking("bk-1", "", answering({}), async () => null)).rejects.toBeTruthy();
  });
});
