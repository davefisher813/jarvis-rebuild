import { describe, it, expect } from "vitest";
import { nameBook, nameFor, prettyHandle } from "./names";

const people = [
  { data: { name: "Wei Chen", email: "wei@bffsa.org" } },
  { data: { name: "Nadia Brandt", email: "Nadia.Brandt@ridgeline.k12.us" } },
  { data: { name: "", email: "blank@x.com" } },
  { data: { name: "No Address" } },
];

describe("nameBook", () => {
  it("keys on the lowercased address and skips people with no name", () => {
    const b = nameBook(people);
    expect(b.byEmail["wei@bffsa.org"]).toBe("Wei Chen");
    expect(b.byEmail["nadia.brandt@ridgeline.k12.us"]).toBe("Nadia Brandt");
    expect(b.byEmail["blank@x.com"]).toBeUndefined();
  });

  it("first entry wins so a later duplicate cannot overwrite a known name", () => {
    const b = nameBook([...people, { data: { name: "Someone Else", email: "wei@bffsa.org" } }]);
    expect(b.byEmail["wei@bffsa.org"]).toBe("Wei Chen");
  });
});

describe("prettyHandle", () => {
  it("titlecases a separated localpart, which is words the sender typed", () => {
    expect(prettyHandle("wei.chen")).toBe("Wei Chen");
    expect(prettyHandle("nadia_brandt")).toBe("Nadia Brandt");
    expect(prettyHandle("jean-luc-picard")).toBe("Jean Luc Picard");
  });

  it("titlecases a single alphabetic handle", () => {
    expect(prettyHandle("wei")).toBe("Wei");
    expect(prettyHandle("NADIA")).toBe("Nadia");
  });

  it("titlecases a handle without pretending it is two names", () => {
    // Still reads as the handle. Crucially NOT split into "J Rubino".
    expect(prettyHandle("jrubino")).toBe("Jrubino");
  });

  // The whole point of the file. These must stay exactly as they arrived.
  it("refuses to invent a name out of anything with a digit or a lone letter", () => {
    expect(prettyHandle("dfisher2424")).toBeNull();
    expect(prettyHandle("j.rubino")).toBeNull();     // "J" is an initial, not a name
    expect(prettyHandle("noreply2")).toBeNull();
    expect(prettyHandle("a.b.c.d")).toBeNull();      // four parts is not a name
    expect(prettyHandle("")).toBeNull();
    expect(prettyHandle("wei@bffsa.org")).toBeNull(); // an address is not a handle
  });
});

describe("nameFor", () => {
  const book = nameBook(people);

  it("prefers the name the app already knows", () => {
    expect(nameFor(book, "wei@bffsa.org", "wei")).toBe("Wei Chen");
    expect(nameFor(book, "WEI@BFFSA.ORG", "wei")).toBe("Wei Chen");
  });

  it("falls back to the address localpart when People has never heard of them", () => {
    expect(nameFor(book, "wei.chen@other.com", "wei.chen@other.com")).toBe("Wei Chen");
  });

  it("leaves a handle it cannot read alone rather than guessing", () => {
    expect(nameFor(book, "jrubino@x.com", "dfisher2424")).toBe("dfisher2424");
    expect(nameFor(book, undefined, "j.rubino")).toBe("j.rubino");
  });

  it("never returns worse than what the row already carried", () => {
    expect(nameFor(book, undefined, "Nadia Brandt")).toBe("Nadia Brandt");
    expect(nameFor(book, "unknown@x.com", "Ridgeline HS Athletics")).toBe("Ridgeline HS Athletics");
  });
});

// 2026-08-26, from Dave's Waiting On: '"wei@bffsa.org" · Invoice' and
// '"Joseph T. Pareres" · CALL ME'. Headers quote display names, and when
// the quoted part is all the header gives, the quotes reached the screen.
describe("nameFor strips header quoting", () => {
  const empty = { byEmail: {} };
  it("unwraps a quoted address and still prettifies its localpart", () => {
    expect(nameFor(empty, undefined, '"wei@bffsa.org"')).toBe("Wei");
  });
  it("unwraps a quoted full name", () => {
    expect(nameFor(empty, undefined, '"Joseph T. Pareres"')).toBe("Joseph T. Pareres");
  });
});
