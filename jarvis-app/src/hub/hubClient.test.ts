import { describe, it, expect } from "vitest";
import { addManualAssistant, conflictsOf, destinationKindOf, keepExploration, openJob, proposalSegment, saveDecision, setMode, withdrawDecision, type HubProposal, type RpcClient } from "./hubClient";
import { failure } from "../substrate/commands/errors";

const at = <T,>(xs: T[], i: number): T => { const x = xs[i]; if (x === undefined) throw new Error(`no item ${i}`); return x; };

function recorder(data: unknown = {}): { client: RpcClient; calls: Array<{ fn: string; args: Record<string, unknown> | undefined }> } {
  const calls: Array<{ fn: string; args: Record<string, unknown> | undefined }> = [];
  return { calls, client: { rpc: async (fn: string, args?: Record<string, unknown>) => { calls.push({ fn, args }); return { data, error: null }; } } };
}

const proposal = (over: Partial<HubProposal>): HubProposal => ({
  id: "p1", job_id: "j1", project_id: "proj", agent_id: "c1", agent_name: "Claude", type: "decision", payload: { statement: "Fly on the 12th" },
  evidence_refs: [], created_by: "agent", origin_taint: "untrusted_suggestion", revision: 1, created_at: "2026-10-03T11:00:00Z", ...over,
});

describe("where a proposal sits", () => {
  it("the person's move wins over the agent's classification", () => {
    expect(proposalSegment(proposal({ payload: { classification: "decided", segment: "mentioned" } }))).toBe("mentioned");
    expect(proposalSegment(proposal({ payload: { classification: "mentioned" } }))).toBe("mentioned");
  });
  it("an agent's decision starts in Decided; a pasted conversation starts in Mentioned; a dependency suggestion is Decided", () => {
    expect(proposalSegment(proposal({}))).toBe("decided");
    expect(proposalSegment(proposal({ created_by: "import", agent_id: null, agent_name: null, payload: { statement: "x" } }))).toBe("mentioned");
    expect(proposalSegment(proposal({ type: "constraint_change", created_by: "system", payload: {} }))).toBe("decided");
  });
});

describe("the calls", () => {
  it("saveDecision sends every field the function takes, with the proposal and its revision", async () => {
    const { client, calls } = recorder({ action_id: "a", state: "confirmed", destination_id: "d", version_id: "v", version: 1 });
    await saveDecision(client, {
      projectId: "proj", title: "Flights", statement: "Fly on the 12th", rationale: "Cheaper", alternatives: ["Fly on the 10th"],
      constraints: [{ key: "depart", value: "2026-07-12" }], dependencies: [{ item_id: "t1", kind: "depends_on" }], evidence: ["e1"],
      source: { kind: "chat", at: "2026-10-03T11:00:00Z" }, proposalId: "p1", proposalRevision: 2,
    }, "req-1");
    expect(at(calls, 0)).toEqual({ fn: "decision_save", args: {
      p_project: "proj", p_title: "Flights", p_statement: "Fly on the 12th", p_rationale: "Cheaper", p_alternatives: ["Fly on the 10th"],
      p_constraints: [{ key: "depart", value: "2026-07-12" }], p_dependencies: [{ item_id: "t1", kind: "depends_on" }], p_evidence: ["e1"],
      p_source: { kind: "chat", at: "2026-10-03T11:00:00Z" }, p_proposal: "p1", p_expected_proposal_revision: 2, p_replace_item: null, p_client_request_id: "req-1",
    } });
  });
  it("a replace names the item it supersedes", async () => {
    const { client, calls } = recorder({});
    await saveDecision(client, { projectId: "proj", title: "T", statement: "S", rationale: "R", replaceItemId: "d1" }, "req-2");
    expect(at(calls, 0).args).toMatchObject({ p_replace_item: "d1", p_proposal: null, p_alternatives: [], p_dependencies: [] });
  });
  it("the conflicts a refused save named come back as a list, and nothing else does", () => {
    expect(conflictsOf(failure("DESTINATION_CHANGED", { conflicts: [{ item_id: "d1", version_id: "v1", title: "Trip Budget", statement: "x", key: "k", theirs: "1", mine: "2" }] }, "conflict"))).toHaveLength(1);
    expect(conflictsOf(failure("DESTINATION_CHANGED", {}, "item"))).toEqual([]);
    expect(conflictsOf(failure("SOURCE_CHANGED", { conflicts: [{}] }))).toEqual([]);
    expect(conflictsOf({ ok: true, value: {} })).toEqual([]);
  });
  it("withdraw carries the version, the item's revision and the reason", async () => {
    const { client, calls } = recorder({});
    await withdrawDecision(client, "v1", "2026-10-02T09:00:00.000Z", "Plans changed", "req-3");
    expect(at(calls, 0)).toEqual({ fn: "decision_withdraw", args: { p_version: "v1", p_expected_revision: "2026-10-02T09:00:00.000Z", p_reason: "Plans changed", p_client_request_id: "req-3" } });
  });
  it("keep as note, set mode, add assistant and open job name their function and nothing more", async () => {
    const { client, calls } = recorder({});
    await keepExploration(client, "proj", "Explore a second team", ["e1"], "p1", "req-4");
    await setMode(client, { id: "c1", revision: 3 }, "read_only");
    await addManualAssistant(client, "ChatGPT");
    await openJob(client, null, "proj", "Export");
    expect(calls.map((c) => c.fn)).toEqual(["exploration_keep", "connection_set_mode", "connection_add_manual", "job_open"]);
    expect(at(calls, 0).args).toEqual({ p_project: "proj", p_text: "Explore a second team", p_evidence: ["e1"], p_proposal: "p1", p_client_request_id: "req-4" });
    expect(at(calls, 1).args).toEqual({ p_connection: "c1", p_expected_revision: 3, p_mode: "read_only" });
    expect(at(calls, 3).args).toEqual({ p_agent: null, p_project: "proj", p_purpose: "Export" });
  });
  it("a receipt's destination is its owning module, by the action's kind", () => {
    expect(destinationKindOf("capture_bill")).toBe("money");
    expect(destinationKindOf("capture_receipt")).toBe("money");
    // 2026-10-04: a kept exploration is not a Notes-module note, so it must not
    // be sent to the Notes tab (getNote refuses it and the editor drew empty).
    expect(destinationKindOf("exploration_keep")).toBe("exploration");
    expect(destinationKindOf("exploration_keep")).not.toBe("note");
    expect(destinationKindOf("capture_task")).toBe("task");
    expect(destinationKindOf("capture_event")).toBe("event");
    expect(destinationKindOf("decision_save")).toBe("decision");
    expect(destinationKindOf("read_context")).toBeNull();
  });
});
