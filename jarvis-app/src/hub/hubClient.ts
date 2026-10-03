// THE HUB'S CALLS (IMPLEMENTATION-SPEC.md 06, 09 H1 to H7, 14: getHub,
// setMode, saveDecision, replaceDecision, withdrawDecision, keepExploration).
// Every one is a database function that takes the actor from the session
// (migration 0047); this module only shapes the arguments and the answers.
// The person's context calls (preview, grant, export, import, revoke) are
// in ../substrate/agentClient; receipts in ../substrate/commands/receipts.

import type { AgentMode } from "../substrate/contracts";
import { callCommand, newRequestId, type CommandResult, type RpcClient } from "../substrate/commands/errors";

export type { RpcClient };

export interface HubGrant { grant_id: string; project_id: string | null; project_title: string | null; fields: string[]; expires_at: string | null; record_count: number }

export interface HubConnection {
  id: string;
  display_name: string;
  provider_key: string;
  status: "manual" | "connected" | "revoked" | "expired" | "unavailable";
  transport: "manual" | "https";
  mode: AgentMode;
  verified_capabilities: string[];
  revision: number;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  open_grants: number;
  grants: HubGrant[];
  project_id: string | null;
  project_title: string | null;
}

export type ProposalSegment = "decided" | "mentioned";

export interface HubProposal {
  id: string;
  job_id: string;
  project_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
  type: "decision" | "constraint_change" | "capture";
  payload: Record<string, unknown> | null;
  evidence_refs: string[];
  created_by: "agent" | "import" | "user" | "system";
  origin_taint: "untrusted_suggestion" | "user_entered";
  revision: number;
  created_at: string;
}

export interface HubDecision {
  item_id: string;
  version_id: string;
  version: number;
  title: string;
  statement: string;
  rationale: string;
  status: "active" | "superseded" | "withdrawn";
  committed_at: string;
  project_id: string | null;
  item_updated_at: string;
  needs_review: boolean;
}

export interface HubProject { id: string; title: string; status: string | null }
export interface HubNote { id: string; text: string; project_id: string | null; created_at: string | null }

export interface HubOverview {
  ai: "ok" | "AI_DISABLED" | "ADMIN_AI_DISABLED";
  connections: HubConnection[];
  projects: HubProject[];
  proposals: HubProposal[];
  decisions: HubDecision[];
  email_review_count: number;
  exploration_notes: HubNote[];
}

export function hubOverview(client: RpcClient): Promise<CommandResult<HubOverview>> {
  return callCommand<HubOverview>(client, "hub_overview", {});
}

/** Run by the person opening the Hub: dependencies that changed become suggestions, never rewrites. */
export function checkDependencies(client: RpcClient): Promise<CommandResult<{ suggested: number }>> {
  return callCommand(client, "decision_dependencies_check", {});
}

/** Where a proposal sits. The agent's classification is advisory; the person's move wins; a pasted conversation starts in Mentioned. */
export function proposalSegment(p: HubProposal): ProposalSegment {
  const seg = p.payload?.segment ?? p.payload?.classification;
  if (seg === "decided" || seg === "mentioned") return seg;
  if (p.type === "constraint_change") return "decided";
  return p.created_by === "agent" ? "decided" : "mentioned";
}

export const text = (p: HubProposal, key: string): string => {
  const v = p.payload?.[key];
  return typeof v === "string" ? v : "";
};

export interface DependencyRef { item_id: string; kind: "depends_on" | "blocked_by" | "informed_by" }
export interface Constraint { key: string; value: string }
export interface DecisionSource { kind: "chat" | "note" | "email" | "manual"; entityId?: string; at: string }

export interface DecisionInput {
  projectId: string;
  title: string;
  statement: string;
  rationale: string;
  alternatives?: string[];
  constraints?: Constraint[];
  dependencies?: DependencyRef[];
  evidence?: string[];
  source?: DecisionSource;
  /** The proposal this saves, if any: it closes as accepted and the agent is credited. */
  proposalId?: string;
  proposalRevision?: number;
  /** Replace: the decision item whose active version this supersedes, in the same transaction. */
  replaceItemId?: string;
}

export interface DecisionSaved {
  action_id: string;
  state: string;
  destination_id: string;
  receipt_id: string;
  safe_message: string;
  version_id: string;
  version: number;
  superseded_version_id: string | null;
  replay?: boolean;
}

export interface Conflict { item_id: string; version_id: string; title: string; statement: string; key: string; theirs: string | null; mine: string | null }

export function saveDecision(client: RpcClient, d: DecisionInput, requestId: string = newRequestId()): Promise<CommandResult<DecisionSaved>> {
  return callCommand<DecisionSaved>(client, "decision_save", {
    p_project: d.projectId,
    p_title: d.title,
    p_statement: d.statement,
    p_rationale: d.rationale,
    p_alternatives: d.alternatives ?? [],
    p_constraints: d.constraints ?? [],
    p_dependencies: d.dependencies ?? [],
    p_evidence: d.evidence ?? [],
    p_source: d.source ?? null,
    p_proposal: d.proposalId ?? null,
    p_expected_proposal_revision: d.proposalRevision ?? null,
    p_replace_item: d.replaceItemId ?? null,
    p_client_request_id: requestId,
  });
}

/** The conflicts a refused save named, when it was refused for that. */
export function conflictsOf(r: CommandResult<unknown>): Conflict[] {
  if (r.ok || r.code !== "DESTINATION_CHANGED" || r.detail !== "conflict") return [];
  const c = r.data.conflicts;
  return Array.isArray(c) ? (c as Conflict[]) : [];
}

export function withdrawDecision(client: RpcClient, versionId: string, itemUpdatedAt: string, reason: string, requestId: string = newRequestId()): Promise<CommandResult<{ action_id: string; state: string; destination_id: string; safe_message: string; replay?: boolean }>> {
  return callCommand(client, "decision_withdraw", { p_version: versionId, p_expected_revision: itemUpdatedAt, p_reason: reason, p_client_request_id: requestId });
}

export function keepExploration(client: RpcClient, projectId: string, noteText: string, evidence: string[] = [], proposalId?: string, requestId: string = newRequestId()): Promise<CommandResult<{ action_id: string; state: string; destination_id: string; safe_message: string; replay?: boolean }>> {
  return callCommand(client, "exploration_keep", { p_project: projectId, p_text: noteText, p_evidence: evidence, p_proposal: proposalId ?? null, p_client_request_id: requestId });
}

export function classifyProposal(client: RpcClient, p: Pick<HubProposal, "id" | "revision">, segment: ProposalSegment): Promise<CommandResult<{ proposal_id: string; revision: number; segment: ProposalSegment }>> {
  return callCommand(client, "proposal_classify", { p_proposal: p.id, p_expected_revision: p.revision, p_segment: segment });
}

export function dismissProposal(client: RpcClient, p: Pick<HubProposal, "id" | "revision">): Promise<CommandResult<{ proposal_id: string; revision: number; status: string; replay?: boolean }>> {
  return callCommand(client, "proposal_dismiss", { p_proposal: p.id, p_expected_revision: p.revision });
}

export interface ModeSet { connection_id: string; revision: number; mode: AgentMode; capabilities: string[]; unavailable: Array<{ capability: string; reason: string }> }

export function setMode(client: RpcClient, c: Pick<HubConnection, "id" | "revision">, mode: AgentMode): Promise<CommandResult<ModeSet>> {
  return callCommand<ModeSet>(client, "connection_set_mode", { p_connection: c.id, p_expected_revision: c.revision, p_mode: mode });
}

/** No verified adapter exists for this deployment (REPO-MAP section 4), so Add makes a manual assistant: export and import only. */
export function addManualAssistant(client: RpcClient, name: string): Promise<CommandResult<{ connection_id: string; status: "manual" }>> {
  return callCommand(client, "connection_add_manual", { p_display_name: name });
}

export function openJob(client: RpcClient, agentId: string | null, projectId: string, purpose?: string): Promise<CommandResult<{ job_id: string; created: boolean }>> {
  return callCommand(client, "job_open", { p_agent: agentId, p_project: projectId, p_purpose: purpose ?? null });
}

export interface VersionDependency { id: string; item_id: string; kind: DependencyRef["kind"]; status: "current" | "changed" | "missing"; title: string; entity_type: string | null }

export interface DecisionVersion {
  version_id: string;
  version: number;
  title: string;
  statement: string;
  rationale: string;
  alternatives: string[];
  constraints: Constraint[];
  evidence_refs: string[];
  status: "active" | "superseded" | "withdrawn";
  committed_at: string;
  withdrawal_reason: string | null;
  supersedes_version_id: string | null;
  dependencies: VersionDependency[];
}

export interface DecisionHistory {
  item_id: string;
  item_updated_at: string;
  data: Record<string, unknown>;
  versions: DecisionVersion[];
  evidence: Array<{ id: string; type: string; excerpt: string; captured_at: string; availability: string }>;
}

export function decisionHistory(client: RpcClient, itemId: string): Promise<CommandResult<DecisionHistory>> {
  return callCommand<DecisionHistory>(client, "decision_history", { p_item: itemId });
}

/** The receipt's destination, by the action's kind: the Hub opens the owning module, never a copy. */
export function destinationKindOf(actionKind: string): string | null {
  switch (actionKind) {
    case "capture_bill": case "capture_receipt": return "money";
    case "capture_task": return "task";
    case "capture_event": return "event";
    case "capture_waiting": return "waiting";
    case "decision_save": case "decision_replace": case "decision_withdraw": return "decision";
    case "exploration_keep": return "note";
    default: return null;
  }
}
