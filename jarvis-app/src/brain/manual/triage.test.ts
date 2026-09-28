import { describe, it, expect } from "vitest";
import type { Person } from "../../people/types";
import {
  isUnsorted, brainRolesOf,
  triageSource, personSourceLabel, brainRoleLabel, formatFiledDate,
} from "./triage";

const person = (id: string, name: string, data: Record<string, unknown> = {}): Person =>
  ({ id, data: { name, group: "contacts", ...data } } as Person);

describe("triage helpers", () => {
  it("unsorted only when marked so, or imported before triage existed", () => {
    expect(isUnsorted(person("1", "A", { triageState: "unsorted" }))).toBe(true);
    expect(isUnsorted(person("1", "A", { triageState: "sorted" }))).toBe(false);
    expect(isUnsorted(person("1", "A", { sourceUid: "vcard-1" }))).toBe(true);
    expect(isUnsorted(person("1", "A", { source: "import" }))).toBe(true);
  });

  it("a person added by hand counts as sorted (Dave 2026-09-28)", () => {
    expect(isUnsorted(person("1", "A", {}))).toBe(false);
    expect(isUnsorted(person("1", "A", { source: "manual", triageState: "sorted" }))).toBe(false);
  });

  it("reads only string roles as brain roles", () => {
    const area = { categoryId: "work", role: "Manager" };
    const p = person("1", "A", { roles: [area, "friend"] });
    expect(brainRolesOf(p)).toEqual(["friend"]);
  });

  it("a pre-triage row is an import only when it carries an import id", () => {
    expect(triageSource(person("1", "A", {}))).toBe("manual");
    expect(triageSource(person("1", "A", { sourceUid: "vcard-1" }))).toBe("import");
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
