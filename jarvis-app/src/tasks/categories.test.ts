import { describe, it, expect } from "vitest";
import { categoriesOf, primaryOf, isIn, setCategories, makePrimary, categoryLine } from "./categories";

// The contract that lets 192 single-category readers keep working untouched.
describe("categoriesOf", () => {
  it("returns primary first", () => {
    expect(categoriesOf({ category: "money", extraCategories: ["bridge"] })).toEqual(["money", "bridge"]);
  });
  it("[edge] a single-category task is unchanged", () => {
    expect(categoriesOf({ category: "money" })).toEqual(["money"]);
  });
  it("[edge] an uncategorised task has none", () => {
    expect(categoriesOf({})).toEqual([]);
    expect(categoriesOf({ category: "" })).toEqual([]);
    expect(primaryOf({})).toBe("");
  });
  it("never repeats the primary even if it is also stored as a tag", () => {
    expect(categoriesOf({ category: "money", extraCategories: ["money", "bridge"] })).toEqual(["money", "bridge"]);
  });
  it("[edge] drops blanks and whitespace so a stray save cannot make a ghost category", () => {
    expect(categoriesOf({ category: "money", extraCategories: ["", "  ", "bridge"] })).toEqual(["money", "bridge"]);
  });
});

describe("membership", () => {
  it("a task belongs to every category it carries, in any position", () => {
    const t = { category: "money", extraCategories: ["bridge", "elite"] };
    expect(isIn(t, "money")).toBe(true);
    expect(isIn(t, "elite")).toBe(true);
    expect(isIn(t, "gym")).toBe(false);
  });
  it("[edge] nothing belongs to an empty id", () => {
    expect(isIn({ category: "money" }, "")).toBe(false);
  });
});

describe("setCategories", () => {
  it("the first pick becomes the primary", () => {
    expect(setCategories(["money", "bridge"])).toEqual({ category: "money", extraCategories: ["bridge"] });
  });
  it("a single category writes NO extra field, so the record is unchanged from before", () => {
    expect(setCategories(["money"])).toEqual({ category: "money" });
    expect("extraCategories" in setCategories(["money"])).toBe(false);
  });
  it("[edge] duplicates and blanks collapse", () => {
    expect(setCategories(["money", "money", "", "bridge"])).toEqual({ category: "money", extraCategories: ["bridge"] });
  });
  it("[edge] clearing everything leaves an honest empty primary", () => {
    expect(setCategories([])).toEqual({ category: "" });
  });
});

describe("makePrimary", () => {
  it("promotes a tag and keeps the rest, which is how reordering changes the dot", () => {
    const t = { category: "money", extraCategories: ["bridge", "elite"] };
    expect(makePrimary(t, "bridge")).toEqual({ category: "bridge", extraCategories: ["money", "elite"] });
  });
  it("promoting the current primary changes nothing", () => {
    const t = { category: "money", extraCategories: ["bridge"] };
    expect(makePrimary(t, "money")).toEqual({ category: "money", extraCategories: ["bridge"] });
  });
  it("[edge] promoting a category the task does not have adds it", () => {
    expect(makePrimary({ category: "money" }, "gym")).toEqual({ category: "gym", extraCategories: ["money"] });
  });
});

describe("categoryLine", () => {
  const nameOf = (id: string) => ({ money: "Money", bridge: "Bridge" }[id] ?? "");
  it("reads as a meta line, primary first", () => {
    expect(categoryLine({ category: "money", extraCategories: ["bridge"] }, nameOf)).toBe("Money · Bridge");
  });
  it("[edge] an unknown category contributes nothing rather than an empty dot", () => {
    expect(categoryLine({ category: "money", extraCategories: ["ghost"] }, nameOf)).toBe("Money");
  });
});
