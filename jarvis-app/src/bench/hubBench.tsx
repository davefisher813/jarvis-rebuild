import { createRoot } from "react-dom/client";
import HubFlow from "../hub/HubFlow";
import { NotesProvider } from "../data/NotesProvider";
import type { HubOverview, RpcClient } from "../hub/hubClient";
import type { ReceiptDetail as Detail, FeedRow } from "../substrate/commands/receipts";
import "../styles/jarvis-design-system.css";
import "../styles/uniformity.css";
import "../styles/components.css";
import "../styles/ruled.css";
import "../styles/hub.css";

// Hub bench (scratch, deleted before commit): the real HubFlow through the real stylesheets with a fake RPC client.
const NOW = new Date().toISOString();

const overview: HubOverview = {
  ai: "ok",
  connections: [
    { id: "c1", display_name: "Claude", provider_key: "claude", status: "connected", transport: "https", mode: "help_me", verified_capabilities: [], revision: 3, last_used_at: NOW, revoked_at: null, created_at: NOW, open_grants: 2,
      grants: [
        { grant_id: "g1", project_id: "p1", project_title: "Summer Travel", fields: ["title", "due_date"], expires_at: NOW, record_count: 3 },
        { grant_id: "g2", project_id: "p1", project_title: "Summer Travel", fields: [], expires_at: null, record_count: 1 },
      ], project_id: "p1", project_title: "Summer Travel" },
    { id: "c2", display_name: "ChatGPT", provider_key: "manual", status: "manual", transport: "manual", mode: "read_only", verified_capabilities: [], revision: 1, last_used_at: null, revoked_at: null, created_at: NOW, open_grants: 0, grants: [], project_id: null, project_title: null },
    { id: "c3", display_name: "Gemini", provider_key: "manual", status: "expired", transport: "manual", mode: "just_handle_it", verified_capabilities: [], revision: 1, last_used_at: null, revoked_at: null, created_at: NOW, open_grants: 0, grants: [], project_id: "p1", project_title: "Summer Travel" },
    { id: "c4", display_name: "Old Helper", provider_key: "manual", status: "revoked", transport: "manual", mode: "read_only", verified_capabilities: [], revision: 2, last_used_at: null, revoked_at: NOW, created_at: NOW, open_grants: 0, grants: [], project_id: null, project_title: null },
  ],
  projects: [{ id: "p1", title: "Summer Travel", status: "active" }],
  proposals: [
    { id: "pr1", job_id: "j1", project_id: "p1", agent_id: "c1", agent_name: "Claude", type: "decision", payload: { statement: "Fly on the 12th", rationale: "Cheaper, and the roster is final by then", classification: "decided" }, evidence_refs: ["e1", "e2"], created_by: "agent", origin_taint: "untrusted_suggestion", revision: 1, created_at: NOW },
    { id: "pr2", job_id: "j1", project_id: "p1", agent_id: null, agent_name: null, type: "decision", payload: { statement: "Explore a second summer team", rationale: "", classification: "mentioned" }, evidence_refs: [], created_by: "import", origin_taint: "untrusted_suggestion", revision: 1, created_at: NOW },
    { id: "pr3", job_id: "j1", project_id: "p1", agent_id: null, agent_name: null, type: "constraint_change", payload: { decision_item_id: "d1", item_title: "Flights", change: "changed", decision_title: "Trip Budget" }, evidence_refs: [], created_by: "system", origin_taint: "untrusted_suggestion", revision: 1, created_at: NOW },
    { id: "pr4", job_id: "j1", project_id: "p1", agent_id: null, agent_name: null, type: "constraint_change", payload: { decision_item_id: "d1", item_title: "Hotel", change: "missing" }, evidence_refs: [], created_by: "system", origin_taint: "untrusted_suggestion", revision: 1, created_at: NOW },
  ],
  decisions: [
    { item_id: "d1", version_id: "v2", version: 2, title: "Trip Budget", statement: "Cap the trip at $2,400", rationale: "That is what is saved", status: "active", committed_at: NOW, project_id: "p1", item_updated_at: NOW, needs_review: true },
    { item_id: "d2", version_id: "v9", version: 1, title: "Team Size", statement: "Twelve players", rationale: "Fits the vans", status: "active", committed_at: NOW, project_id: "p1", item_updated_at: NOW, needs_review: false },
  ],
  email_review_count: 5,
  exploration_notes: [{ id: "n1", text: "A second team", project_id: "p1", created_at: NOW }, { id: "n2", text: "Night tournaments", project_id: "p1", created_at: null }],
};

const row = (id: string, over: Partial<FeedRow>): FeedRow => ({ receipt_id: "r" + id, action_id: "act" + id, sequence: 1, state: "confirmed", exact_verb: "Saved Bill to Money", occurred_at: NOW, actor_kind: "rule", actor_display: "Rule", assurance: "verified_jarvis", error_code: null, erased: false, reversal_action_id: null, kind: "capture_bill", surface: "email", destination_id: "item1", undoable: true, ...over });
const feed: FeedRow[] = [
  row("1", {}),
  row("2", { exact_verb: "Read 3 Records in Summer Travel", kind: "read_context", actor_kind: "agent", actor_display: "Claude", destination_id: null, undoable: false, assurance: "reported_external" }),
  row("3", { exact_verb: "Sent a Reply", state: "failed", kind: "send", actor_display: "You", actor_kind: "user" }),
];

const detail: Detail = {
  action_id: "act1", kind: "capture_bill", surface: "email", state: "confirmed", verb: "Saved $142.30 Bill to Money", actor_kind: "agent", actor_id: null, actor_display: "Claude", approved_by_user: true,
  destination_id: "item1", provider_account_id: null, created_at: NOW, updated_at: NOW, error_code: null, inside_email: false, undoable: true, item_updated_at: NOW,
  outbox: { state: "failed", attempt: 3, error_code: null, dispatched_at: null, provider_ack: { id: "18c3a" } },
  receipts: [
    { receipt_id: "r1", sequence: 1, state: "proposed", exact_verb: "Suggested a Bill", occurred_at: NOW, actor_kind: "agent", actor_id: null, actor_display: "Claude", scope_summary: "Con Edison · $142.30 · Due Oct 15", before_ref: null, after_ref: null, diff: [{ field: "issuer", before: null, after: "Con Edison" }], evidence_refs: ["ev1"], provider_ack: null, error_code: null, reversal_action_id: null, assurance: "verified_jarvis", erased_at: null },
    { receipt_id: "r2", sequence: 2, state: "failed", exact_verb: "Saved Bill to Money", occurred_at: NOW, actor_kind: "agent", actor_id: null, actor_display: "Claude", scope_summary: "", before_ref: null, after_ref: "item1", diff: [], evidence_refs: [], provider_ack: null, error_code: "OFFLINE", reversal_action_id: null, assurance: "verified_jarvis", erased_at: null },
    { receipt_id: "r3", sequence: 3, state: "confirmed", exact_verb: "Saved Bill to Money", occurred_at: NOW, actor_kind: "agent", actor_id: null, actor_display: "Claude", scope_summary: "", before_ref: null, after_ref: "item1", diff: [], evidence_refs: [], provider_ack: null, error_code: null, reversal_action_id: null, assurance: "verified_jarvis", erased_at: null },
  ],
  evidence: [
    { id: "ev1", type: "email", message_id: "m1", provider_message_id: "p1", thread_id: "t1", excerpt: "Amount due $142.30 by Oct 15", captured_at: NOW, availability: "deleted" },
    { id: "ev2", type: "import", message_id: null, provider_message_id: null, thread_id: null, excerpt: "From a paste", captured_at: NOW, availability: "available" },
  ] as Detail["evidence"],
};

const history = {
  item_id: "d1", item_updated_at: NOW, data: { decision: "Cap the trip at $2,400", links: [{ type: "project", id: "p1", label: "Summer Travel" }], source: { kind: "chat", at: NOW } },
  versions: [
    { version_id: "v2", version: 2, title: "Trip Budget", statement: "Cap the trip at $2,400", rationale: "That is what is saved", alternatives: ["Fly Business"], constraints: [{ key: "trip_budget_usd", value: "2400" }], evidence_refs: [], status: "active", committed_at: NOW, withdrawal_reason: null, supersedes_version_id: "v1",
      dependencies: [
        { id: "dp1", item_id: "x1", kind: "depends_on", status: "current", title: "Book Flights", entity_type: "task" },
        { id: "dp2", item_id: "x2", kind: "depends_on", status: "changed", title: "Hotel Hold", entity_type: "decision_record" },
        { id: "dp3", item_id: "x3", kind: "depends_on", status: "missing", title: "", entity_type: null },
      ] },
    { version_id: "v1", version: 1, title: "Trip Budget", statement: "Cap at $2,000", rationale: "First guess", alternatives: [], constraints: [], evidence_refs: [], status: "superseded", committed_at: NOW, withdrawal_reason: "Plans changed", supersedes_version_id: null, dependencies: [] },
  ],
  evidence: [{ id: "ev1", type: "email", excerpt: "Budget is 2400", availability: "deleted" }, { id: "ev2", type: "import", excerpt: "Pasted note", availability: "available" }],
};

type Fn = (args: Record<string, unknown>) => unknown;
function rig(over: Partial<Record<string, Fn>> = {}) {
  const table: Record<string, Fn> = {
    hub_overview: () => overview,
    decision_dependencies_check: () => ({ suggested: 0 }),
    activity_feed: () => ({ rows: feed, email_review_count: 5, scope: "global" }),
    receipt_detail: () => detail,
    decision_history: () => history,
    job_open: () => ({ job_id: "j1", created: true }),
    context_preview: () => ({ manifest: [{ resource_id: "p1", revision: 1, fields: ["title", "due_date"], redactions: [], evidence_refs: [] }], redactions: ["phone_number"], record_count: 3, content_bytes: 2048, omitted_counts: { unauthorized: 2, over_limit: 1 }, manifest_hash: "f".repeat(64), requires_user_grant: true, job_id: "j1", project_id: "p1", purpose: "Help with Summer Travel" }),
    ...over,
  };
  const client: RpcClient = { rpc: async (fn, args) => { const f = table[fn]; return f ? { data: f(args ?? {}), error: null } : { data: null, error: { message: "no such function" } }; } };
  return client;
}


const client = rig();
const theme = new URLSearchParams(location.search).get("theme") ?? "dark";
document.documentElement.setAttribute("data-theme", theme);
createRoot(document.getElementById("root")!).render(
  <NotesProvider userId="hub-bench"><div className="app-scroll" style={{ height: "100dvh", overflow: "auto" }}><HubFlow onBack={() => {}} client={client} onOpenEmail={() => {}} /></div></NotesProvider>,
);
