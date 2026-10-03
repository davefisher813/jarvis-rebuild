import { describe, it, expect } from "vitest";
import { buildExport, parseImport, EXPORT_DISCLOSURE, EXPORT_REVOCATION_NOTE } from "./exportImport";

const PKG = { package_id: "c0000000-0000-0000-0000-00000000000a", job_id: "a0000000-0000-0000-0000-00000000000a", project_id: "10000000-0000-0000-0000-00000000000a", purpose: "Plan the trip", manifest: [{ resource_id: "x", revision: 1, fields: ["title"], redactions: [], evidence_refs: [] }], data: { x: { title: "Summer travel" } }, expires_at: "2026-10-03T12:15:00Z", package_hash: "f".repeat(64) };

describe("manual export", () => {
  it("is a disclosure that says so, carries the manifest, and names its own limits", () => {
    const text = buildExport(PKG, "2026-10-03T12:00:00Z");
    const file = JSON.parse(text) as Record<string, unknown>;
    expect(file).toMatchObject({ app: "jarvis", kind: "context", protocol_version: 1, disclosure: EXPORT_DISCLOSURE, revocation_note: EXPORT_REVOCATION_NOTE, package_hash: PKG.package_hash });
    expect(file.manifest).toEqual(PKG.manifest);
    expect(file.data).toEqual(PKG.data);
    expect(JSON.stringify(file)).not.toMatch(/token|secret|Bearer/i);
  });
});

describe("manual import", () => {
  it("accepts a JSON response and keeps the file's classification as a proposal, never a save", () => {
    const r = parseImport(JSON.stringify({ app: "jarvis", kind: "context_response", protocol_version: 1, items: [{ statement: "Fly on the 12th", rationale: "Cheapest", classification: "decided" }, { type: "constraint_change", statement: "Budget 2400" }] }));
    expect(r).toEqual({ ok: true, source: "json", items: [{ type: "decision", statement: "Fly on the 12th", rationale: "Cheapest", classification: "decided" }, { type: "constraint_change", statement: "Budget 2400", classification: "mentioned" }] });
  });
  it("refuses the whole file for an unknown key, an authority key, a bad shape, or size", () => {
    expect(parseImport(JSON.stringify({ app: "jarvis", kind: "context_response", protocol_version: 1, items: [{ statement: "x", execute: true }] }))).toMatchObject({ ok: false, code: "IMPORT_INVALID" });
    expect(parseImport(JSON.stringify({ app: "jarvis", kind: "context_response", protocol_version: 1, items: [{ statement: "x" }], approved_by: "me" }))).toMatchObject({ ok: false, code: "IMPORT_INVALID" });
    expect(parseImport(JSON.stringify({ app: "jarvis", kind: "context_response", protocol_version: 1, items: [{ statement: "x", colour: "red" }] }))).toMatchObject({ ok: false, code: "IMPORT_INVALID" });
    expect(parseImport(JSON.stringify({ app: "other", items: [] }))).toMatchObject({ ok: false, code: "IMPORT_INVALID" });
    expect(parseImport(JSON.stringify({ app: "jarvis", kind: "context_response", protocol_version: 1, items: [] }))).toMatchObject({ ok: false, code: "IMPORT_INVALID" });
    expect(parseImport("{ not json")).toMatchObject({ ok: false, code: "IMPORT_INVALID" });
    expect(parseImport("x".repeat(300_000))).toMatchObject({ ok: false, code: "IMPORT_INVALID" });
    expect(parseImport("   ")).toMatchObject({ ok: false, code: "IMPORT_INVALID" });
  });
  it("pasted prose becomes Mentioned items, never Decided", () => {
    const r = parseImport("We should fly on the 12th. The hotel is booked.\n- Budget stays at 2400");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("prose");
    expect(r.items.map((i) => i.statement)).toEqual(["We should fly on the 12th.", "The hotel is booked.", "Budget stays at 2400"]);
    expect(r.items.every((i) => i.classification === "mentioned")).toBe(true);
  });
  it("prose has limits too", () => {
    expect(parseImport(Array.from({ length: 101 }, (_, i) => `Line ${i}`).join("\n"))).toMatchObject({ ok: false });
    expect(parseImport("y".repeat(501))).toMatchObject({ ok: false });
  });
});
