import { describe, it, expect } from "vitest";
import { authorize, MODE_CEILING, modeSummary, type AgentActor, type Operation } from "./engine";
import { AGENT_MODES } from "../contracts";

const agent = (over: Partial<AgentActor["connection"]> = {}, extra: Partial<AgentActor> = {}): AgentActor => ({
  kind: "agent",
  connection: { status: "connected", verifiedCapabilities: ["read_context", "propose", "write_inert_draft"], mode: "help_me", authEpoch: 1, ...over },
  ...extra,
});
const NOW = "2026-10-03T12:00:00Z";
const ops: Operation[] = ["read_context", "propose", "suggest_candidate", "write_inert_draft", "commit", "send", "apply_local_rule", "expand_scope"];

describe("the permission engine: deny wins at every layer", () => {
  it("S02: read only may read, never propose or draft", () => {
    const ro = agent({ mode: "read_only" });
    expect(authorize({ actor: ro, aiSwitch: "ok", operation: "read_context" })).toEqual({ allow: true });
    expect(authorize({ actor: ro, aiSwitch: "ok", operation: "propose" })).toEqual({ allow: false, code: "MODE_CEILING" });
    expect(authorize({ actor: ro, aiSwitch: "ok", operation: "write_inert_draft" })).toEqual({ allow: false, code: "MODE_CEILING" });
  });
  it("S04: no mode lets an agent commit, send or widen its own scope", () => {
    for (const mode of AGENT_MODES) {
      for (const op of ["commit", "send", "expand_scope"] as const) {
        expect(authorize({ actor: agent({ mode }), aiSwitch: "ok", operation: op })).toEqual({ allow: false, code: "USER_ONLY" });
      }
    }
  });
  it("Just handle it adds only the accepted local rule, which is the rule's to run, not the agent's", () => {
    expect(MODE_CEILING.just_handle_it.apply_local_rule).toBe("accepted_rule_only");
    expect(authorize({ actor: agent({ mode: "just_handle_it" }), aiSwitch: "ok", operation: "apply_local_rule" })).toEqual({ allow: false, code: "MODE_CEILING" });
    expect(authorize({ actor: { kind: "rule", accepted: true }, aiSwitch: "ok", operation: "apply_local_rule" })).toEqual({ allow: true });
    expect(authorize({ actor: { kind: "rule", accepted: false }, aiSwitch: "ok", operation: "apply_local_rule" })).toEqual({ allow: false, code: "SCOPE_DENIED" });
    expect(authorize({ actor: { kind: "rule", accepted: true }, aiSwitch: "ok", operation: "send" })).toEqual({ allow: false, code: "SCOPE_DENIED" });
  });
  it("the switches come first, and the person's own taps do not depend on them", () => {
    expect(authorize({ actor: agent(), aiSwitch: "AI_DISABLED", operation: "read_context" })).toEqual({ allow: false, code: "AI_DISABLED" });
    expect(authorize({ actor: agent(), aiSwitch: "ADMIN_AI_DISABLED", operation: "propose" })).toEqual({ allow: false, code: "ADMIN_AI_DISABLED" });
    for (const op of ops) if (op !== "apply_local_rule") expect(authorize({ actor: { kind: "user" }, aiSwitch: "AI_DISABLED", operation: op })).toEqual({ allow: true });
  });
  it("a capability the server did not verify is refused", () => {
    expect(authorize({ actor: agent({ verifiedCapabilities: ["read_context"] }), aiSwitch: "ok", operation: "propose" })).toEqual({ allow: false, code: "CAPABILITY_UNVERIFIED" });
    expect(authorize({ actor: agent({ verifiedCapabilities: [] }), aiSwitch: "ok", operation: "read_context" })).toEqual({ allow: false, code: "CAPABILITY_UNVERIFIED" });
  });
  it("S07 / S22: a revoked connection, a moved epoch, or an expired package refuses", () => {
    expect(authorize({ actor: agent({ status: "revoked" }), aiSwitch: "ok", operation: "read_context" })).toEqual({ allow: false, code: "CONNECTION_REVOKED" });
    expect(authorize({ actor: agent({ authEpoch: 2 }, { package: { authEpoch: 1, expiresAt: "2026-10-03T13:00:00Z", status: "active" } }), aiSwitch: "ok", operation: "propose", now: NOW })).toEqual({ allow: false, code: "CONNECTION_REVOKED" });
    expect(authorize({ actor: agent({}, { package: { authEpoch: 1, expiresAt: "2026-10-03T11:00:00Z", status: "active" } }), aiSwitch: "ok", operation: "propose", now: NOW })).toEqual({ allow: false, code: "PACKAGE_EXPIRED" });
    expect(authorize({ actor: agent({}, { package: { authEpoch: 1, expiresAt: "2026-10-03T13:00:00Z", status: "revoked" } }), aiSwitch: "ok", operation: "propose", now: NOW })).toEqual({ allow: false, code: "CONNECTION_REVOKED" });
    expect(authorize({ actor: agent({}, { package: { authEpoch: 1, expiresAt: "2026-10-03T13:00:00Z", status: "active" } }), aiSwitch: "ok", operation: "propose", now: NOW })).toEqual({ allow: true });
  });
  it("S05: a read with no grant is denied", () => {
    expect(authorize({ actor: agent({}, { granted: false }), aiSwitch: "ok", operation: "read_context" })).toEqual({ allow: false, code: "SCOPE_DENIED" });
    expect(authorize({ actor: agent({}, { granted: true }), aiSwitch: "ok", operation: "read_context" })).toEqual({ allow: true });
  });
  it("a mode summary names the ceiling, and every mode says saves and sends need a tap", () => {
    for (const mode of AGENT_MODES) expect(modeSummary(mode).at(-1)).toBe("Saves and Sends Still Need Your Tap");
    expect(modeSummary("read_only")).toContain("No Suggestions");
  });
});
