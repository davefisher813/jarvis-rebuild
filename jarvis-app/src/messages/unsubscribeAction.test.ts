// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { requestUnsubscribe, type UnsubDeps } from "./unsubscribeAction";
import { loadUnsubs } from "./unsubRecords";
import { parseUnsub } from "./unsubscribe";

beforeEach(() => localStorage.clear());

const MAILTO = parseUnsub("<mailto:unsub@trailweekly.com?subject=stop>, <https://trailweekly.com/u/1>")!;
const WEB = parseUnsub("<https://trailweekly.com/u/1>")!;

function deps(over: Partial<UnsubDeps> = {}) {
  const sent: { account?: string; raw: string }[] = [];
  const opened: string[] = [];
  const asAccount = (account?: string) => ({ sendMessage: async (raw: string) => { sent.push({ ...(account ? { account } : {}), raw }); return { id: "s1" }; } });
  const d: UnsubDeps = { apiFor: asAccount, open: (u) => { opened.push(u); return true; }, today: () => "2026-09-29", ...over };
  return { d, sent, opened };
}

describe("requestUnsubscribe: the ask, extracted from the Email tab", () => {
  it("sends a mailto from the exact account and records it as asked only after the send was accepted", async () => {
    const { d, sent } = deps();
    const r = await requestUnsubscribe(MAILTO, "b@x.com", "News@TrailWeekly.com", d);
    expect(r).toEqual({ sent: true, kind: "mailto" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.account).toBe("b@x.com");
    expect(loadUnsubs()).toEqual([{ sender: "news@trailweekly.com", askedISO: "2026-09-29", via: "header", state: "asked", account: "b@x.com" }]);
  });

  it("records nothing when the send failed, and reports it", async () => {
    const { d } = deps({ apiFor: () => ({ sendMessage: async () => { throw new Error("500"); } }) });
    const r = await requestUnsubscribe(MAILTO, "b@x.com", "news@trailweekly.com", d);
    expect(r.sent).toBe(false);
    expect(loadUnsubs()).toEqual([]);
  });

  it("an account that is no longer connected counts as failed, not as skipped", async () => {
    const { d } = deps({ apiFor: () => null });
    expect((await requestUnsubscribe(MAILTO, "gone@x.com", "news@trailweekly.com", d)).sent).toBe(false);
    expect(loadUnsubs()).toEqual([]);
  });

  it("opens a web link inside the tap and records it as OPENED, not as an ask", async () => {
    const { d, opened } = deps();
    const p = requestUnsubscribe(WEB, "a@x.com", "news@trailweekly.com", d);
    expect(opened).toEqual(["https://trailweekly.com/u/1"]); // before any await
    expect((await p).sent).toBe(true);
    expect(loadUnsubs()[0]).toMatchObject({ via: "link", state: "opened", account: "a@x.com" });
  });

  it("a blocked tab is not recorded and not counted", async () => {
    const emit = vi.fn();
    const { d } = deps({ open: () => false, emit });
    expect((await requestUnsubscribe(WEB, "a@x.com", "news@trailweekly.com", d)).sent).toBe(false);
    expect(loadUnsubs()).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });

  it("hands the record to the caller's own store when it has one, and tells analytics once", async () => {
    const record = vi.fn();
    const emit = vi.fn();
    const { d } = deps({ record, emit });
    await requestUnsubscribe(MAILTO, undefined, "n@x.com", d);
    expect(record).toHaveBeenCalledWith({ sender: "n@x.com", askedISO: "2026-09-29", via: "header", state: "asked" });
    expect(emit).toHaveBeenCalledWith("mailto");
    expect(loadUnsubs()).toEqual([]);
  });

  it("with no sender named it still asks, and records nothing", async () => {
    const { d } = deps();
    expect((await requestUnsubscribe(MAILTO, "a@x.com", undefined, d)).sent).toBe(true);
    expect(loadUnsubs()).toEqual([]);
  });
});
