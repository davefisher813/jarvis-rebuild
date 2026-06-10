import { describe, it, expect, vi } from "vitest";
import { captureError, setErrorSink } from "./monitor";

describe("monitor", () => {
  it("forwards captured errors to the registered sink", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: unknown[] = [];
    setErrorSink((e) => seen.push(e));
    captureError(new Error("boom"));
    expect(seen.length).toBe(1);
    setErrorSink(null);
    captureError(new Error("ignored"));
    expect(seen.length).toBe(1);
  });
});
