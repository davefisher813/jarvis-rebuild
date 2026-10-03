import { describe, it, expect } from "vitest";
import { accountLabels, dayGroups, freshnessLine, senderOf, sizeLine, shortAccount, whenShort } from "./format";
import type { EmailAccount, InboxRow } from "./emailClient";

const NOW = new Date("2026-10-03T15:00:00");
const row = (id: string, iso: string): InboxRow => ({
  id, account_id: "a", account: "dave@example.test", provider_id: id, thread_id: id, internal_date: iso, from_address: "x@y.test", from_name: "",
  subject: "s", snippet: "", has_body: false, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "h", read: true,
});
const account = (o: Partial<EmailAccount>): EmailAccount => ({ id: "a", address: "dave@example.test", state: "connected", last_sync_at: null, sync_error: null, capabilities: {}, connected_at: NOW.toISOString(), scopes: [], cached: 0, ...o });

describe("the sender", () => {
  it("is the name, else the address, else a plain word", () => {
    expect(senderOf({ from_name: "Con Edison", from_address: "b@c.test" })).toBe("Con Edison");
    expect(senderOf({ from_name: " ", from_address: "b@c.test" })).toBe("b@c.test");
    expect(senderOf({ from_name: "", from_address: "" })).toBe("Unknown Sender");
  });
});

describe("the row's time", () => {
  it("is the clock today, Yesterday yesterday, the short date before that", () => {
    expect(whenShort("2026-10-03T09:12:00", NOW)).toMatch(/9:12/);
    expect(whenShort("2026-10-02T09:12:00", NOW)).toBe("Yesterday");
    expect(whenShort("2026-09-28T09:12:00", NOW)).not.toMatch(/9:12|Yesterday/);
  });
});

describe("day groups", () => {
  it("keep the given order and split on the day", () => {
    const g = dayGroups([row("1", "2026-10-03T10:00:00"), row("2", "2026-10-03T09:00:00"), row("3", "2026-10-02T09:00:00"), row("4", "2026-09-30T09:00:00")], NOW);
    expect(g.map((x) => [x.label, x.rows.map((r) => r.id)])).toEqual([["Today", ["1", "2"]], ["Yesterday", ["3"]], [g[2]!.label, ["4"]]]);
    expect(g[2]!.label).not.toMatch(/Today|Yesterday/);
  });
});

describe("sizes", () => {
  it("say KB under a megabyte and one decimal above", () => {
    expect(sizeLine(0)).toBe("0 KB");
    expect(sizeLine(500)).toBe("1 KB");
    expect(sizeLine(245760)).toBe("240 KB");
    expect(sizeLine(1258291)).toBe("1.2 MB");
  });
});

describe("freshness", () => {
  it("is the stalest good sync among the live accounts, with the count", () => {
    const line = freshnessLine([
      account({ id: "a", last_sync_at: "2026-10-03T14:50:00" }),
      account({ id: "b", address: "work@example.test", last_sync_at: "2026-10-03T09:05:00" }),
      account({ id: "c", address: "old@example.test", state: "disconnected", last_sync_at: "2026-09-01T09:05:00" }),
    ], NOW);
    expect(line).toMatch(/^Updated Today · 9:05/);
    expect(line).toMatch(/2 Accounts$/);
  });
  it("says Not Synced Yet before the first good sync, and nothing with no live account", () => {
    expect(freshnessLine([account({})], NOW)).toBe("Not Synced Yet · 1 Account");
    expect(freshnessLine([account({ state: "disconnected" })], NOW)).toBe("");
  });
});

describe("the account chip", () => {
  it("is the local part", () => {
    expect(shortAccount("dave@example.test")).toBe("dave");
    expect(shortAccount("odd")).toBe("odd");
  });
  it("is the whole address when two mailboxes share a local part", () => {
    expect(accountLabels(["dave@example.test", "work@example.test"])).toEqual({ "dave@example.test": "dave", "work@example.test": "work" });
    expect(accountLabels(["dave@example.test", "dave@work.test"])).toEqual({ "dave@example.test": "example.test", "dave@work.test": "work.test" });
    expect(accountLabels(["dave@example.test", "dave@example.test"])).toEqual({ "dave@example.test": "dave@example.test" });
  });
});
