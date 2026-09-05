// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { captureError, setErrorSink, createFetchSink, toErrorReport, initMonitoring, resolveSinkUrl, OWN_RECEIVER_PATH, type ErrorReport } from "./monitor";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  setErrorSink(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("monitor", () => {
  it("forwards captured errors to the registered sink", () => {
    const seen: unknown[] = [];
    setErrorSink((e) => seen.push(e));
    captureError(new Error("boom"));
    expect(seen.length).toBe(1);
    setErrorSink(null);
    captureError(new Error("ignored"));
    expect(seen.length).toBe(1);
  });
});

// PLUMB-F-11 (2026-09-05): the seam had no sink for its whole life. These
// prove the fetch sink actually ships a report, bounds itself, and can never
// become a second failure on top of the first.
describe("createFetchSink", () => {
  function harness(opts: { reject?: boolean; throwSync?: boolean } = {}) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (opts.throwSync) throw new TypeError("bad url");
      return opts.reject ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve(new Response(null, { status: 204 }));
    }) as unknown as typeof fetch;
    let t = 1_000_000;
    const now = () => t;
    const advance = (ms: number) => { t += ms; };
    const body = (i: number) => JSON.parse(String(calls[i]!.init.body)) as ErrorReport;
    return { calls, fetchFn, now, advance, body };
  }

  it("POSTs the error as a JSON report with name, message, stack and context", () => {
    const h = harness();
    const sink = createFetchSink("https://example.test/errors", { fetchFn: h.fetchFn, now: h.now });
    const err = new RangeError("out of range");
    sink(err, { where: "AppGate.isOnboarded" });
    expect(h.calls.length).toBe(1);
    expect(h.calls[0]!.url).toBe("https://example.test/errors");
    expect(h.calls[0]!.init.method).toBe("POST");
    expect(h.calls[0]!.init.keepalive).toBe(true);
    const r = h.body(0);
    expect(r.name).toBe("RangeError");
    expect(r.message).toBe("out of range");
    expect(r.stack).toContain("out of range");
    expect(r.context).toEqual({ where: "AppGate.isOnboarded" });
    expect(typeof r.at).toBe("string");
    expect(typeof r.build).toBe("string");
  });

  it("sends the same error once per repeat window, then again after it", () => {
    const h = harness();
    const sink = createFetchSink("https://example.test/errors", { fetchFn: h.fetchFn, now: h.now, repeatWindowMs: 60_000 });
    const err = new Error("same");
    sink(err);
    sink(err);
    sink(err);
    expect(h.calls.length).toBe(1);
    h.advance(60_001);
    sink(err);
    expect(h.calls.length).toBe(2);
  });

  it("caps distinct reports per minute so a render loop cannot flood the receiver", () => {
    const h = harness();
    const sink = createFetchSink("https://example.test/errors", { fetchFn: h.fetchFn, now: h.now, maxPerMinute: 3 });
    for (let i = 0; i < 10; i++) sink(new Error("distinct " + i));
    expect(h.calls.length).toBe(3);
    h.advance(60_000);
    sink(new Error("after the minute"));
    expect(h.calls.length).toBe(4);
  });

  it("never throws when the request rejects or fetch itself throws", async () => {
    const rejecting = harness({ reject: true });
    const sink1 = createFetchSink("https://example.test/errors", { fetchFn: rejecting.fetchFn, now: rejecting.now });
    expect(() => sink1(new Error("x"))).not.toThrow();
    await Promise.resolve();
    const throwing = harness({ throwSync: true });
    const sink2 = createFetchSink("not a url", { fetchFn: throwing.fetchFn, now: throwing.now });
    expect(() => sink2(new Error("y"))).not.toThrow();
  });

  it("reports non-Error throwables as a message, not [object Object]", () => {
    expect(toErrorReport("plain string").message).toBe("plain string");
    expect(toErrorReport({ code: 42 }).message).toBe('{"code":42}');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => toErrorReport(new Error("c"), cyclic)).not.toThrow();
  });

  it("carries the path but never the query string or hash", () => {
    window.history.replaceState(null, "", "/settings?code=secret#access_token=abc");
    const r = toErrorReport(new Error("p"));
    expect(r.path).toBe("/settings");
    expect(JSON.stringify(r)).not.toContain("secret");
    expect(JSON.stringify(r)).not.toContain("access_token");
  });
});

describe("resolveSinkUrl", () => {
  it("maps 1 to the app's own receiver, keeps URLs and paths, and rejects the rest", () => {
    expect(resolveSinkUrl("1")).toBe(OWN_RECEIVER_PATH);
    expect(resolveSinkUrl("true")).toBe(OWN_RECEIVER_PATH);
    expect(resolveSinkUrl("https://example.test/errors")).toBe("https://example.test/errors");
    expect(resolveSinkUrl("/api/somewhere")).toBe("/api/somewhere");
    expect(resolveSinkUrl(undefined)).toBeNull();
    expect(resolveSinkUrl("")).toBeNull();
    expect(resolveSinkUrl("   ")).toBeNull();
    expect(resolveSinkUrl("yes")).toBeNull();
  });
});

describe("initMonitoring", () => {
  it("wires window.error and unhandledrejection to the configured sink", async () => {
    vi.stubEnv("VITE_ERROR_SINK", "https://example.test/errors");
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      calls.push(String(init?.body));
      return Promise.resolve(new Response(null, { status: 204 }));
    }));
    initMonitoring();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("window crash"), message: "window crash" }));
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("window crash");
    expect(calls[0]).toContain('"kind":"window.error"');

    const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
    rejection.reason = new Error("nobody caught me");
    window.dispatchEvent(rejection);
    expect(calls.length).toBe(2);
    expect(calls[1]).toContain("nobody caught me");
    expect(calls[1]).toContain('"kind":"unhandledrejection"');
  });

  it("sets no sink when the env var is absent", () => {
    vi.stubEnv("VITE_ERROR_SINK", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    initMonitoring();
    captureError(new Error("local only"));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
