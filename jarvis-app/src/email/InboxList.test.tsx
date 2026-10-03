// @vitest-environment jsdom
// A LONG LIST DOES NOT REDRAW EVERY ROW (slice 09; IMPLEMENTATION-SPEC.md 17:
// "500-row cache scroll free of repeated full-list rerenders"). Counted, not
// promised: 500 rows render once; the parent re-rendering with the same rows,
// a new groups array, a new handler closure avoided, or the clock ten seconds
// on draws no row again; one changed row redraws that row alone.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("./format", async (importOriginal) => {
  const m = await importOriginal<typeof import("./format")>();
  return { ...m, senderOf: vi.fn(m.senderOf) };
});

import InboxList from "./InboxList";
import { dayGroups, senderOf } from "./format";
import type { InboxRow } from "./emailClient";

const NOW = new Date("2026-10-03T15:00:00Z");
const row = (i: number): InboxRow => ({
  id: `m${i}`, account_id: "acct-1", account: "dave@example.test", provider_id: `p${i}`, thread_id: `t${i}`,
  internal_date: new Date(NOW.getTime() - i * 3_600_000).toISOString(), from_address: `sender${i % 37}@example.test`, from_name: `Sender ${i % 37}`,
  subject: `Subject ${i}`, snippet: "", has_body: false, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: `h${i}`, read: i % 3 === 0,
});
const calls = () => (senderOf as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

describe("InboxList with 500 cached rows", () => {
  beforeEach(() => { (senderOf as unknown as { mockClear: () => void }).mockClear(); });

  it("draws each row once, and again only when that row changed or the minute turned", () => {
    const rows = Array.from({ length: 500 }, (_, i) => row(i));
    const onOpen = vi.fn();
    const groups = dayGroups(rows, NOW);
    const r = render(<InboxList groups={groups} labels={{}} now={NOW} onOpen={onOpen} atEnd />);
    expect(r.container.querySelectorAll(".mrow").length).toBe(500);
    expect(calls()).toBe(500);

    // The parent re-rendered: same rows, same handler, ten seconds on. No row redraws.
    r.rerender(<InboxList groups={groups} labels={{}} now={new Date(NOW.getTime() + 10_000)} onOpen={onOpen} atEnd />);
    expect(calls()).toBe(500);

    // A fresh groups array over the same row objects (the list was re-sorted, nothing changed). No row redraws.
    r.rerender(<InboxList groups={dayGroups(rows, NOW)} labels={{}} now={NOW} onOpen={onOpen} atEnd />);
    expect(calls()).toBe(500);

    // One row read: that row alone.
    const changed = rows.slice();
    changed[7] = { ...rows[7]!, read: true };
    r.rerender(<InboxList groups={dayGroups(changed, NOW)} labels={{}} now={NOW} onOpen={onOpen} atEnd />);
    expect(calls()).toBe(501);

    // The minute turned: the time words may change, so every row may redraw. Bounded to one pass.
    r.rerender(<InboxList groups={dayGroups(changed, NOW)} labels={{}} now={new Date(NOW.getTime() + 60_000)} onOpen={onOpen} atEnd />);
    expect(calls()).toBe(1001);
  });

  it("a new handler closure on every render would redraw every row, which is why EmailFlow keeps one", () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(i));
    const groups = dayGroups(rows, NOW);
    const r = render(<InboxList groups={groups} labels={{}} now={NOW} onOpen={() => {}} atEnd />);
    expect(calls()).toBe(50);
    r.rerender(<InboxList groups={groups} labels={{}} now={NOW} onOpen={() => {}} atEnd />);
    expect(calls()).toBe(100);
  });
});
