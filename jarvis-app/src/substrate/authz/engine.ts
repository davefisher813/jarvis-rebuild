// THE PERMISSION ENGINE, AS A PURE FUNCTION (IMPLEMENTATION-SPEC.md section
// 04). Effective authorization is the intersection of: the actor, the master
// AI switch and the admin switch, an active connection with a current epoch,
// a server-verified capability, an explicit grant, the job, the mode's
// ceiling, and (for anything that writes a life record or sends) a fresh
// per-action approval by a person. Deny wins at every layer.
//
// Two callers, one answer: the gateway asks before it calls a database
// function (which asks again, authoritatively), and the Hub asks so it can
// say exactly what a mode allows instead of guessing from a label.

import type { AgentCapability, AgentMode } from "../contracts";
import type { ErrorCode } from "../gateway/protocol";

export type Operation =
  | "read_context"        // read selected project fields, by explicit grant
  | "propose"             // put a project decision or constraint change forward
  | "suggest_candidate"   // put an Email capture forward (stays in Email)
  | "write_inert_draft"   // a draft that never sends
  | "commit"              // write a life record: user only
  | "send"                // send, reply, forward: user only, exact approval
  | "apply_local_rule"    // tag mail by an accepted local rule
  | "expand_scope";       // widen a grant or alter constraints: user only

export type Ceiling = "allowed" | "denied" | "user_only" | "accepted_rule_only";

/** The table in section 04, verbatim in shape. */
export const MODE_CEILING: Record<AgentMode, Record<Operation, Ceiling>> = {
  read_only: {
    read_context: "allowed", propose: "denied", suggest_candidate: "denied", write_inert_draft: "denied",
    commit: "user_only", send: "user_only", apply_local_rule: "denied", expand_scope: "user_only",
  },
  help_me: {
    read_context: "allowed", propose: "allowed", suggest_candidate: "allowed", write_inert_draft: "allowed",
    commit: "user_only", send: "user_only", apply_local_rule: "denied", expand_scope: "user_only",
  },
  just_handle_it: {
    read_context: "allowed", propose: "allowed", suggest_candidate: "allowed", write_inert_draft: "allowed",
    commit: "user_only", send: "user_only", apply_local_rule: "accepted_rule_only", expand_scope: "user_only",
  },
};

export const CAPABILITY_FOR: Partial<Record<Operation, AgentCapability>> = {
  read_context: "read_context",
  propose: "propose",
  suggest_candidate: "propose",
  write_inert_draft: "write_inert_draft",
};

export type AiSwitch = "ok" | "AI_DISABLED" | "ADMIN_AI_DISABLED";

export interface AgentActor {
  kind: "agent";
  connection: {
    status: "manual" | "connected" | "revoked" | "expired" | "unavailable";
    verifiedCapabilities: readonly AgentCapability[];
    mode: AgentMode;
    authEpoch: number;
  };
  /** The package the request rides on, when it rides on one. */
  package?: { authEpoch: number; expiresAt: string; status: "active" | "revoked" | "expired" };
  /** An explicit grant covers the request (the server checks the hash; the engine only needs the fact). */
  granted?: boolean;
}
export interface RuleActor { kind: "rule"; accepted: boolean }
export interface UserActor { kind: "user" }
export type Actor = AgentActor | RuleActor | UserActor;

export interface AuthzInput {
  actor: Actor;
  aiSwitch: AiSwitch;
  operation: Operation;
  now?: string;
}

export type Verdict = { allow: true } | { allow: false; code: ErrorCode | "USER_ONLY" };

export function authorize(input: AuthzInput): Verdict {
  const { actor, operation } = input;
  // A person's own tap. The master switch does not gate manual work.
  if (actor.kind === "user") {
    return operation === "apply_local_rule" ? { allow: false, code: "USER_ONLY" } : { allow: true };
  }
  if (actor.kind === "rule") {
    if (operation !== "apply_local_rule") return { allow: false, code: "SCOPE_DENIED" };
    return actor.accepted ? { allow: true } : { allow: false, code: "SCOPE_DENIED" };
  }
  // An agent. Every layer below can refuse; the first refusal is the answer.
  if (input.aiSwitch !== "ok") return { allow: false, code: input.aiSwitch };
  const c = actor.connection;
  if (c.status !== "connected") return { allow: false, code: c.status === "revoked" ? "CONNECTION_REVOKED" : "SCOPE_DENIED" };
  if (actor.package) {
    if (actor.package.status !== "active") return { allow: false, code: actor.package.status === "revoked" ? "CONNECTION_REVOKED" : "PACKAGE_EXPIRED" };
    if (input.now && Date.parse(actor.package.expiresAt) <= Date.parse(input.now)) return { allow: false, code: "PACKAGE_EXPIRED" };
    if (actor.package.authEpoch !== c.authEpoch) return { allow: false, code: "CONNECTION_REVOKED" };
  }
  const ceiling = MODE_CEILING[c.mode][operation];
  if (ceiling === "user_only") return { allow: false, code: "USER_ONLY" };
  if (ceiling === "denied" || ceiling === "accepted_rule_only") return { allow: false, code: "MODE_CEILING" };
  const cap = CAPABILITY_FOR[operation];
  if (cap && !c.verifiedCapabilities.includes(cap)) return { allow: false, code: "CAPABILITY_UNVERIFIED" };
  if (operation === "read_context" && actor.granted === false) return { allow: false, code: "SCOPE_DENIED" };
  return { allow: true };
}

/** What a mode allows, as the Agent detail screen states it. Title Case fragments, the house style. */
export function modeSummary(mode: AgentMode): string[] {
  switch (mode) {
    case "read_only":
      return ["Reads Only What You Share", "No Suggestions", "No Drafts", "Saves and Sends Still Need Your Tap"];
    case "help_me":
      return ["Reads Only What You Share", "Suggests Decisions and Email Items", "Writes Drafts That Never Send", "Saves and Sends Still Need Your Tap"];
    case "just_handle_it":
      return ["Everything in Help Me", "Only Remembered Local Organization Runs on Its Own", "Saves and Sends Still Need Your Tap"];
  }
}

/** The line shown when Just handle it is picked (section 04). */
export const JUST_HANDLE_IT_LINE = "Only Remembered Local Organization Runs Automatically · Saves and Sends Still Need Your Tap";
