import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendFeedback, tooLong, byteLength, MAX_FEEDBACK_BYTES, FEEDBACK_MESSAGE } from "./feedback";
import { captureError, lastErrorText, recentErrors, clearRecentErrors, setErrorSink } from "../monitoring/monitor";
import { mapFeedback, deviceName } from "../admin/adminCompute";

// UP-LAUNCH-16 (2026-09-05). The one support channel a TestFlight tester will
// use, so the thing it must never do is say "Sent" about a message that did
// not land.

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); clearRecentErrors(); });
afterEach(() => { setErrorSink(null); vi.restoreAllMocks(); });

const ok = () => Promise.resolve({ ok: true, status: 204 });

describe("sending feedback", () => {
  it("POSTs the message with the bearer token and the build", async () => {
    const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
    const r = await sendFeedback(
      { text: "  the gym timer keeps running  ", build: "abc1234", device: "iPhone", template: "student" },
      "tok", "https://api.test/api/feedback",
      (url, init) => { calls.push({ url, init }); return ok(); },
    );
    expect(r).toBe("sent");
    expect(calls[0]!.init.headers["Authorization"]).toBe("Bearer tok");
    const body = JSON.parse(calls[0]!.init.body) as Record<string, unknown>;
    expect(body["text"]).toBe("the gym timer keeps running");
    expect(body["build"]).toBe("abc1234");
    expect(body["template"]).toBe("student");
    expect("lastError" in body).toBe(false);
  });

  it("attaches the last error only when there is one and the switch is on", async () => {
    let body: Record<string, unknown> = {};
    await sendFeedback({ text: "hi", build: "b", device: "d", template: "t", lastError: "TypeError: x" },
      "tok", "u", (_u, init) => { body = JSON.parse(init.body) as Record<string, unknown>; return ok(); });
    expect(body["lastError"]).toBe("TypeError: x");
    await sendFeedback({ text: "hi", build: "b", device: "d", template: "t", lastError: null },
      "tok", "u", (_u, init) => { body = JSON.parse(init.body) as Record<string, unknown>; return ok(); });
    expect("lastError" in body).toBe(false);
  });

  it("never says sent for anything but a 2xx", async () => {
    // The law: a toast that says sent fires only after the write resolved.
    expect(await sendFeedback({ text: "x", build: "", device: "", template: "" }, "tok", "u",
      () => Promise.resolve({ ok: false, status: 500 }))).toBe("failed");
    expect(await sendFeedback({ text: "x", build: "", device: "", template: "" }, "tok", "u",
      () => Promise.resolve({ ok: false, status: 429 }))).toBe("rate-limited");
    expect(await sendFeedback({ text: "x", build: "", device: "", template: "" }, "tok", "u",
      () => Promise.reject(new TypeError("offline")))).toBe("failed");
  });

  it("refuses an empty message, an over-long one, and a signed-out send, before the network", async () => {
    const never = () => { throw new Error("must not be called"); };
    expect(await sendFeedback({ text: "   ", build: "", device: "", template: "" }, "tok", "u", never)).toBe("empty");
    expect(await sendFeedback({ text: "x".repeat(MAX_FEEDBACK_BYTES + 1), build: "", device: "", template: "" }, "tok", "u", never)).toBe("too-long");
    expect(await sendFeedback({ text: "x", build: "", device: "", template: "" }, undefined, "u", never)).toBe("signed-out");
  });

  it("counts the cap in bytes, because an emoji is four of them", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("\u{1F600}")).toBe(4);
    expect(tooLong("a".repeat(MAX_FEEDBACK_BYTES))).toBe(false);
    expect(tooLong("\u{1F600}".repeat(MAX_FEEDBACK_BYTES / 4 + 1))).toBe(true);
  });

  it("every failure has a sentence, so nothing fails silently", () => {
    for (const key of ["empty", "too-long", "rate-limited", "failed", "signed-out"] as const) {
      expect(FEEDBACK_MESSAGE[key].length).toBeGreaterThan(10);
    }
  });
});

describe("the last error the sheet can attach", () => {
  it("is nothing at all until something fails", () => {
    expect(lastErrorText()).toBeNull();
    expect(recentErrors()).toEqual([]);
  });

  it("is the newest crash, with its stack", () => {
    captureError(new RangeError("out of range"));
    const text = lastErrorText()!;
    expect(text).toContain("RangeError: out of range");
    expect(text.split("\n").length).toBeGreaterThan(1);
  });

  it("keeps twenty and forgets the rest, because it is a convenience and not a log", () => {
    for (let i = 0; i < 25; i++) captureError(new Error("crash " + i));
    const all = recentErrors();
    expect(all).toHaveLength(20);
    expect(all[0]!.message).toBe("crash 5");
    expect(all[19]!.message).toBe("crash 24");
  });

  it("carries no text the user wrote, because the ring is scrubbed on the way in", () => {
    captureError(new Error("Couldn't save: " + "n".repeat(900)));
    expect(lastErrorText()).not.toContain("nnnn");
    expect(lastErrorText()).toContain("[dropped");
  });
});

describe("the admin panel's feedback rows", () => {
  it("keeps the whole message and names the device without the version soup", () => {
    const rows = mapFeedback([{
      id: "f1", text: "It froze.\nThen it came back.", build: "abc1234", template: "student",
      device: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
      last_error: "TypeError: x", created_at: "2026-09-05T10:00:00.000Z",
    }]);
    expect(rows[0]!.text).toBe("It froze.\nThen it came back.");
    expect(rows[0]!.meta).toBe("abc1234 · student · iPhone");
    expect(rows[0]!.lastError).toBe("TypeError: x");
  });

  it("leaves out the parts that are empty rather than rendering blanks", () => {
    const rows = mapFeedback([{ id: "f2", text: "hi", created_at: "2026-09-05T10:00:00.000Z" }]);
    expect(rows[0]!.meta).toBe("");
    expect(rows[0]!.lastError).toBeNull();
  });

  it("names the shapes it knows and stays quiet about the rest", () => {
    expect(deviceName("... iPad ...")).toBe("iPad");
    expect(deviceName("... Macintosh ...")).toBe("Mac");
    expect(deviceName("curl/8")).toBe("Other");
    expect(deviceName(undefined)).toBe("");
  });
});
