import { describe, it, expect } from "vitest";
import { buildMailDigests, asOfLine, inRefreshLead, MAIL_DIGEST_BASE, MAIL_DIGEST_CAP, QUIET_START_MIN, QUIET_END_MIN } from "./mailDigest";
import { DEFAULT_WINDOWS } from "./batching";
import { IOS_PENDING_LIMIT, CHECKIN_BUDGET, TASK_REMINDER_CAP, EVENT_REMINDER_CAP, MAIL_DIGEST_BUDGET } from "../shared/notifications";

// UP-MIND-14, chosen option: the local digest. The trial this rests on found
// that batching helped AND that turning notifications off backfired, so the
// digest exists and says who wrote. These pin what it may say and when.

describe("the digest", () => {
  const peek = "3 People wrote · Sarah needs you";

  it("is one per window, at the window start", () => {
    const specs = buildMailDigests(DEFAULT_WINDOWS.windows, peek, Date.now());
    expect(specs.map((s) => [s.hour, s.minute])).toEqual([[9, 0], [13, 0], [17, 0]]);
    expect(specs.map((s) => s.id)).toEqual([MAIL_DIGEST_BASE, MAIL_DIGEST_BASE + 1, MAIL_DIGEST_BASE + 2]);
  });

  it("says who wrote, never a count of unread", () => {
    const specs = buildMailDigests(DEFAULT_WINDOWS.windows, peek, Date.now());
    expect(specs[0]!.title).toBe(peek);
    expect(specs[0]!.title.toLowerCase()).not.toContain("unread");
  });

  // Silence is not calm. A quiet inbox still gets its line.
  it("still fires when nothing needs you", () => {
    const specs = buildMailDigests(DEFAULT_WINDOWS.windows, "Nothing from a person", Date.now());
    expect(specs).toHaveLength(3);
    expect(specs[0]!.title).toBe("Nothing from a person");
  });

  it("never fires in the night", () => {
    const specs = buildMailDigests(
      [{ startMin: 3 * 60, minutes: 45 }, { startMin: 23 * 60, minutes: 45 }, { startMin: 9 * 60, minutes: 45 }],
      peek, Date.now(),
    );
    expect(specs).toHaveLength(1);
    expect(specs[0]!.hour).toBe(9);
    expect(QUIET_START_MIN).toBeLessThan(QUIET_END_MIN);
  });

  it("stays inside its own id block", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ startMin: (8 + i) * 60, minutes: 30 }));
    const specs = buildMailDigests(many, peek, Date.now());
    expect(specs.length).toBeLessThanOrEqual(MAIL_DIGEST_CAP);
  });

  it("says when the app last looked, rather than pretending to be live", () => {
    const t = new Date(2026, 7, 15, 8, 50).getTime();
    expect(asOfLine(t)).toBe("As of 8:50 AM");
    expect(asOfLine(0)).toBe("JARVIS hasn't checked yet");
  });
});

describe("looking before the window", () => {
  it("is due in the ten minutes before a start, and not otherwise", () => {
    const w = DEFAULT_WINDOWS.windows;
    expect(inRefreshLead(w, 8 * 60 + 55)).toBe(true);
    expect(inRefreshLead(w, 9 * 60)).toBe(false);
    expect(inRefreshLead(w, 8 * 60)).toBe(false);
    expect(inRefreshLead(w, 12 * 60 + 51)).toBe(true);
  });
});

// The whole app's notification spend is one arithmetic, and this took its
// share from it rather than quietly overrunning the OS.
describe("the budget still adds up", () => {
  it("fits inside the iOS pending limit", () => {
    expect(CHECKIN_BUDGET + TASK_REMINDER_CAP + EVENT_REMINDER_CAP + MAIL_DIGEST_BUDGET).toBe(IOS_PENDING_LIMIT);
  });
});
