import { describe, it, expect } from "vitest";
import type { Person } from "../../people/types";
import {
  normalizeName, duplicatesOf, mergedNotes, isUnsorted, brainRolesOf,
  triageSource, personSourceLabel, brainRoleLabel, formatFiledDate,
} from "./triage";

const person = (id: string, name: string, data: Record<string, unknown> = {}): Person =>
  ({ id, data: { name, group: "contacts", ...data } } as Person);

describe("triage helpers", () => {
  it("normalizes names for duplicate matching", () => {
    expect(normalizeName("Dave Fisher")).toBe("davefisher");
    expect(normalizeName("  O'Brien-Jr. ")).toBe("obrienjr");
  });

  it("matches duplicates by name or email", () => {
    const a = person("1", "Dave Fisher", { email: "Dave@Bffsa.org" });
    const b = person("2", "dave  fisher");
    const c = person("3", "Someone Else", { email: "dave@bffsa.org" });
    const d = person("4", "Unrelated");
    const all = [a, b, c, d];
    expect(duplicatesOf(a, all).map((p) => p.id).sort()).toEqual(["2", "3"]);
    expect(duplicatesOf(d, all)).toEqual([]);
  });

  it("does not match on empty emails", () => {
    const a = person("1", "One");
    const b = person("2", "Two");
    expect(duplicatesOf(a, [a, b])).toEqual([]);
  });

  it("concatenates notes on merge, keeping both", () => {
    const s = person("1", "A", { notes: "First" });
    const l = person("2", "B", { notes: "Second" });
    expect(mergedNotes(s, l)).toBe("First\n\nSecond");
    expect(mergedNotes(person("1", "A"), l)).toBe("Second");
    expect(mergedNotes(person("1", "A"), person("2", "B"))).toBeUndefined();
  });

  it("treats anything but sorted as unsorted", () => {
    expect(isUnsorted(person("1", "A", {}))).toBe(true);
    expect(isUnsorted(person("1", "A", { triageState: "unsorted" }))).toBe(true);
    expect(isUnsorted(person("1", "A", { triageState: "sorted" }))).toBe(false);
  });

  it("reads only string roles as brain roles", () => {
    const area = { categoryId: "work", role: "Manager" };
    const p = person("1", "A", { roles: [area, "friend"] });
    expect(brainRolesOf(p)).toEqual(["friend"]);
  });

  it("defaults the source to import for pre-triage rows", () => {
    expect(triageSource(person("1", "A", {}))).toBe("import");
    expect(triageSource(person("1", "A", { source: "email" }))).toBe("email");
  });

  it("labels roles and sources in Title Case", () => {
    expect(brainRoleLabel("bridge")).toBe("Bridge");
    expect(personSourceLabel("email")).toBe("Email");
    expect(personSourceLabel("manual")).toBe("Added by You");
  });

  it("formats filed dates like the decision list", () => {
    const thisYear = new Date().getFullYear();
    expect(formatFiledDate(`${thisYear}-03-15T12:00:00.000Z`)).toBe("Mar 15");
    expect(formatFiledDate("2024-11-02T00:00:00.000Z")).toBe("Nov 2, 2024");
    expect(formatFiledDate(undefined)).toBe("");
  });
});
