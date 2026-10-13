// @vitest-environment jsdom
// THE CONTACT SHEET, AS DRAWN (issue 112, item 14; Email v1 spec 4, AC07, AC08, AC10; the trim decisions and the P0 map).
// The real component through the real markup, for every answer the People store can give: one contact, none, many, the
// person's own mailbox, and a store that could not be read. What it must say, what it must not (no count, no "last sent",
// no "first seen", no notes, no Add to Contacts: those are deferred and drawing them would be a claim the data cannot back),
// and that every control on it is a real one with a name.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import ContactSheet from "./ContactSheet";
import type { Resolved } from "./contactResolve";
import type { InboxRow } from "./emailClient";
import type { Category } from "../categories/types";
import type { Person } from "../people/types";
import { useSheetEscape } from "../shared/useSheetEscape";

afterEach(cleanup);

const NOW = new Date("2026-10-13T15:00:00");
const cat = (id: string, name: string, color: Category["data"]["color"]): Category => ({ id, data: { name, color, order: 0 } });
const AREAS = [cat("c-family", "Family", "green"), cat("c-bridge", "Bridge", "sky")];
const person = (id: string, name: string, categoryIds?: string[]): Person => ({ id, data: { name, group: "contacts", email: "maya@example.test", categoryIds } });
const MAYA = person("p-maya", "Maya Chen", ["c-family", "c-bridge"]);
const row = (id: string, iso: string, o: Partial<InboxRow> = {}): InboxRow => ({
  id: `u-${id}`, account_id: "acct-1", account: "dave@example.test", provider_id: id, thread_id: `t-${id}`, internal_date: iso, from_address: "maya@example.test", from_name: "Maya Chen",
  subject: `Subject ${id}`, snippet: "", has_body: false, attachment_metadata: [], provider_labels: ["INBOX"], source_hash: "sh", read: true, ...o,
});
const RECENT = [row("a", "2026-10-13T09:12:00"), row("b", "2026-10-12T21:05:00", { subject: "   " })];

type Props = Parameters<typeof ContactSheet>[0];
function sheet(resolved: Resolved, o: Partial<Props> = {}) {
  const fns = { onOpenMessage: vi.fn(), onOpenContact: vi.fn(), onClose: vi.fn() };
  render(<ContactSheet target={{ address: "maya@example.test", name: "Maya C." }} resolved={resolved} categories={AREAS} recent={[]} labels={{}} now={NOW} {...fns} {...o} />);
  return fns;
}
const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement;
const words = (el: Element | null) => (el?.textContent ?? "").replace(/\s/g, " ").trim();
const facts = (root: ParentNode) => [...root.querySelectorAll(".fact")].map((f) => words(f));
const buttonWords = () => [...document.body.querySelectorAll("button")].map((b) => words(b));
const SCRIM = () => document.body.querySelector(".sheet-scrim") as HTMLElement;

describe("a saved contact", () => {
  it("is a dialog named for the address, and draws the saved name (not the sender's own), the raw address and the saved groups", () => {
    sheet({ kind: "one", person: MAYA });
    expect(dialog()).toHaveAttribute("aria-label", "Contact maya@example.test");
    const head = dialog().querySelector(".email-head")!;
    expect(words(head.querySelector(".email-from-name"))).toBe("Maya Chen");
    expect(head).not.toHaveTextContent("Maya C.");
    // The raw address stays visible: it is the head's one grey.
    expect(facts(head)).toEqual(["maya@example.test", "Family", "Bridge"]);
    const groups = [...head.querySelectorAll(".fact.cat")];
    expect(groups.map((g) => words(g))).toEqual(["Family", "Bridge"]);
    expect(groups.every((g) => g.querySelector(".cd") !== null)).toBe(true);
    expect(groups[0]!.querySelector(".cd")).toHaveClass("cat-bg-green");
    expect(groups[1]!.querySelector(".cd")).toHaveClass("cat-bg-sky");
    // The circle is the contact badge the row wears (the sender's own hue), with the saved name's initials, and it is not a control.
    const face = head.querySelector(".mav")!;
    expect(face.tagName).toBe("SPAN");
    expect(face.className).toMatch(/\bcat-fg-[a-z]+\b/);
    expect(face).not.toHaveClass("mface");
    expect(words(face)).toBe("MC");
    expect(face).toHaveAttribute("aria-hidden", "true");
    expect(face.querySelector(".munread")).toBeNull();
  });

  it("Open Contact is the one action: it opens that contact once, and closes the sheet", () => {
    const f = sheet({ kind: "one", person: MAYA });
    expect(buttonWords()).toEqual(["Open Contact", "Done"]);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Open Contact" }));
    expect(f.onOpenContact).toHaveBeenCalledTimes(1);
    expect(f.onOpenContact).toHaveBeenCalledWith("p-maya");
    expect(f.onClose).toHaveBeenCalledTimes(1);
  });

  it("with no way into the Contacts module there is no Open Contact: no dead button", () => {
    sheet({ kind: "one", person: MAYA }, { onOpenContact: undefined });
    expect(buttonWords()).toEqual(["Done"]);
  });

  it("a contact with no groups draws no groups line at all, and still shows the address", () => {
    sheet({ kind: "one", person: person("p", "Maya Chen") });
    const head = dialog().querySelector(".email-head")!;
    expect(facts(head)).toEqual(["maya@example.test"]);
    expect(head.querySelectorAll(".conn-meta")).toHaveLength(1);
  });

  it("a saved name that is the address is not said twice", () => {
    sheet({ kind: "one", person: person("p", "maya@example.test") });
    expect(facts(dialog().querySelector(".email-head")!)).toEqual([]);
    expect(words(dialog().querySelector(".email-from-name"))).toBe("maya@example.test");
  });
});

describe("an address that is not in the contacts", () => {
  it("says Not in Contacts as a white fact, shows the sender's own name and the raw address, and offers nothing but Done", () => {
    sheet({ kind: "none" });
    const head = dialog().querySelector(".email-head")!;
    expect(words(head.querySelector(".email-from-name"))).toBe("Maya C.");
    expect(facts(head)).toEqual(["maya@example.test", "Not in Contacts"]);
    const status = [...head.querySelectorAll(".fact")].find((f) => words(f) === "Not in Contacts")!;
    expect(status.tagName).toBe("SPAN");
    expect(status.querySelector("b")).toHaveTextContent("Not in Contacts");
    // The address is the head's one grey; the status is white, so there is exactly one grey run.
    expect([...head.querySelectorAll(".fact")].filter((f) => f.className === "fact" && !f.querySelector("b")).map((f) => words(f))).toEqual(["maya@example.test"]);
    expect(buttonWords()).toEqual(["Done"]);
    expect(words(head.querySelector(".mav"))).toBe("MC");
  });

  it("a sender with no display name is titled by the address, which is not repeated beneath it, and the circle wears its first two letters", () => {
    sheet({ kind: "none" }, { target: { address: "jo.park@example.test", name: "  " } });
    const head = dialog().querySelector(".email-head")!;
    expect(words(head.querySelector(".email-from-name"))).toBe("jo.park@example.test");
    expect(facts(head)).toEqual(["Not in Contacts"]);
    expect(words(head.querySelector(".mav"))).toBe("JO");
  });
});

describe("two contacts that carry the address", () => {
  const TWIN = person("p-twin", "Maya Chen-Ortiz", ["c-bridge"]);

  it("says Choose Contact and lists both, each a door to that contact, with no Open Contact below and no winner above", () => {
    const f = sheet({ kind: "many", people: [MAYA, TWIN] });
    expect(words(dialog().querySelector(".sh2 .t"))).toBe("Choose Contact");
    const rows = [...dialog().querySelectorAll(".list-card-ruled .row")] as HTMLElement[];
    expect(rows.map((r) => words(r.querySelector(".conn-name")))).toEqual(["Maya Chen", "Maya Chen-Ortiz"]);
    expect(facts(rows[0]!)).toEqual(["Family", "Bridge"]);
    expect(facts(rows[1]!)).toEqual(["Bridge"]);
    // Nobody is named in the head: the sender's own name, the address, and no status line.
    const head = dialog().querySelector(".email-head")!;
    expect(words(head.querySelector(".email-from-name"))).toBe("Maya C.");
    expect(facts(head)).toEqual(["maya@example.test"]);
    expect(buttonWords()).toEqual(["Done"]);
    for (const r of rows) { expect(r).toHaveAttribute("role", "button"); expect(r).toHaveAttribute("tabindex", "0"); expect(r.querySelector(".chev")).not.toBeNull(); }
    fireEvent.click(rows[1]!);
    expect(f.onOpenContact).toHaveBeenCalledTimes(1);
    expect(f.onOpenContact).toHaveBeenCalledWith("p-twin");
    expect(f.onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(rows[0]!, { key: "Enter" });
    expect(f.onOpenContact).toHaveBeenLastCalledWith("p-maya");
  });

  it("without a way into Contacts the two are listed but are not doors: no role, no chevron", () => {
    sheet({ kind: "many", people: [MAYA, TWIN] }, { onOpenContact: undefined });
    const rows = [...dialog().querySelectorAll(".list-card-ruled .row")];
    expect(rows).toHaveLength(2);
    for (const r of rows) { expect(r).not.toHaveAttribute("role"); expect(r.querySelector(".chev")).toBeNull(); }
  });
});

describe("the person's own mailbox, and a store that could not be read", () => {
  it("one of the person's own mailboxes says Your Mailbox, and offers no contact", () => {
    sheet({ kind: "own" });
    expect(facts(dialog().querySelector(".email-head")!)).toEqual(["maya@example.test", "Your Mailbox"]);
    expect(buttonWords()).toEqual(["Done"]);
  });

  it("an unreadable People store claims nothing: no Not in Contacts, no groups, no Open Contact, and the rest of the sheet still works", () => {
    sheet({ kind: "unknown" }, { recent: RECENT });
    expect(document.body).not.toHaveTextContent(/Not in Contacts|Your Mailbox|Choose Contact/);
    expect(facts(dialog().querySelector(".email-head")!)).toEqual(["maya@example.test"]);
    expect(dialog().querySelector(".email-head .fact.cat")).toBeNull();
    expect(buttonWords()).toEqual(["Done"]);
    expect(words(dialog().querySelector(".sh2 .t"))).toBe("Recent Mail");
  });
});

describe("Recent Mail", () => {
  it("lists each message as a plain row: its subject, the day and the 12-hour time as facts, a chevron; a subjectless one reads (No Subject)", () => {
    sheet({ kind: "none" }, { recent: RECENT });
    expect(words(dialog().querySelector(".sh2 .t"))).toBe("Recent Mail");
    const rows = [...dialog().querySelectorAll(".list-card-ruled .row")] as HTMLElement[];
    expect(rows.map((r) => words(r.querySelector(".conn-name")))).toEqual(["Subject a", "(No Subject)"]);
    expect(facts(rows[0]!)).toEqual(["Today", "9:12 AM"]);
    expect(facts(rows[1]!)).toEqual(["Yesterday", "9:05 PM"]);
    for (const r of rows) {
      expect(r).toHaveAttribute("role", "button");
      expect(r.querySelector(".chev")).not.toBeNull();
      expect(r.querySelector("button, .pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
      for (const f of r.querySelectorAll(".fact")) expect(f.tagName).toBe("SPAN");
    }
  });

  it("names the mailbox as the row's one grey when more than one is connected, and not otherwise", () => {
    sheet({ kind: "none" }, { recent: RECENT, labels: { "dave@example.test": "dave" } });
    const first = dialog().querySelector(".list-card-ruled .row")!;
    // The mailbox is a small-caps fact, the label the inbox row wears (Waiting draws it the same way), not a second grey.
    expect(facts(first)).toEqual(["Today", "9:12 AM", "Dave"]);
    expect(first.querySelectorAll(".fact.date")).toHaveLength(3);
  });

  it("a tap on a message closes the sheet and hands over exactly that message", () => {
    const f = sheet({ kind: "none" }, { recent: RECENT });
    fireEvent.click(dialog().querySelectorAll(".list-card-ruled .row")[1]!);
    expect(f.onOpenMessage).toHaveBeenCalledTimes(1);
    expect(f.onOpenMessage).toHaveBeenCalledWith(RECENT[1]);
    expect(f.onClose).toHaveBeenCalledTimes(1);
  });

  it("with no mail there is no heading and no card: a row with nothing to say shows nothing", () => {
    sheet({ kind: "none" }, { recent: [] });
    expect(dialog().querySelector(".sh2")).toBeNull();
    expect(dialog().querySelector(".list-card-ruled")).toBeNull();
  });
});

describe("what the sheet does not claim (AC09, the trim decisions): no count, no dates of its own, no notes, no linked records, no Add to Contacts", () => {
  it("across every state, none of the deferred words or a count appears anywhere on it", () => {
    const states: Resolved[] = [{ kind: "one", person: MAYA }, { kind: "none" }, { kind: "many", people: [MAYA, person("p2", "Maya Two")] }, { kind: "own" }, { kind: "unknown" }];
    for (const s of states) {
      sheet(s, { recent: RECENT });
      const text = words(document.body);
      expect(text).not.toMatch(/sent messages|last sent|first seen|synced mail|\bnotes?\b|add to contacts|conversations|linked|waiting|merge|history|interactions?|coverage/i);
      expect(text).not.toMatch(/(^|\s)\d+\s+(messages?|threads?|emails?|times?|replies|sent|received)\b/i);
      expect(buttonWords().join("|")).not.toMatch(/Add|Merge|Create|Save/);
      cleanup();
    }
  });

  it("writes nothing and calls nothing but the handlers it is given on open", () => {
    const f = sheet({ kind: "one", person: MAYA }, { recent: RECENT });
    expect(f.onOpenMessage).not.toHaveBeenCalled();
    expect(f.onOpenContact).not.toHaveBeenCalled();
    expect(f.onClose).not.toHaveBeenCalled();
  });
});

describe("closing", () => {
  it("Done closes it", () => {
    const f = sheet({ kind: "none" });
    fireEvent.click(within(document.body).getByRole("button", { name: "Done" }));
    expect(f.onClose).toHaveBeenCalledTimes(1);
  });

  it("a tap on the scrim closes it; a tap inside the card does not", () => {
    const f = sheet({ kind: "none" }, { recent: RECENT });
    fireEvent.click(dialog());
    fireEvent.click(dialog().querySelector(".email-head")!);
    expect(f.onClose).not.toHaveBeenCalled();
    fireEvent.click(SCRIM());
    expect(f.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Escape", () => {
  // The app mounts one Escape listener (shared/useSheetEscape, in App) that presses a layer's Cancel where it has one: the sheet's Done
  // is `.action-sheet .cancel`, so the keyboard closes this sheet the way it closes every other, with nothing of its own.
  function WithEscape(props: Parameters<typeof ContactSheet>[0]) {
    useSheetEscape();
    return <ContactSheet {...props} />;
  }
  it("a hardware Escape closes it through the sheet's own Done", () => {
    const onClose = vi.fn();
    render(<WithEscape target={{ address: "maya@example.test", name: "Maya C." }} resolved={{ kind: "none" }} categories={AREAS} recent={RECENT} labels={{}} now={NOW} onOpenMessage={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("structure: real controls, with names, none inside another", () => {
  it("is a dialog, every button has a name, and no button sits inside a role=button door", () => {
    sheet({ kind: "many", people: [MAYA, person("p2", "Maya Two")] }, { recent: RECENT });
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    for (const b of document.body.querySelectorAll("button")) expect((b.textContent ?? "").trim() || b.getAttribute("aria-label")).toBeTruthy();
    expect(document.body.querySelectorAll('[role="button"] button, [role="button"] [role="button"]')).toHaveLength(0);
  });
});

describe("the catalog, on the DOM (the shared check over this sheet is in emailCatalog.test.tsx)", () => {
  const states: Array<[string, Resolved]> = [
    ["one contact", { kind: "one", person: MAYA }],
    ["no contact", { kind: "none" }],
    ["two contacts", { kind: "many", people: [MAYA, person("p2", "Maya Two", ["c-bridge"])] }],
    ["own mailbox", { kind: "own" }],
    ["store unreadable", { kind: "unknown" }],
  ];
  for (const [name, resolved] of states) {
    it(`${name}: no separator is baked into a string, facts are spans, no pill in a row, no colour of its own`, () => {
      sheet(resolved, { recent: RECENT, labels: { "dave@example.test": "dave" } });
      expect(document.body.textContent).not.toMatch(/[\u00b7\u2022\u2013\u2014]/);
      for (const f of document.body.querySelectorAll(".fact")) expect(f.tagName).toBe("SPAN");
      for (const r of document.body.querySelectorAll(".row")) expect(r.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
      expect(document.body.querySelector("[style]")).toBeNull();
      expect(document.body.querySelector(".fact.warn, .fact.red, .fact.good")).toBeNull();
    });
  }
});
