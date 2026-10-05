import { describe, it, expect } from "vitest";
import { accountLabels, dayGroups, dotFacts, freshnessFacts, senderOf, sizeLine, shortAccount, updatedFacts, whenFacts, whenShort, whenWords } from "./format";
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
  const texts = (f: { text: string }[]) => f.map((x) => x.text);
  it("is the stalest good sync among the live accounts, with the count, as three facts and no middle dot", () => {
    const f = freshnessFacts([
      account({ id: "a", last_sync_at: "2026-10-03T14:50:00" }),
      account({ id: "b", address: "work@example.test", last_sync_at: "2026-10-03T09:05:00" }),
      account({ id: "c", address: "old@example.test", state: "disconnected", last_sync_at: "2026-09-01T09:05:00" }),
    ], NOW);
    expect(f.map((x) => x.text)).toEqual(["Updated Today", expect.stringMatching(/^9:05/), "2 Accounts"]);
    // The day is the one grey, the clock is a neutral small-caps fact, the count is a white number with no state.
    expect(f.map((x) => x.tone)).toEqual([undefined, "date", undefined]);
    expect(f[2]!.strong).toBe(true);
    for (const x of f) expect(x.text).not.toMatch(/\u00B7/);
  });
  it("says Not Synced Yet before the first good sync, and nothing with no live account", () => {
    expect(texts(freshnessFacts([account({})], NOW))).toEqual(["Not Synced Yet", "1 Account"]);
    expect(freshnessFacts([account({ state: "disconnected" })], NOW)).toEqual([]);
  });
});

describe("a time and a copy line are facts, never one string joined by middle dots (2026-10-05)", () => {
  it("whenFacts is the day then the clock, both neutral small caps; whenWords is the same as one value for a table", () => {
    const f = whenFacts("2026-10-03T09:12:00", NOW);
    expect(f.map((x) => x.text)).toEqual(["Today", expect.stringMatching(/^9:12/)]);
    expect(f.every((x) => x.tone === "date")).toBe(true);
    expect(whenWords("2026-10-03T09:12:00", NOW)).toMatch(/^Today 9:12/);
    expect(whenWords("2026-10-03T09:12:00", NOW)).not.toMatch(/\u00B7/);
    expect(updatedFacts("2026-10-02T09:12:00", NOW).map((x) => x.text)[0]).toBe("Updated Yesterday");
  });
  it("dotFacts splits a copy constant at its dots: the first fact takes the tone, the rest are the one grey", () => {
    expect(dotFacts("Gmail Accepted It \u00B7 Accepted Is Not Read", "good")).toEqual([{ text: "Gmail Accepted It", tone: "good" }, { text: "Accepted Is Not Read" }]);
    expect(dotFacts("Offline")).toEqual([{ text: "Offline" }]);
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
