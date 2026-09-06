import { describe, it, expect } from "vitest";
import { makePersonIdFor, noPersonId } from "./personFor";
import { openWith } from "../people/mentions";

// UP-MIND-10. A wrong person id on a promise is worse than no person id,
// because everything downstream would then believe it. So the resolver is
// address equality and nothing else.
describe("resolving a sender to a person", () => {
  const people = [
    { id: "p1", email: "Marco@Example.com" },
    { id: "p2", email: "nadia@example.com" },
    { id: "p3" },
  ];

  it("matches an address whatever its casing or padding", () => {
    const f = makePersonIdFor(people);
    expect(f("marco@example.com")).toBe("p1");
    expect(f("  MARCO@EXAMPLE.COM ")).toBe("p1");
  });

  it("never matches on a name, and never guesses", () => {
    const f = makePersonIdFor(people);
    expect(f("Marco")).toBeUndefined();
    expect(f("marco@other.com")).toBeUndefined();
    expect(f("")).toBeUndefined();
    expect(f(undefined)).toBeUndefined();
  });

  it("keeps one id for a duplicated address, so the link cannot flicker", () => {
    const f = makePersonIdFor([{ id: "a", email: "x@y.z" }, { id: "b", email: "x@y.z" }]);
    expect(f("x@y.z")).toBe("a");
  });

  it("resolves nothing with no People service above it", () => {
    expect(noPersonId("marco@example.com")).toBeUndefined();
  });
});

describe("what is still open with someone", () => {
  const today = "2026-08-15";

  it("counts a task linked by id even when the name is one the matcher refuses", () => {
    const items = openWith(
      { name: "Will Grace", id: "p1" },
      [{ id: "t1", text: "Send the roster", personId: "p1" }],
      [],
      today,
    );
    expect(items.map((i) => i.id)).toEqual(["t1"]);
  });

  it("still matches by name for anything written by hand", () => {
    const items = openWith(
      { name: "Marco Silva", id: "p1" },
      [{ id: "t1", text: "Call Marco Silva back" }],
      [],
      today,
    );
    expect(items.map((i) => i.id)).toEqual(["t1"]);
  });

  it("does not claim a task linked to somebody else", () => {
    const items = openWith(
      { name: "Marco Silva", id: "p1" },
      [{ id: "t1", text: "Send the roster", personId: "p9" }],
      [],
      today,
    );
    expect(items).toEqual([]);
  });
});
