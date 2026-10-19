// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { recentPicks, notePick } from "./recentPicks";

// WHAT YOU PICKED LAST COMES FIRST (research standard, rule 11, 2026-10-19).
beforeEach(() => localStorage.clear());

describe("recentPicks", () => {
  it("remembers newest first, moves a repeat to the front, and keeps five", () => {
    expect(recentPicks("project")).toEqual([]);
    for (const id of ["a", "b", "c", "d", "e", "f"]) notePick("project", id);
    expect(recentPicks("project")).toEqual(["f", "e", "d", "c", "b"]);
    notePick("project", "c");
    expect(recentPicks("project")).toEqual(["c", "f", "e", "d", "b"]);
  });
  it("keeps each kind apart, ignores a blank, and survives a damaged store", () => {
    notePick("project", "p1");
    notePick("goal", "g1");
    notePick("project", "");
    expect(recentPicks("project")).toEqual(["p1"]);
    expect(recentPicks("goal")).toEqual(["g1"]);
    localStorage.setItem("jarvis.recents.project.v1", "{not json");
    expect(recentPicks("project")).toEqual([]);
    localStorage.setItem("jarvis.recents.project.v1", JSON.stringify({ not: "a list" }));
    expect(recentPicks("project")).toEqual([]);
  });
});
