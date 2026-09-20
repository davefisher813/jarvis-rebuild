import { Store, InMemoryAdapter } from "@core";
import { describe, it, expect, vi } from "vitest";
import { ScheduleService } from "../schedule/ScheduleService";
import { committedFor, pushCommitted } from "./pushCommitted";

// TELLING THE LINK WHICH HOURS ARE GONE (Track 3, 2026-09-19).
//
// The bug this closes is a link that offers the hour its owner is already in.
// What is worth pinning here is which events count, because getting that wrong
// either blocks hours he is free for or leaves the hole open.

const NOW = new Date("2026-09-20T12:00:00.000Z");
const svc = () => new ScheduleService(new Store(new InMemoryAdapter()), "u");
const tok = async () => "session-token";
const ok = (body: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;

describe("committedFor", () => {
  it("blocks the window of an ordinary meeting", async () => {
    const schedule = svc();
    await schedule.createEvent("Dentist", { date: "2026-09-22", start: "14:00", end: "15:00" });
    expect(await committedFor(schedule, NOW)).toEqual([
      { date: "2026-09-22", startTime: "14:00", endTime: "15:00" },
    ]);
  });

  // A weekly meeting is not one hour, it is one hour a week, and a grid that
  // only knew about the first would offer every other week's.
  it("blocks every occurrence of a repeating meeting, not just the first", async () => {
    const schedule = svc();
    await schedule.createEvent("Standup", { date: "2026-09-22", start: "09:00", end: "09:30", recurrence: "weekly" });
    const out = await committedFor(schedule, NOW);
    expect(out.map((b) => b.date)).toEqual(["2026-09-22", "2026-09-29", "2026-10-06", "2026-10-13", "2026-10-20"]);
  });

  // A BOOKING IS NOT A COMMITMENT TO PUSH BACK. It came from the link, the link
  // already knows, and sending it back would have the grid subtract it twice.
  it("never sends a booking back to the link that made it", async () => {
    const schedule = svc();
    await schedule.createEvent("Intro Call with Ada", {
      date: "2026-09-22", start: "14:00", end: "14:30", bookingId: "bk-1",
    });
    await schedule.createEvent("Dentist", { date: "2026-09-22", start: "16:00", end: "17:00" });
    const out = await committedFor(schedule, NOW);
    expect(out).toEqual([{ date: "2026-09-22", startTime: "16:00", endTime: "17:00" }]);
  });

  it("merges a stacked morning into one window", async () => {
    const schedule = svc();
    await schedule.createEvent("One", { date: "2026-09-22", start: "09:00", end: "10:00" });
    await schedule.createEvent("Two", { date: "2026-09-22", start: "09:45", end: "11:00" });
    expect(await committedFor(schedule, NOW)).toEqual([
      { date: "2026-09-22", startTime: "09:00", endTime: "11:00" },
    ]);
  });

  it("looks only as far ahead as the link offers, and no further", async () => {
    const schedule = svc();
    await schedule.createEvent("Soon", { date: "2026-09-22", start: "09:00", end: "10:00" });
    await schedule.createEvent("Miles Away", { date: "2027-01-05", start: "09:00", end: "10:00" });
    const out = await committedFor(schedule, NOW);
    expect(out.map((b) => b.date)).toEqual(["2026-09-22"]);
  });

  it("is empty on an empty calendar, rather than blocking anything by accident", async () => {
    expect(await committedFor(svc(), NOW)).toEqual([]);
  });
});

describe("pushCommitted", () => {
  it("hands the hours over with the session token", async () => {
    const schedule = svc();
    await schedule.createEvent("Dentist", { date: "2026-09-22", start: "14:00", end: "15:00" });
    const f = ok({ blocked: 1 });
    expect(await pushCommitted(schedule, f, tok, NOW)).toBe(1);
    const call = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(call[0])).toBe("/api/booking-busy");
    const init = call[1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer session-token");
    expect(JSON.parse(init.body as string)).toEqual({
      blocks: [{ date: "2026-09-22", startTime: "14:00", endTime: "15:00" }],
    });
  });

  // IT REPLACES, NEVER MERGES, and an empty calendar is a real answer: a meeting
  // he deleted has to stop blocking the hour it used to be in.
  it("sends an empty list rather than skipping the call, so a cleared day clears", async () => {
    const f = ok({ blocked: 0 });
    expect(await pushCommitted(svc(), f, tok, NOW)).toBe(0);
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ blocks: [] });
  });

  // Every one of these is an ordinary day on a device with no booking server.
  it("is null and silent with no session, no server, or no network", async () => {
    expect(await pushCommitted(svc(), ok({}), async () => null, NOW)).toBeNull();
    const refused = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await pushCommitted(svc(), refused, tok, NOW)).toBeNull();
    const offline = (() => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await pushCommitted(svc(), offline, tok, NOW)).toBeNull();
  });

  it("falls back to its own count when the server does not give one", async () => {
    const schedule = svc();
    await schedule.createEvent("Dentist", { date: "2026-09-22", start: "14:00", end: "15:00" });
    expect(await pushCommitted(schedule, ok({}), tok, NOW)).toBe(1);
  });
});
