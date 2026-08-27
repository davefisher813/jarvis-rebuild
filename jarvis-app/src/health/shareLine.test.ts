import { describe, it, expect } from "vitest";
import {
  HEALTH_CATEGORIES, KID_ROOM_CATEGORIES, DEFAULT_GRANTED,
  defaultGrants, isKidRoomId, updateGrant, sharedView, sharedCategoryLabels,
} from "./shareLine";
import type { ConsentGrant } from "./types";

describe("shareLine defaults", () => {
  it("everything is off by default except logistics", () => {
    const g = defaultGrants(1000);
    for (const grant of g) {
      expect(grant.granted).toBe(grant.category === "logistics");
      expect(grant.updatedAt).toBe(1000);
    }
    expect(g.map((x) => x.category).sort()).toEqual([...HEALTH_CATEGORIES].sort());
  });

  it("DEFAULT_GRANTED agrees with defaultGrants for every category", () => {
    for (const c of HEALTH_CATEGORIES) {
      expect(DEFAULT_GRANTED[c]).toBe(c === "logistics");
    }
  });
});

describe("updateGrant: revocable at any time", () => {
  it("turns a category on, stamping the change", () => {
    const g0 = defaultGrants(1000);
    const g1 = updateGrant(g0, "fuel", true, 2000);
    expect(g1.find((x) => x.category === "fuel")).toEqual({ category: "fuel", granted: true, updatedAt: 2000 });
  });

  it("revokes just as easily, with a fresh timestamp", () => {
    const g0 = updateGrant(defaultGrants(1000), "sleep", true, 2000);
    const g1 = updateGrant(g0, "sleep", false, 3000);
    expect(g1.find((x) => x.category === "sleep")).toEqual({ category: "sleep", granted: false, updatedAt: 3000 });
  });

  it("touches only the one category", () => {
    const g0 = defaultGrants(1000);
    const g1 = updateGrant(g0, "body", true, 2000);
    for (const c of HEALTH_CATEGORIES) {
      if (c === "body") continue;
      expect(g1.find((x) => x.category === c)?.updatedAt).toBe(1000);
    }
  });
});

describe("THE KID'S ROOM: a hard floor, not a default", () => {
  it("mind, cycle, and notes are recognized as Kid's Room ids", () => {
    for (const id of KID_ROOM_CATEGORIES) expect(isKidRoomId(id)).toBe(true);
  });

  it("no shareable category id is mistaken for a Kid's Room id", () => {
    for (const c of HEALTH_CATEGORIES) expect(isKidRoomId(c)).toBe(false);
  });

  // The structural claim: sharedView excludes a Kid's Room category even
  // when a grants array (corrupted, hand-edited, or from a future bug)
  // claims it is granted. The exclusion does not come from "no matching
  // grant"; it comes from isKidRoomId() running unconditionally first.
  it("a Kid's Room category never appears in sharedView, even with a forged grant", () => {
    const items = [
      { id: "1", data: { category: "mind" } },
      { id: "2", data: { category: "fuel" } },
    ];
    const forgedGrants = [
      // Not a real ConsentGrant shape (category is outside HealthCategoryId),
      // simulating exactly the corrupted-data case the law test also covers.
      { category: "mind", granted: true, updatedAt: 1 },
      { category: "fuel", granted: true, updatedAt: 1 },
    ] as unknown as ConsentGrant[];
    const visible = sharedView(items, forgedGrants);
    expect(visible.map((i) => i.id)).toEqual(["2"]);
  });

  it("an ungranted, non-Kid's-Room category is also excluded (both gates matter)", () => {
    const items = [{ id: "1", data: { category: "body" } }];
    const visible = sharedView(items, defaultGrants(1000));
    expect(visible).toEqual([]);
  });

  it("a granted, non-Kid's-Room category is visible", () => {
    const items = [{ id: "1", data: { category: "fuel" } }];
    const grants = updateGrant(defaultGrants(1000), "fuel", true, 2000);
    const visible = sharedView(items, grants);
    expect(visible.map((i) => i.id)).toEqual(["1"]);
  });

  it("logistics items are visible by default with no athlete action", () => {
    const items = [{ id: "1", data: { category: "logistics" } }];
    const visible = sharedView(items, defaultGrants(1000));
    expect(visible.map((i) => i.id)).toEqual(["1"]);
  });
});

describe("sharedCategoryLabels", () => {
  it("names nothing when only logistics is on", () => {
    expect(sharedCategoryLabels(defaultGrants(1000))).toEqual([]);
  });

  it("names a category once it is granted", () => {
    const g = updateGrant(defaultGrants(1000), "sleep", true, 2000);
    expect(sharedCategoryLabels(g)).toEqual(["Sleep"]);
  });
});
