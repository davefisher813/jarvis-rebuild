import { describe, it, expect } from "vitest";
import { validate } from "../schema";
import { PARAM_SCHEMAS } from "../gateway/protocol";
import { AGENT_NAMES, agentDisplayName, backendInboxToRecords, batches, NOTES_CAP, PRIO_CAP, RECORD_ITEM_SCHEMA, TEXT_CAP, validateRecords, type VyznRecord } from "./envelope";

const ID = "inbox_11111111-1111-4111-8111-111111111111";
const task = (over: Record<string, unknown> = {}) => ({
  id: ID, kind: "task", name: "Send the grant letter", text: "Send the grant letter", prio: "High", due: "2026-10-01", status: "Open", done: false,
  source: "agent", consumed: false, createdAt: 1791547200000, family: "bridge", agent: "michael-corleone", notes: "", ...over,
});

describe("backendInboxToRecords", () => {
  it("maps a backend inbox task to one record the schema accepts: text, due, prio folded into notes, the agent's name, createdAt as client_at", () => {
    const { records, refused } = backendInboxToRecords([task()]);
    expect(refused).toEqual([]);
    expect(records).toEqual([{
      source_record_id: ID, revision: 1, kind: "task",
      data: { text: "Send the grant letter", due: "2026-10-01", notes: "Priority High" },
      source: { label: "Added by Michael Corleone" },
      client_at: "2026-10-09T12:00:00.000Z",
    }]);
    expect(validate({ source_app: "backend-inbox", records }, PARAM_SCHEMAS["record.push"])).toEqual({ ok: true });
  });
  it("keeps the agent's notes above the priority line, keeps no due that is not a date, and sends no notes when there is nothing to say", () => {
    const [withNotes] = backendInboxToRecords([task({ notes: "  Ask about the June window  ", due: "next week" })]).records;
    expect(withNotes!.data).toEqual({ text: "Send the grant letter", notes: "Ask about the June window\nPriority High" });
    const [bare] = backendInboxToRecords([task({ prio: null, notes: null, due: null, createdAt: undefined })]).records;
    expect(bare!.data).toEqual({ text: "Send the grant letter" });
    expect(bare!.client_at).toBeUndefined();
  });
  it("names the agent by its roster name, never its slug, and an unknown or retired id reads an Agent", () => {
    expect(Object.keys(AGENT_NAMES)).toHaveLength(8);
    expect(agentDisplayName("paulie-cicero")).toBe("Paulie Cicero");
    expect(agentDisplayName("vito-corleone")).toBe("an Agent");
    expect(agentDisplayName(null)).toBe("an Agent");
    const [r] = backendInboxToRecords([task({ agent: "al-neri" })]).records;
    expect(r!.source!.label).toBe("Added by an Agent");
    expect(JSON.stringify(backendInboxToRecords([task()]))).not.toContain("michael-corleone");
  });
  it("refuses anything that is not an inbox id, and an item with no text, and never sends it", () => {
    const { records, refused } = backendInboxToRecords([task({ id: "task_1" }), task({ id: 42 }), { text: "no id" }, task({ id: ID, text: "   ", name: "" }), task({ id: "inbox_22222222-2222-4222-8222-222222222222" })]);
    expect(refused).toEqual(["task_1", "(no id)", "(no id)", ID]);
    expect(records.map((r) => r.source_record_id)).toEqual(["inbox_22222222-2222-4222-8222-222222222222"]);
    expect(backendInboxToRecords(null)).toEqual({ records: [], refused: [] });
  });
  it("caps the text at 500 characters and chunks a long inbox into batches of fifty", () => {
    const [r] = backendInboxToRecords([task({ text: "x".repeat(900) })]).records;
    expect(r!.data.text).toHaveLength(TEXT_CAP);
    expect(batches(Array.from({ length: 120 }, (_, i) => i)).map((b) => b.length)).toEqual([50, 50, 20]);
    expect(batches([])).toEqual([]);
  });

  // Review findings 2, 3 and 14 (2026-10-10): the mapping refuses what the gateway would refuse, and nothing it
  // maps can throw or outgrow the record cap.
  it("refuses a text that is not a string, and a name that is not one, instead of mapping [object Object]", () => {
    const { records, refused } = backendInboxToRecords([task({ text: { a: 1 } }), task({ text: undefined, name: 42 }), task({ text: undefined, name: "From the name" })]);
    expect(refused).toEqual([ID, ID]);
    expect(records.map((r) => r.data.text)).toEqual(["From the name"]);
    expect(JSON.stringify(records)).not.toContain("[object Object]");
  });
  it("keeps a due only when it names a real calendar day", () => {
    const [bad] = backendInboxToRecords([task({ due: "2026-13-45" })]).records;
    expect(bad!.data).not.toHaveProperty("due");
    const [feb] = backendInboxToRecords([task({ due: "2027-02-29" })]).records;
    expect(feb!.data).not.toHaveProperty("due");
    const [leap] = backendInboxToRecords([task({ due: "2028-02-29" })]).records;
    expect(leap!.data.due).toBe("2028-02-29");
  });
  it("caps notes at 2000 and the priority word at 40 before folding, so a 200 KB note is a record the schema accepts", () => {
    const [r] = backendInboxToRecords([task({ notes: "n".repeat(200_000), prio: "p".repeat(90) })]).records;
    expect(r).toBeDefined();
    const lines = String(r!.data.notes).split("\n");
    expect(lines[0]).toHaveLength(NOTES_CAP);
    expect(lines[1]).toBe("Priority " + "p".repeat(PRIO_CAP));
    expect(validate(r, RECORD_ITEM_SCHEMA)).toEqual({ ok: true });
  });
  it("sends client_at only for a createdAt that is a real moment: 9e15, NaN, a negative and a far future all omit it", () => {
    const now = Date.parse("2026-10-10T12:00:00Z");
    const at = (createdAt: unknown) => backendInboxToRecords([task({ createdAt })], now).records[0]!.client_at;
    expect(at(9e15)).toBeUndefined();
    expect(at(8.64e15)).toBeUndefined();
    expect(at(NaN)).toBeUndefined();
    expect(at(-1)).toBeUndefined();
    expect(at(now + 2 * 86_400_000)).toBeUndefined();
    expect(at("1791547200000")).toBeUndefined();
    expect(at(now + 3600_000)).toBe("2026-10-10T13:00:00.000Z");
    expect(at(0)).toBe("1970-01-01T00:00:00.000Z");
    // The crafted item never throws out of the mapping (RangeError: Invalid time value before this).
    expect(() => backendInboxToRecords([task({ createdAt: 9e15 })])).not.toThrow();
  });
  it("validateRecords moves a record the gateway schema refuses into refused under its id, and keeps the rest", () => {
    const good: VyznRecord = { source_record_id: ID, revision: 1, kind: "task", data: { text: "ok" } };
    const badId: VyznRecord = { source_record_id: "inbox_with spaces", revision: 1, kind: "task", data: { text: "x" } };
    const badAt: VyznRecord = { ...good, source_record_id: "inbox_2", client_at: "+275760-09-13T00:00:00.000Z" };
    const fat: VyznRecord = { ...good, source_record_id: "inbox_3", data: { text: "x", notes: "n".repeat(9000) } };
    expect(validateRecords([badId, good, badAt, fat])).toEqual({ records: [good], refused: ["inbox_with spaces", "inbox_2", "inbox_3"] });
    expect(validateRecords([])).toEqual({ records: [], refused: [] });
  });
});
