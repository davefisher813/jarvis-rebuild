import { describe, it, expect } from "vitest";
import { exportContext, grantScope, importProposals, previewContext, revokeAgent, type RpcClient } from "./agentClient";

function client(answers: Record<string, unknown>) {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  const c: RpcClient = { rpc: async (fn, args) => { calls.push({ fn, args }); return fn in answers ? { data: answers[fn], error: null } : { data: null, error: { message: "no such function" } }; } };
  return { c, calls };
}
const JOB = "a0000000-0000-0000-0000-00000000000a";

describe("the person's side of scoped context", () => {
  it("preview and grant pass exactly the request through, and read the function's refusal", async () => {
    const { c, calls } = client({ context_preview: { manifest: [], record_count: 1, manifest_hash: "h" }, scope_grant_create: { error: "STALE_SCOPE" } });
    expect(await previewContext(c, JOB, { fields: ["title"] })).toMatchObject({ ok: true, value: { record_count: 1 } });
    expect(calls[0]).toEqual({ fn: "context_preview", args: { p_job: JOB, p_resources: [], p_fields: ["title"], p_purpose: null } });
    expect(await grantScope(c, JOB, "h", "once", { fields: ["title"] })).toEqual({ ok: false, code: "STALE_SCOPE" });
    expect(calls[1]!.args).toMatchObject({ p_manifest_hash: "h", p_duration: "once" });
  });
  it("export issues the package to the person and wraps it as the disclosure file", async () => {
    const { c } = client({ context_issue: { package_id: "p", job_id: JOB, project_id: null, purpose: "x", manifest: [], data: {}, expires_at: "2026-10-03T12:15:00Z", package_hash: "h" } });
    const r = await exportContext(c, JOB, "h", {}, () => "2026-10-03T12:00:00Z");
    expect(r.ok && r.value.fileName).toBe("jarvis-context-2026-10-03.json");
    expect(r.ok && JSON.parse(r.value.text).disclosure).toBe("Imported suggestions are unverified until reviewed.");
  });
  it("import validates before it calls, and nothing is called for an invalid file", async () => {
    const { c, calls } = client({ proposals_import: { count: 1, proposal_ids: ["x"] } });
    expect(await importProposals(c, JOB, '{"app":"jarvis","kind":"context_response","protocol_version":1,"items":[{"statement":"x","execute":true}]}')).toMatchObject({ ok: false, code: "IMPORT_INVALID" });
    expect(calls).toEqual([]);
    const ok = await importProposals(c, JOB, "Maybe fly on the 12th");
    expect(ok).toMatchObject({ ok: true, value: { count: 1, source: "prose" } });
    expect(calls[0]!.args).toMatchObject({ p_source: "prose" });
  });
  it("revoke is one call, and an unknown function reads as unavailable", async () => {
    const { c } = client({ connection_revoke: { status: "revoked", auth_epoch: 2 } });
    expect(await revokeAgent(c, "50000000-0000-0000-0000-00000000000a")).toMatchObject({ ok: true, value: { auth_epoch: 2 } });
    expect(await revokeAgent({ rpc: async () => ({ data: null, error: { code: "PGRST202" } }) }, "x")).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
});
