import { describe, it, expect } from "vitest";
import { searchPeople } from "./views";
import { namePatterns, mentions, openWith } from "./mentions";
import type { Person } from "./types";

// ONE PERSON, EVERY NAME YOU CALL THEM (People handoff, 2026-09-16: "Mom and
// Linda Fisher are one confirmed identity. Mother belongs to Family context;
// Board secretary belongs to Bridge context").
const linda: Person = {
  id: "p1",
  data: {
    name: "Linda Fisher", group: "contacts",
    aliases: ["Mom"],
    categoryIds: ["family", "bridge"],
    roles: [
      { categoryId: "family", role: "Mother" },
      { categoryId: "bridge", role: "Board secretary" },
    ],
  },
};
const other: Person = { id: "p2", data: { name: "Alberto Martinez", group: "contacts" } };

describe("one identity, several names", () => {
  it("finds her by the name you actually call her", () => {
    expect(searchPeople([linda, other], "Mom").map((p) => p.id)).toEqual(["p1"]);
    expect(searchPeople([linda, other], "linda").map((p) => p.id)).toEqual(["p1"]);
    expect(searchPeople([linda, other], "FISHER").map((p) => p.id)).toEqual(["p1"]);
  });

  it("finds her by a role she holds in one area", () => {
    expect(searchPeople([linda, other], "secretary").map((p) => p.id)).toEqual(["p1"]);
    expect(searchPeople([linda, other], "mother").map((p) => p.id)).toEqual(["p1"]);
  });

  it("does not turn a search into a match on everyone", () => {
    expect(searchPeople([linda, other], "zzz")).toEqual([]);
  });

  // A task written "call Mom" is about Linda Fisher, and the matcher can only
  // know that if it is handed the alias.
  it("reads work written under the alias as being about her", () => {
    expect(mentions("Call Mom about the layout", "Linda Fisher", ["Mom"])).toBe(true);
    // Without the alias it stays what it was: unrecognized, not guessed.
    expect(mentions("Call Mom about the layout", "Linda Fisher")).toBe(false);
  });

  it("puts her aliased work in what is still open with her", () => {
    const items = openWith(
      { id: "p1", name: "Linda Fisher", aliases: ["Mom"] },
      [{ id: "t1", text: "Ask Mom for the Nat killer", done: false, due: null }],
      [],
      "2026-09-16",
    );
    expect(items.map((i) => i.id)).toEqual(["t1"]);
  });

  // THE AMBIGUITY RULE APPLIES TO AN ALIAS TOO. "Art" is a word before it is
  // a person, whichever field it was typed into.
  it("refuses an alias that is an ordinary word, same as it refuses a name", () => {
    expect(namePatterns("Arthur Reed", ["Art"])).toHaveLength(2); // full name + first name
    expect(mentions("Hang the art in the hall", "Arthur Reed", ["Art"])).toBe(false);
    // And a too-short alias gives the matcher nothing to work with.
    expect(mentions("JB said yes", "Jordan Blake", ["JB"])).toBe(false);
  });

  it("matches a possessive, because people write them", () => {
    expect(mentions("Mom's number", "Linda Fisher", ["Mom"])).toBe(true);
  });

  it("changes nothing for a person with no aliases at all", () => {
    expect(namePatterns("Alberto Martinez")).toEqual(namePatterns("Alberto Martinez", []));
    expect(searchPeople([other], "alberto").map((p) => p.id)).toEqual(["p2"]);
  });
});
