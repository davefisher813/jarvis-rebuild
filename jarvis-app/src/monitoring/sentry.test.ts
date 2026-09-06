// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseDsn, envelope, sentryEvent, authHeader, CLIENT } from "./sentry";
import { scrubReport, scrubText, MAX_TEXT } from "./scrub";
import { createSentrySink, createFetchSink, toErrorReport, setErrorSink, type ErrorReport } from "./monitor";

// UP-LAUNCH-07 (2026-09-05). Two questions, both of which have to be
// answerable without a Sentry account: does a crash arrive in the shape
// Sentry accepts, and can anything the user wrote ride along with it.

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { setErrorSink(null); vi.restoreAllMocks(); });

const report = (over: Partial<ErrorReport> = {}): ErrorReport => ({
  name: "TypeError", message: "x is not a function", stack: "TypeError: x\n  at f (a.js:1:1)",
  at: "2026-09-05T10:00:00.000Z", build: "abc1234", ...over,
});

describe("the DSN", () => {
  it("parses the documented shape into an envelope endpoint", () => {
    const dsn = parseDsn("https://abc123@o4507.ingest.us.sentry.io/4509");
    expect(dsn).toEqual({ endpoint: "https://o4507.ingest.us.sentry.io/api/4509/envelope/", publicKey: "abc123" });
    expect(authHeader(dsn!)).toBe(`Sentry sentry_version=7, sentry_client=${CLIENT}, sentry_key=abc123`);
  });

  it("refuses anything that is not one, rather than posting into the void", () => {
    // A half-parsed DSN is worse than none: it looks configured and reports
    // nothing, which is exactly the failure PLUMB-F-11 spent months in.
    for (const bad of ["", "   ", "1", "not a url", "https://o1.sentry.io/4509", "https://key@host/notanumber"]) {
      expect(parseDsn(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(parseDsn(undefined)).toBeNull();
  });
});

describe("the envelope", () => {
  it("is three JSON lines: envelope header, item header, event", () => {
    const lines = envelope(report(), "f".repeat(32)).trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toEqual({ event_id: "f".repeat(32), sent_at: "2026-09-05T10:00:00.000Z" });
    expect(JSON.parse(lines[1]!)).toEqual({ type: "event" });
    const event = JSON.parse(lines[2]!) as Record<string, unknown>;
    expect(event["event_id"]).toBe("f".repeat(32));
    expect(event["level"]).toBe("error");
  });

  it("carries the build id as the release, so a stack maps to a commit", () => {
    const event = sentryEvent(report({ build: "deadbee" }));
    expect(event["release"]).toBe("deadbee");
  });

  it("carries the exception type, message and stack", () => {
    const event = sentryEvent(report()) as { exception: { values: { type: string; value: string }[] }; extra: Record<string, unknown> };
    expect(event.exception.values[0]!.type).toBe("TypeError");
    expect(event.exception.values[0]!.value).toBe("x is not a function");
    expect(String(event.extra["stack"])).toContain("at f (a.js:1:1)");
  });

  it("names no user, ever", () => {
    // The one line that would turn an unlinked crash record into a linked
    // one, and the reason the privacy manifest can declare Crash Data as
    // not linked to identity.
    const event = sentryEvent(report({ context: { where: "AppGate" } }));
    expect(event["user"]).toBeUndefined();
    expect(JSON.stringify(event)).not.toMatch(/"user"|user_id|email/);
  });
});

describe("the scrub", () => {
  it("drops any string longer than a label, rather than truncating it", () => {
    // Half of a note is still a note. The dropped length is kept because
    // "this was 4,000 characters" is a useful thing to see in a bug.
    const note = "a".repeat(1200);
    expect(scrubText("Couldn't save")).toBe("Couldn't save");
    expect(scrubText("b".repeat(MAX_TEXT))).toBe("b".repeat(MAX_TEXT));
    expect(scrubText(note)).toBe("[dropped 1200 chars]");
  });

  it("reaches into a nested context, because that is where a note ends up", () => {
    const r = scrubReport(report({ message: "n".repeat(500), context: { deep: { text: "m".repeat(500) }, list: ["ok", "z".repeat(300)] } }));
    expect(r.message).toBe("[dropped 500 chars]");
    const ctx = r.context as { deep: { text: string }; list: string[] };
    expect(ctx.deep.text).toBe("[dropped 500 chars]");
    expect(ctx.list).toEqual(["ok", "[dropped 300 chars]"]);
  });

  it("keeps the stack, which is code and is the entire point", () => {
    const long = "Error\n" + Array.from({ length: 40 }, (_, i) => `  at fn${i} (chunk.js:${i}:1)`).join("\n");
    expect(scrubReport(report({ stack: long })).stack).toBe(long);
  });

  it("takes a dropped message back out of the stack, where it also appears", () => {
    // A stack begins "Error: <message>". Dropping the message and keeping the
    // stack verbatim put the whole thing back, which is how this shipped for
    // about ten minutes.
    const note = "Dear Karen, " + "s".repeat(400);
    const r = scrubReport(report({ message: "Save failed: " + note, stack: `Error: Save failed: ${note}\n  at save (a.js:1:1)` }));
    expect(r.stack).not.toContain("Karen");
    expect(r.stack).toContain("[dropped");
    expect(r.stack).toContain("at save (a.js:1:1)");
  });

  it("truncates a React componentStack instead of dropping it", () => {
    const cs = Array.from({ length: 300 }, () => "\n    in Thing").join("");
    const out = scrubReport(report({ context: { componentStack: cs } })).context as { componentStack: string };
    expect(out.componentStack.startsWith("\n    in Thing")).toBe(true);
    expect(out.componentStack.length).toBeLessThanOrEqual(2000);
  });

  it("both sinks scrub, so a new sink cannot ship without it", () => {
    const bodies: string[] = [];
    const fetchFn = vi.fn((_u: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as unknown as typeof fetch;
    const secret = "Dear Karen, about the settlement " + "s".repeat(400);
    const dsn = parseDsn("https://k@o1.ingest.sentry.io/2")!;
    createSentrySink(dsn, { fetchFn })(new Error("draft failed"), { draft: secret });
    createFetchSink("https://example.test/e", { fetchFn })(new Error("draft failed"), { draft: secret });
    expect(bodies).toHaveLength(2);
    for (const b of bodies) expect(b).not.toContain("settlement");
  });
});

describe("the Sentry sink", () => {
  it("POSTs an envelope with the auth header, and never awaits it", () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as unknown as typeof fetch;
    const dsn = parseDsn("https://pub@o9.ingest.sentry.io/77")!;
    createSentrySink(dsn, { fetchFn })(new RangeError("nope"));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://o9.ingest.sentry.io/api/77/envelope/");
    expect((calls[0]!.init.headers as Record<string, string>)["x-sentry-auth"]).toContain("sentry_key=pub");
    expect(calls[0]!.init.keepalive).toBe(true);
    expect(String(calls[0]!.init.body).split("\n")).toHaveLength(4); // three lines and a trailing newline
  });

  it("obeys the same flood ceiling as the first-party sink", () => {
    let n = 0;
    const fetchFn = vi.fn(() => { n += 1; return Promise.resolve(new Response(null, { status: 200 })); }) as unknown as typeof fetch;
    const dsn = parseDsn("https://pub@o9.ingest.sentry.io/77")!;
    const sink = createSentrySink(dsn, { fetchFn, maxPerMinute: 3, repeatWindowMs: 0, now: () => 1_000_000 });
    for (let i = 0; i < 10; i++) sink(new Error("crash " + i));
    expect(n).toBe(3);
  });

  it("never throws when the network does", async () => {
    const fetchFn = vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
    const dsn = parseDsn("https://pub@o9.ingest.sentry.io/77")!;
    expect(() => createSentrySink(dsn, { fetchFn })(new Error("boom"))).not.toThrow();
    await Promise.resolve();
  });

  it("the report it sends is the report the seam built", () => {
    expect(toErrorReport(new Error("hi")).name).toBe("Error");
  });
});
