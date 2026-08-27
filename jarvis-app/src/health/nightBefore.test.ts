import { describe, it, expect } from "vitest";
import { firstFixedCommitment, nightBeforeOffer, TARGET_SLEEP_HOURS, WIND_DOWN_BUFFER_MIN } from "./nightBefore";

describe("firstFixedCommitment", () => {
  it("picks the earliest commitment still ahead of now", () => {
    const now = Date.parse("2026-08-27T20:00:00");
    const bus = { title: "Bus", at: Date.parse("2026-08-28T06:10:00") };
    const test = { title: "Chem Test", at: Date.parse("2026-08-28T08:30:00") };
    expect(firstFixedCommitment([test, bus], now)!.title).toBe("Bus");
  });

  it("returns null when nothing fixed is ahead", () => {
    const now = Date.parse("2026-08-27T20:00:00");
    expect(firstFixedCommitment([{ title: "Past Thing", at: now - 1000 }], now)).toBeNull();
  });
});

describe("nightBeforeOffer", () => {
  it("backs out a wind-down time from the earliest commitment", () => {
    const now = Date.parse("2026-08-27T20:00:00");
    const callTime = Date.parse("2026-08-28T06:10:00");
    const offer = nightBeforeOffer([{ title: "Bus", at: callTime }], now);
    expect(offer).not.toBeNull();
    const expected = callTime - TARGET_SLEEP_HOURS * 3600000 - WIND_DOWN_BUFFER_MIN * 60000;
    expect(offer!.windDownAt).toBe(expected);
    expect(offer!.commitmentTitle).toBe("Bus");
  });

  it("is null with nothing to anchor on, and never states a shortfall in the shape it returns", () => {
    const now = Date.now();
    expect(nightBeforeOffer([], now)).toBeNull();
    const offer = nightBeforeOffer([{ title: "Game", at: now + 3600000 }], now)!;
    expect(Object.keys(offer).sort()).toEqual(["commitmentAt", "commitmentTitle", "windDownAt"]);
  });
});
