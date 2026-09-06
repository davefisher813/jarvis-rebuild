import { describe, it, expect, beforeEach } from "vitest";
import { onAppUrl, deliverAppUrl, resetAppUrlForTest } from "./appUrl";

// UP-LAUNCH-12 (2026-09-05): the bus every incoming URL arrives on. Three
// different features will share it (the Google callback, the magic link, the
// widget deep links), so the contract matters more than any one of them.

beforeEach(() => { resetAppUrlForTest(); });

describe("the incoming URL bus", () => {
  it("stops at the first handler that claims the URL, because a URL means one thing", async () => {
    const seen: string[] = [];
    onAppUrl(() => { seen.push("first"); return false; });
    onAppUrl(() => { seen.push("second"); return true; });
    onAppUrl(() => { seen.push("third"); return false; });
    expect(await deliverAppUrl("jarvis://task/1")).toBe(true);
    // Newest first: a listener registered for the flow happening right now
    // sees the URL before the standing one registered at boot.
    expect(seen).toEqual(["third", "second"]);
  });

  it("says so when nobody wanted it, rather than swallowing it", async () => {
    onAppUrl(() => false);
    expect(await deliverAppUrl("jarvis://nothing")).toBe(false);
  });

  it("a handler that throws does not cost the URL its other handlers", async () => {
    let reached = false;
    onAppUrl(() => { reached = true; return true; });
    onAppUrl(() => { throw new Error("bad handler"); });
    expect(await deliverAppUrl("jarvis://x")).toBe(true);
    expect(reached).toBe(true);
  });

  it("is not fooled by something that is not a URL at all", async () => {
    let called = false;
    onAppUrl(() => { called = true; return true; });
    expect(await deliverAppUrl("not a url")).toBe(false);
    expect(called).toBe(false);
  });

  it("unsubscribes cleanly", async () => {
    let n = 0;
    const off = onAppUrl(() => { n += 1; return true; });
    await deliverAppUrl("jarvis://a");
    off();
    await deliverAppUrl("jarvis://b");
    expect(n).toBe(1);
  });
});
