import { describe, it, expect } from "vitest";
import { validate } from "../schema";
import { PARAM_SCHEMAS } from "../gateway/protocol";
import { AGENT_NAMES, agentDisplayName, backendInboxToRecords, batches, TEXT_CAP } from "./envelope";

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
});
