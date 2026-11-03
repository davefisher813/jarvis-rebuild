// @vitest-environment jsdom
// THE SENDER'S GROUP BADGE (Dave 2026-11-03, issue 112: yes; spec AC07): a saved contact's first area as the unified chip, +N for
// the rest; an unknown sender, an address two contacts share, the person's own mailbox and a removed area show nothing.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { groupBadges } from "./contactResolve";
import MailRow from "./MailRow";
import { setCategoryRegistry } from "../shared/categories";
import type { Person } from "../people/types";
import type { InboxRow } from "./emailClient";

const person = (id: string, email: string, categoryIds: string[], extra: string[] = []): Person =>
  ({ id, data: { name: id, group: "contacts", email, ...(extra.length ? { emails: extra.map((value) => ({ value })) } : {}), categoryIds } } as unknown as Person);
const LIVE = ["c-family", "c-bridge", "c-work"];
const ME = ["dave@example.test"];

describe("groupBadges", () => {
  it("one saved contact with areas: the first live area, and how many more", () => {
    const m = groupBadges([person("maya", "Maya@Example.test", ["gone", "c-family", "c-bridge", "c-work"])], LIVE, ME);
    expect(m.get("maya@example.test")).toEqual({ category: "c-family", more: 2 });
  });
  it("no areas, a shared address, the person's own mailbox, or an unreadable store: no badge", () => {
    expect(groupBadges([person("sam", "sam@x.test", [])], LIVE, ME).size).toBe(0);
    expect(groupBadges([person("a", "twin@x.test", ["c-work"]), person("b", "twin@x.test", ["c-family"])], LIVE, ME).size).toBe(0);
    expect(groupBadges([person("me", "dave@example.test", ["c-work"])], LIVE, ME).size).toBe(0);
    expect(groupBadges(null, LIVE, ME).size).toBe(0);
  });
  it("dots and plus tags are never stripped: a near address is a different sender", () => {
    const m = groupBadges([person("maya", "maya@example.test", ["c-family"])], LIVE, ME);
    expect(m.get("ma.ya@example.test")).toBeUndefined();
    expect(m.get("maya+news@example.test")).toBeUndefined();
  });
});

describe("the row", () => {
  beforeEach(() => setCategoryRegistry([{ id: "c-family", name: "Family", color: "green" }, { id: "c-bridge", name: "Bridge", color: "blue" }]));
  afterEach(() => { cleanup(); setCategoryRegistry([]); });
  const row: InboxRow = {
    id: "r1", account_id: "a", account: "dave@example.test", provider_id: "p", thread_id: "t", internal_date: "2026-11-03T12:00:00Z",
    from_address: "maya@example.test", from_name: "Maya C.", subject: "Lunch on Friday", snippet: "Thanks for the update", has_body: true,
    attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "s", read: true,
  } as InboxRow;
  const draw = (group?: { category: string; more: number }) =>
    render(<MailRow row={row} accountLabel="" now={new Date("2026-11-03T15:00:00Z")} onOpen={() => {}} group={group} />);

  it("leads the third line with the area's chip, then +N, then the grey words", () => {
    const { container } = draw({ category: "c-family", more: 2 });
    const line = container.querySelector(".mline3")!;
    expect(line.firstElementChild).toHaveClass("mgroup");
    expect(line.querySelector(".mgroup .cat-chip")).toHaveTextContent("Family");
    expect(line.querySelector(".mgroup-more")).toHaveTextContent("+2");
    expect(line.querySelector(".msnip")).toHaveTextContent("Thanks for the update");
  });
  it("one area: no +0; no badge: nothing drawn", () => {
    const one = draw({ category: "c-family", more: 0 });
    expect(one.container.querySelector(".mgroup-more")).toBeNull();
    cleanup();
    const none = draw();
    expect(none.container.querySelector(".mgroup")).toBeNull();
  });
});
