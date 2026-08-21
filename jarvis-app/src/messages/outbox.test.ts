import { describe, it, expect } from "vitest";
import {
  loadOutbox, saveOutbox, holdUntil, dueNow, secondsLeft, holdLine, whenLabel, sendSlots,
  HOLD_SECONDS, type OutboxItem,
} from "./outbox";

const NOW = new Date("2026-08-20T10:00:00").getTime();
const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: "o1", to: "wei@northlake.org", subject: "Invoice", body: "hi",
  dueMs: NOW + 12000, scheduled: false, state: "held", ...over,
});

describe("undo send", () => {
  it("holds for a short, real window", () => {
    expect(holdUntil(NOW)).toBe(NOW + HOLD_SECONDS * 1000);
    expect(HOLD_SECONDS).toBeLessThanOrEqual(30); // a long hold is a delay, not safety
  });

  it("only releases what is actually due", () => {
    const items = [item({ id: "a", dueMs: NOW - 1 }), item({ id: "b", dueMs: NOW + 5000 })];
    expect(dueNow(items, NOW).map((i) => i.id)).toEqual(["a"]);
  });

  it("never picks up something already in flight: a double send is worse than a slow one", () => {
    expect(dueNow([item({ dueMs: NOW - 1, state: "sending" })], NOW)).toEqual([]);
  });

  it("leaves a failure in the outbox rather than dropping it silently", () => {
    expect(dueNow([item({ dueMs: NOW - 1, state: "failed" })], NOW)).toEqual([]);
  });

  it("counts down in whole seconds and stops at zero", () => {
    expect(secondsLeft(item({ dueMs: NOW + 5400 }), NOW)).toBe(6);
    expect(secondsLeft(item({ dueMs: NOW - 9999 }), NOW)).toBe(0);
  });

  it("says the countdown, or the time when it is scheduled", () => {
    expect(holdLine(item({ dueMs: NOW + 5000 }), NOW)).toBe("Sending in 5");
    expect(holdLine(item({ dueMs: NOW - 1 }), NOW)).toBe("Sending");
    expect(holdLine(item({ scheduled: true, dueMs: NOW + 7200e3 }), NOW)).toContain("Scheduled");
  });

  it("survives a reload", () => {
    let v: string | null = null;
    const st = { getItem: () => v, setItem: (_k: string, s: string) => { v = s; } };
    saveOutbox([item()], st);
    expect(loadOutbox(st)).toHaveLength(1);
  });

  it("survives a corrupt store without taking the tab down", () => {
    expect(loadOutbox({ getItem: () => "{not json" })).toEqual([]);
    expect(loadOutbox({ getItem: () => '[{"nope":1}]' })).toEqual([]);
  });
});

describe("schedule send", () => {
  const REF = new Date("2026-08-20T10:00:00"); // a Thursday

  it("names a time today, and a weekday when it is not today", () => {
    expect(whenLabel(new Date("2026-08-20T16:00:00").getTime(), REF)).toBe("4:00 PM");
    expect(whenLabel(new Date("2026-08-21T08:00:00").getTime(), REF)).toContain("Tomorrow");
    expect(whenLabel(new Date("2026-08-24T08:00:00").getTime(), REF)).toContain("Mon");
  });

  it("offers few, human choices rather than a minute picker", () => {
    const slots = sendSlots(REF.getTime());
    expect(slots.length).toBeGreaterThanOrEqual(2);
    expect(slots.length).toBeLessThanOrEqual(3);
    expect(slots.map((s) => s.label)).toContain("Monday Morning");
  });

  it("never offers a slot that has already gone", () => {
    const late = new Date("2026-08-20T20:00:00").getTime();
    for (const s of sendSlots(late)) expect(s.at).toBeGreaterThan(late);
  });

  it("Monday means the NEXT Monday, never today when today is Monday", () => {
    const monday = new Date("2026-08-24T10:00:00").getTime();
    const slot = sendSlots(monday).find((s) => s.label === "Monday Morning")!;
    expect(new Date(slot.at).getDate()).toBe(31);
  });
});
