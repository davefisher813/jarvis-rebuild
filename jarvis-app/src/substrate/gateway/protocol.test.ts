import { describe, it, expect } from "vitest";
import { AGENT_METHODS, LIMITS, PARAM_SCHEMAS, RECORD_KINDS, VYZN_APPS } from "./protocol";
import { validate } from "../schema";

// THE FEED'S METHOD AND ITS SCHEMA (PHASE0-DESIGN.md section 4, "The gateway method and its PARAM_SCHEMA").
// The schema is the first wall: an unknown property, a kind outside the four, an id with a character the
// key regex refuses, a non integer revision, a data blob over the cap, a client_at that is not a timestamp.
// jarvis_records_ingest asks every question again in SQL (tests/inbox.sh); this is the cheap refusal.

const RECORD = {
  source_record_id: "inbox_11111111-1111-4111-8111-111111111111",
  revision: 1,
  kind: "task",
  data: { text: "Send the grant letter", due: "2026-10-01", notes: "Priority High" },
  source: { label: "Added by Michael Corleone" },
  client_at: "2026-10-09T12:00:00.000Z",
};
const S = PARAM_SCHEMAS["record.push"];
const ok = (params: unknown) => validate(params, S);

describe("the record.push method", () => {
  it("is on the roster with its caps, and the two mirrors name what the database names", () => {
    expect(AGENT_METHODS).toContain("record.push");
    expect(LIMITS.recordsPerPush).toBe(50);
    expect(LIMITS.recordBytes).toBe(8192);
    expect([...VYZN_APPS]).toEqual(["backend-inbox", "bridge", "tucci"]);
    expect([...RECORD_KINDS]).toEqual(["task", "event", "note", "person"]);
  });
  it("accepts the envelope's params, with and without the optional source and client_at", () => {
    expect(ok({ source_app: "backend-inbox", records: [RECORD] })).toEqual({ ok: true });
    const { source: _s, client_at: _c, ...bare } = RECORD;
    expect(ok({ source_app: "bridge", records: [bare] })).toEqual({ ok: true });
    expect(ok({ source_app: "tucci", records: [{ ...RECORD, client_at: "2026-10-09T08:00:00-04:00" }] })).toEqual({ ok: true });
  });
  it("refuses an unknown app, an empty or oversize batch, and an unknown property at either level", () => {
    expect(ok({ source_app: "notion", records: [RECORD] })).toMatchObject({ ok: false, path: "$.source_app" });
    expect(ok({ source_app: "backend-inbox", records: Array.from({ length: 51 }, () => RECORD) })).toMatchObject({ ok: false, path: "$.records" });
    expect(ok({ source_app: "backend-inbox", records: [RECORD], approved: true })).toMatchObject({ ok: false, path: "$.approved" });
    expect(ok({ source_app: "backend-inbox", records: [{ ...RECORD, status: "accepted" }] })).toMatchObject({ ok: false, path: "$.records[0].status" });
    expect(ok({ source_app: "backend-inbox", records: [{ ...RECORD, source: { label: "x", type: "app" } }] })).toMatchObject({ ok: false, path: "$.records[0].source.type" });
  });
  it("refuses a record whose id, revision, kind, data or client_at is outside the contract", () => {
    expect(ok({ source_app: "backend-inbox", records: [{ ...RECORD, source_record_id: "inbox 1" }] })).toMatchObject({ ok: false, path: "$.records[0].source_record_id" });
    expect(ok({ source_app: "backend-inbox", records: [{ ...RECORD, source_record_id: "x".repeat(129) }] })).toMatchObject({ ok: false, path: "$.records[0].source_record_id" });
    expect(ok({ source_app: "backend-inbox", records: [{ ...RECORD, revision: 0 }] })).toMatchObject({ ok: false, path: "$.records[0].revision" });
    expect(ok({ source_app: "backend-inbox", records: [{ ...RECORD, revision: 1.5 }] })).toMatchObject({ ok: false, path: "$.records[0].revision" });
    expect(ok({ source_app: "backend-inbox", records: [{ ...RECORD, revision: "1" }] })).toMatchObject({ ok: false, path: "$.records[0].revision" });
    expect(ok({ source_app: "backend-inbox", records: [{ ...RECORD, kind: "bill" }] })).toMatchObject({ ok: false, path: "$.records[0].kind" });
    expect(ok({ source_app: "backend-inbox", records: [{ ...RECORD, data: { notes: "n".repeat(9000) } }] })).toMatchObject({ ok: false, path: "$.records[0].data" });
    expect(ok({ source_app: "backend-inbox", records: [{ ...RECORD, client_at: "yesterday" }] })).toMatchObject({ ok: false, path: "$.records[0].client_at" });
    expect(ok({ source_app: "backend-inbox", records: [{ ...RECORD, source: { url: "h".repeat(513) } }] })).toMatchObject({ ok: false, path: "$.records[0].source.url" });
  });
});
