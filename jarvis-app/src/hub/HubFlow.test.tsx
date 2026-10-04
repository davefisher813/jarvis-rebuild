// @vitest-environment jsdom
// THE AI HUB, END TO END AGAINST A FAKE SESSION (IMPLEMENTATION-SPEC.md 09,
// H1 to H7; prompt 04 "Verify before completing"). Every screen renders
// through the real components and the real stylesheets' class names, with
// the database functions replaced by a recorder, so what each tap SENDS is
// what the tests hold: the right function, the right arguments, nothing
// invented. The state matrix (admin off, offline, empty, error) is here too.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import HubFlow, { OFFLINE_LINE } from "./HubFlow";
import { NotesProvider } from "../data/NotesProvider";
import type { HubOverview, RpcClient } from "./hubClient";
import { setAdminAiBlocked } from "../ai/levelStore";
import { subscribeToast, resetToasts } from "../shared/toast";
import type { ReceiptDetail as Detail, FeedRow } from "../substrate/commands/receipts";

const NOW = new Date().toISOString();

const overview: HubOverview = {
  ai: "ok",
  connections: [{
    id: "c1", display_name: "Claude", provider_key: "claude", status: "connected", transport: "https", mode: "help_me",
    verified_capabilities: ["read_context", "propose"], revision: 3, last_used_at: null, revoked_at: null, created_at: "2026-10-03T10:00:00Z",
    open_grants: 1, grants: [{ grant_id: "g1", project_id: "p1", project_title: "Summer Travel", fields: ["title", "status"], expires_at: "2026-10-03T12:15:00Z", record_count: 3 }],
    project_id: "p1", project_title: "Summer Travel",
  }],
  projects: [{ id: "p1", title: "Summer Travel", status: "active" }],
  proposals: [
    { id: "pr1", job_id: "j1", project_id: "p1", agent_id: "c1", agent_name: "Claude", type: "decision", payload: { statement: "Fly on the 12th", rationale: "Cheaper, and the roster is final by then", classification: "decided" }, evidence_refs: [], created_by: "agent", origin_taint: "untrusted_suggestion", revision: 1, created_at: NOW },
    { id: "pr2", job_id: "j1", project_id: "p1", agent_id: null, agent_name: null, type: "decision", payload: { statement: "Explore a second summer team", rationale: "", classification: "mentioned" }, evidence_refs: [], created_by: "import", origin_taint: "untrusted_suggestion", revision: 1, created_at: NOW },
  ],
  decisions: [{ item_id: "d1", version_id: "v1", version: 1, title: "Trip Budget", statement: "Cap the trip at $2,400", rationale: "That is what is saved", status: "active", committed_at: "2026-10-02T09:00:00Z", project_id: "p1", item_updated_at: "2026-10-02T09:00:00.000000+00:00", needs_review: false }],
  email_review_count: 2,
  exploration_notes: [],
};

const feed: FeedRow[] = [
  { receipt_id: "r1", action_id: "act1", sequence: 1, state: "confirmed", exact_verb: "Saved $142.30 Bill to Money", occurred_at: NOW, actor_kind: "rule", actor_display: "Rule", assurance: "verified_jarvis", error_code: null, erased: false, reversal_action_id: null, kind: "capture_bill", surface: "email", destination_id: "item1", undoable: true },
  { receipt_id: "r2", action_id: "act2", sequence: 1, state: "confirmed", exact_verb: "Read 3 Records in Summer Travel", occurred_at: NOW, actor_kind: "agent", actor_display: "Claude", assurance: "verified_jarvis", error_code: null, erased: false, reversal_action_id: null, kind: "read_context", surface: "project", destination_id: null, undoable: false },
];

const detail: Detail = {
  action_id: "act1", kind: "capture_bill", surface: "email", state: "confirmed", verb: "Saved $142.30 Bill to Money", actor_kind: "rule", actor_id: null, actor_display: "Rule", approved_by_user: true,
  destination_id: "item1", provider_account_id: null, created_at: NOW, updated_at: NOW, error_code: null, inside_email: false, undoable: true, item_updated_at: "2026-10-03T12:00:00.123456+00:00", outbox: null,
  receipts: [{ receipt_id: "r1", sequence: 1, state: "confirmed", exact_verb: "Saved $142.30 Bill to Money", occurred_at: NOW, actor_kind: "rule", actor_id: null, actor_display: "Rule", scope_summary: "Con Edison · $142.30 · Due Oct 15", before_ref: null, after_ref: "item1", diff: [{ field: "issuer", before: null, after: "Con Edison" }], evidence_refs: ["ev1"], provider_ack: null, error_code: null, reversal_action_id: null, assurance: "verified_jarvis", erased_at: null }],
  evidence: [{ id: "ev1", type: "email", message_id: "m1", provider_message_id: "p1", thread_id: "t1", excerpt: "Amount due $142.30 by Oct 15", captured_at: NOW, availability: "available" }],
};

const history = {
  item_id: "d1", item_updated_at: "2026-10-02T09:00:00.000000+00:00", data: { decision: "Cap the trip at $2,400", links: [{ type: "project", id: "p1", label: "Summer Travel" }], source: { kind: "manual", at: NOW } },
  versions: [{ version_id: "v1", version: 1, title: "Trip Budget", statement: "Cap the trip at $2,400", rationale: "That is what is saved", alternatives: [], constraints: [{ key: "trip_budget_usd", value: "2400" }], evidence_refs: [], status: "active", committed_at: "2026-10-02T09:00:00Z", withdrawal_reason: null, supersedes_version_id: null, dependencies: [] }],
  evidence: [],
};

type Fn = (args: Record<string, unknown>) => unknown;
function rig(over: Partial<Record<string, Fn>> = {}, ov: HubOverview = overview) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const table: Record<string, Fn> = {
    hub_overview: () => ov,
    decision_dependencies_check: () => ({ suggested: 0 }),
    activity_feed: () => ({ rows: feed, email_review_count: ov.email_review_count, scope: "global" }),
    receipt_detail: () => detail,
    decision_history: () => history,
    decision_save: () => ({ action_id: "a9", state: "confirmed", destination_id: "d9", receipt_id: "r9", safe_message: "Saved Decision · Flights", version_id: "v9", version: 1, superseded_version_id: null }),
    decision_withdraw: () => ({ action_id: "a8", state: "confirmed", destination_id: "d1", safe_message: "Withdrew Decision · Trip Budget" }),
    exploration_keep: () => ({ action_id: "a7", state: "confirmed", destination_id: "n7", safe_message: "Kept as Note · Explore a second summer team" }),
    proposal_classify: (a) => ({ proposal_id: a.p_proposal, revision: 2, segment: a.p_segment }),
    proposal_dismiss: (a) => ({ proposal_id: a.p_proposal, revision: 2, status: "dismissed" }),
    connection_set_mode: (a) => ({ connection_id: a.p_connection, revision: 4, mode: a.p_mode, capabilities: ["read_context"], unavailable: [] }),
    connection_revoke: () => ({ status: "revoked", auth_epoch: 2 }),
    connection_add_manual: () => ({ connection_id: "c2", status: "manual" }),
    action_undo: () => ({ action_id: "u1", state: "confirmed", destination_id: null, receipt_id: "ru", safe_message: "Removed From Money · Con Edison" }),
    receipt_erase: () => ({ action_id: "act1", erased_receipts: 1 }),
    job_open: () => ({ job_id: "j1", created: true }),
    context_preview: () => ({ manifest: [{ resource_id: "p1", revision: 1, fields: ["title", "status"], redactions: [], evidence_refs: [] }], redactions: [], record_count: 3, content_bytes: 2048, omitted_counts: { unauthorized: 0, over_limit: 0 }, manifest_hash: "f".repeat(64), requires_user_grant: true, job_id: "j1", project_id: "p1", purpose: "Help with Summer Travel" }),
    scope_grant_create: () => ({ grant_id: "g2", expires_at: "2026-10-03T12:30:00Z", record_count: 3 }),
    ...over,
  };
  const client: RpcClient = { rpc: async (fn, args) => { calls.push({ fn, args: args ?? {} }); const f = table[fn]; return f ? { data: f(args ?? {}), error: null } : { data: null, error: { message: "no such function" } }; } };
  return { client, calls };
}

const toasts: string[] = [];
let stopToasts = () => {};
beforeEach(() => { toasts.length = 0; stopToasts = subscribeToast((t) => { if (t) toasts.push(t.message); }); });
afterEach(() => { stopToasts(); resetToasts(); setAdminAiBlocked(false); cleanup(); vi.restoreAllMocks(); });

const sheetSave = () => document.querySelector<HTMLButtonElement>(".sheet-bar-save")!;
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

describe("H1 Agents", () => {
  it("three tabs, the AI switch, the brief, the assistant with its mode, project and shares; Add makes a manual assistant", async () => {
    const { client, calls } = rig();
    render(<HubFlow onBack={() => {}} client={client} />);
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Agents", "Review", "Activity"]);
    expect(screen.getByText("Your Context · Your Call")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "AI on or off" })).toBeInTheDocument();
    expect(screen.getByText("Help Me · Summer Travel · 1 Share Open")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(calls.map((c) => c.fn).slice(0, 2)).toEqual(["decision_dependencies_check", "hub_overview"]);
    fireEvent.click(screen.getByText("Add Assistant"));
    fireEvent.change(screen.getByLabelText("Assistant name"), { target: { value: "ChatGPT" } });
    fireEvent.click(sheetSave());
    await waitFor(() => expect(calls.find((c) => c.fn === "connection_add_manual")?.args).toEqual({ p_display_name: "ChatGPT" }));
  });

  it("no assistant: the empty state carries Add Assistant and says JARVIS still works", async () => {
    const { client } = rig({}, { ...overview, connections: [] });
    render(<HubFlow onBack={() => {}} client={client} />);
    expect(await screen.findByText("No Assistant Connected")).toBeInTheDocument();
    expect(screen.getByText("JARVIS Still Works")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Assistant" })).toBeInTheDocument();
  });

  it("admin off: the switch is locked and says so; a tap only says so again", async () => {
    setAdminAiBlocked(true);
    const { client } = rig();
    render(<HubFlow onBack={() => {}} client={client} />);
    expect(await screen.findByText("Turned Off by Admin")).toBeInTheDocument();
    const sw = screen.getByRole("switch", { name: "AI on or off" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    await waitFor(() => expect(toasts).toContain("Turned Off by Admin"));
  });
});

describe("H4 Agent detail and H5 preview", () => {
  it("modes show their exact ceiling; picking one calls connection_set_mode with the revision and makes no grant; Revoke is one tap", async () => {
    const { client, calls } = rig();
    render(<HubFlow onBack={() => {}} client={client} />);
    fireEvent.click(await screen.findByText("Claude"));
    expect(await screen.findByText("Read Only")).toBeInTheDocument();
    expect(screen.getAllByText("Saves and Sends Still Need Your Tap").length).toBeGreaterThanOrEqual(3);
    fireEvent.click(screen.getByRole("radio", { name: /Read Only/ }));
    await waitFor(() => expect(calls.find((c) => c.fn === "connection_set_mode")?.args).toEqual({ p_connection: "c1", p_expected_revision: 3, p_mode: "read_only" }));
    expect(calls.some((c) => c.fn === "scope_grant_create")).toBe(false);
    // The project menu's word and the grant row both name the project.
    expect(screen.getAllByText("Summer Travel").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("3 Records", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Revoke Access" }));
    await waitFor(() => expect(calls.find((c) => c.fn === "connection_revoke")?.args).toEqual({ p_connection: "c1" }));
    expect(toasts).toContain("Revoked Access · Claude");
  });

  it("the preview opens a job for the project, shows the exact manifest, and Share makes the grant by its hash; Cancel shares nothing", async () => {
    const { client, calls } = rig();
    render(<HubFlow onBack={() => {}} client={client} />);
    fireEvent.click(await screen.findByText("Claude"));
    fireEvent.click(await screen.findByRole("button", { name: "Preview Shared Context" }));
    expect(await screen.findByText("3 Records")).toBeInTheDocument();
    expect(calls.find((c) => c.fn === "job_open")?.args).toEqual({ p_agent: "c1", p_project: "p1", p_purpose: "Help with Summer Travel" });
    expect(calls.find((c) => c.fn === "context_preview")?.args).toMatchObject({ p_job: "j1" });
    expect(screen.getByText("status, title")).toBeInTheDocument();
    expect(screen.getByText("Cancel Shares Nothing")).toBeInTheDocument();
    expect(calls.some((c) => c.fn === "scope_grant_create")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Share Once · 15 Minutes" }));
    await waitFor(() => expect(calls.find((c) => c.fn === "scope_grant_create")?.args).toMatchObject({ p_job: "j1", p_manifest_hash: "f".repeat(64), p_duration: "once" }));
  });
});

// Slice 09 QA (2026-10-04): "Export Shared Context" from the Review tab toasted "The request didn't match the
// protocol" every time. The person's own export has a job with no assistant, a grant names an assistant, and the
// fake above grants anything, so no test saw the refusal. This fake refuses the grant the way the database does.
describe("H5 the person's own export", () => {
  it("Paste or Import a Conversation > Export Shared Context makes no grant and issues the package", async () => {
    const issued = { package_id: "pk1", job_id: "j1", project_id: "p1", purpose: "Export Summer Travel", manifest: [], data: {}, expires_at: "2026-10-04T12:15:00Z", package_hash: "f".repeat(64) };
    const { client, calls } = rig({
      scope_grant_create: () => ({ error: "INVALID_PAYLOAD", detail: "a grant names an assistant" }),
      context_issue: () => issued,
    });
    render(<HubFlow onBack={() => {}} client={client} />);
    await screen.findByText("Claude");
    tab("Review");
    fireEvent.click(screen.getByRole("button", { name: "Paste or Import a Conversation" }));
    expect(await screen.findByText("3 Records")).toBeInTheDocument();
    expect(calls.find((c) => c.fn === "job_open")?.args).toEqual({ p_agent: null, p_project: "p1", p_purpose: "Export Summer Travel" });
    fireEvent.click(screen.getByRole("button", { name: "Export Shared Context" }));
    await waitFor(() => expect(calls.some((c) => c.fn === "context_issue")).toBe(true));
    expect(calls.some((c) => c.fn === "scope_grant_create")).toBe(false);
    expect(calls.find((c) => c.fn === "context_issue")?.args).toMatchObject({ p_job: "j1", p_manifest_hash: "f".repeat(64) });
    await waitFor(() => expect(toasts.length).toBeGreaterThan(0));
    expect(toasts).not.toContain("The request didn't match the protocol.");
  });
});

// Slice 09 QA (2026-10-04): context_packages_sweep had no door. It is run by the person's own tap on the Agents tab,
// through the signed-in route, and says what it cleared.
describe("H1 Clear Expired Shares", () => {
  const withFetch = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
    const f = vi.fn(impl);
    vi.stubGlobal("fetch", f);
    return f;
  };
  afterEach(() => { vi.unstubAllGlobals(); });

  it("the row posts to the sweep route with the session and toasts the counts", async () => {
    const f = withFetch(async () => new Response(JSON.stringify({ ok: true, expired: 2, purged: 1 }), { status: 200 }));
    const { client } = rig();
    render(<NotesProvider userId="u1" accessToken="tok-1"><HubFlow onBack={() => {}} client={client} /></NotesProvider>);
    await screen.findByText("Claude");
    fireEvent.click(screen.getByRole("button", { name: "Clear Expired Shares" }));
    await waitFor(() => expect(toasts).toContain("Cleared 2 Expired Shares · Removed 1 Copy"));
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/context\/sweep$/);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
  });

  it("nothing expired says so; a failed route says it could not reach JARVIS", async () => {
    withFetch(async () => new Response(JSON.stringify({ ok: true, expired: 0, purged: 0 }), { status: 200 }));
    const { client } = rig();
    render(<NotesProvider userId="u1" accessToken="tok-1"><HubFlow onBack={() => {}} client={client} /></NotesProvider>);
    await screen.findByText("Claude");
    fireEvent.click(screen.getByRole("button", { name: "Clear Expired Shares" }));
    await waitFor(() => expect(toasts).toContain("Nothing Expired · All Clear"));
    vi.unstubAllGlobals();
    withFetch(async () => new Response(JSON.stringify({ code: "UNAVAILABLE" }), { status: 503 }));
    fireEvent.click(screen.getByRole("button", { name: "Clear Expired Shares" }));
    await waitFor(() => expect(toasts).toContain("Couldn't Reach JARVIS · Try Again"));
  });
});

describe("H2 Review", () => {
  it("a Decided proposal wears Not Saved Yet; Save opens the sheet prefilled and saves with the project, the proposal and its revision", async () => {
    const { client, calls } = rig();
    render(<HubFlow onBack={() => {}} client={client} />);
    await screen.findByText("Claude");
    tab("Review");
    expect(screen.getByText("Save What We Decided")).toBeInTheDocument();
    expect(screen.getByText("Not Saved Yet")).toBeInTheDocument();
    expect(screen.getByText("Fly on the 12th")).toBeInTheDocument();
    expect(screen.getByText(/Suggested by Claude/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Decision" }));
    expect(screen.getByLabelText("Statement")).toHaveValue("Fly on the 12th");
    expect(screen.getByLabelText("Reason")).toHaveValue("Cheaper, and the roster is final by then");
    fireEvent.change(screen.getByLabelText("Decision title"), { target: { value: "Flights" } });
    fireEvent.click(sheetSave());
    await waitFor(() => expect(calls.find((c) => c.fn === "decision_save")).toBeTruthy());
    expect(calls.find((c) => c.fn === "decision_save")?.args).toMatchObject({ p_project: "p1", p_title: "Flights", p_statement: "Fly on the 12th", p_rationale: "Cheaper, and the roster is final by then", p_proposal: "pr1", p_expected_proposal_revision: 1, p_replace_item: null });
    expect(toasts).toContain("Saved Decision · Flights");
  });

  it("a missing reason never reaches the server", async () => {
    const { client, calls } = rig({}, { ...overview, proposals: [{ ...overview.proposals[0]!, payload: { statement: "Fly on the 12th", classification: "decided" } }] });
    render(<HubFlow onBack={() => {}} client={client} />);
    await screen.findByText("Claude");
    tab("Review");
    fireEvent.click(screen.getByRole("button", { name: "Save Decision" }));
    fireEvent.change(screen.getByLabelText("Decision title"), { target: { value: "Flights" } });
    fireEvent.click(sheetSave());
    expect(await screen.findByText("Add the Highlighted Details Before Saving")).toBeInTheDocument();
    expect(calls.some((c) => c.fn === "decision_save")).toBe(false);
  });

  it("a conflict is named with both values side by side; Replace saves with p_replace_item in one call", async () => {
    let n = 0;
    const { client, calls } = rig({
      decision_save: (a) => {
        n++;
        if (n === 1) return { error: "DESTINATION_CHANGED", detail: "conflict", conflicts: [{ item_id: "d1", version_id: "v1", title: "Trip Budget", statement: "Cap the trip at $2,400", key: "trip_budget_usd", theirs: "2400", mine: "3000" }] };
        return { action_id: "a9", state: "confirmed", destination_id: "d1", receipt_id: "r9", safe_message: "Replaced Decision · Trip Budget", version_id: "v2", version: 2, superseded_version_id: "v1", replace: a.p_replace_item };
      },
    });
    render(<HubFlow onBack={() => {}} client={client} />);
    await screen.findByText("Claude");
    tab("Review");
    fireEvent.click(screen.getByRole("button", { name: "Save Decision" }));
    fireEvent.change(screen.getByLabelText("Decision title"), { target: { value: "Trip Budget" } });
    fireEvent.change(screen.getByLabelText("Constraint key"), { target: { value: "trip_budget_usd" } });
    fireEvent.change(screen.getByLabelText("Constraint value"), { target: { value: "3000" } });
    fireEvent.click(sheetSave());
    expect(await screen.findByText("Conflicts With Trip Budget")).toBeInTheDocument();
    expect(screen.getByText("trip_budget_usd · 2400")).toBeInTheDocument();
    expect(screen.getByText("trip_budget_usd · 3000")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Replace Trip Budget With This"));
    await waitFor(() => expect(calls.filter((c) => c.fn === "decision_save")).toHaveLength(2));
    expect(calls.filter((c) => c.fn === "decision_save")[1]?.args).toMatchObject({ p_replace_item: "d1", p_constraints: [{ key: "trip_budget_usd", value: "3000" }] });
  });

  it("Mentioned: Keep as Note makes an exploration note; Move to Decided is a classification, not a decision", async () => {
    const { client, calls } = rig();
    render(<HubFlow onBack={() => {}} client={client} />);
    await screen.findByText("Claude");
    tab("Review");
    tab("Mentioned");
    expect(screen.getByText("Exploration · Not a Commitment")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move to Decided" }));
    await waitFor(() => expect(calls.find((c) => c.fn === "proposal_classify")?.args).toEqual({ p_proposal: "pr2", p_expected_revision: 1, p_segment: "decided" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep as Note" }));
    await waitFor(() => expect(calls.find((c) => c.fn === "exploration_keep")?.args).toMatchObject({ p_project: "p1", p_text: "Explore a second summer team", p_proposal: "pr2" }));
    expect(calls.some((c) => c.fn === "decision_save")).toBe(false);
  });

  it("S16: Email is a generic count and a door, never a candidate's words", async () => {
    const onOpenEmail = vi.fn();
    const { client } = rig();
    render(<HubFlow onBack={() => {}} client={client} onOpenEmail={onOpenEmail} />);
    await screen.findByText("Claude");
    tab("Review");
    fireEvent.click(screen.getByText("2 Email Items to Review"));
    expect(onOpenEmail).toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Con Edison");
  });

  it("empty Review carries its action", async () => {
    const { client } = rig({}, { ...overview, proposals: [], decisions: [] });
    render(<HubFlow onBack={() => {}} client={client} />);
    await screen.findByText("Claude");
    tab("Review");
    expect(screen.getByText("Nothing Waiting for Your Decision")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Paste a Conversation" })).toBeInTheDocument();
  });
});

describe("H6 Decision detail", () => {
  it("shows the active version, its constraint and history; Withdraw sends the reason under the item's revision; Replace is its own verb", async () => {
    const { client, calls } = rig();
    render(<HubFlow onBack={() => {}} client={client} />);
    await screen.findByText("Claude");
    tab("Review");
    fireEvent.click(screen.getByText("Trip Budget"));
    expect(await screen.findByText("Active · Version 1")).toBeInTheDocument();
    expect(screen.getByText("trip_budget_usd")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace With a New Decision" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw Decision" }));
    fireEvent.change(screen.getByLabelText("Reason for withdrawing"), { target: { value: "Plans changed" } });
    fireEvent.click(sheetSave());
    await waitFor(() => expect(calls.find((c) => c.fn === "decision_withdraw")?.args).toMatchObject({ p_version: "v1", p_expected_revision: "2026-10-02T09:00:00.000000+00:00", p_reason: "Plans changed" }));
    expect(toasts).toContain("Withdrew Decision · Trip Budget");
  });
});

describe("H3 Activity and H7 receipt", () => {
  it("dated rows with their exact verbs; Reads keeps only reads; a row opens the receipt and Undo presents the item's revision", async () => {
    const { client, calls } = rig();
    render(<HubFlow onBack={() => {}} client={client} />);
    await screen.findByText("Claude");
    tab("Activity");
    expect(await screen.findByText("Saved $142.30 Bill to Money")).toBeInTheDocument();
    expect(screen.getByText("Read 3 Records in Summer Travel")).toBeInTheDocument();
    tab("Reads");
    expect(screen.queryByText("Saved $142.30 Bill to Money")).not.toBeInTheDocument();
    tab("All");
    fireEvent.click(screen.getByText("Saved $142.30 Bill to Money"));
    expect(await screen.findByText("Suggested by a Rule · Approved by You")).toBeInTheDocument();
    expect(screen.getByText("Amount due $142.30 by Oct 15")).toBeInTheDocument();
    const page = within(document.body);
    fireEvent.click(page.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(calls.find((c) => c.fn === "action_undo")?.args).toMatchObject({ p_action: "act1", p_expected_item_updated_at: "2026-10-03T12:00:00.123456+00:00" }));
    expect(toasts.some((t) => t.startsWith("Undone"))).toBe(true);
  });

  it("Delete Receipt asks first, then erases; Copy Receipt carries no hash", async () => {
    const written: string[] = [];
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (t: string) => { written.push(t); } }, configurable: true });
    const { client, calls } = rig();
    render(<HubFlow onBack={() => {}} client={client} />);
    await screen.findByText("Claude");
    tab("Activity");
    fireEvent.click(await screen.findByText("Saved $142.30 Bill to Money"));
    fireEvent.click(await screen.findByRole("button", { name: "Copy Receipt" }));
    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toContain("Saved $142.30 Bill to Money");
    expect(written[0]).not.toMatch(/payload_hash|idempotency|nonce/);
    fireEvent.click(screen.getByRole("button", { name: "Delete Receipt" }));
    expect(calls.some((c) => c.fn === "receipt_erase")).toBe(false);
    fireEvent.click(sheetSave());
    await waitFor(() => expect(calls.find((c) => c.fn === "receipt_erase")?.args).toEqual({ p_action: "act1" }));
  });

  it("empty Activity carries its action", async () => {
    const { client } = rig({ activity_feed: () => ({ rows: [], email_review_count: 0, scope: "global" }) }, { ...overview, email_review_count: 0 });
    render(<HubFlow onBack={() => {}} client={client} />);
    await screen.findByText("Claude");
    tab("Activity");
    expect(await screen.findByText("Your Actions Will Appear Here")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Review" }));
    expect(screen.getByText("Save What We Decided")).toBeInTheDocument();
  });
});

describe("the states every screen inherits", () => {
  it("an error on first load shows Retry; a retry that answers shows the hub", async () => {
    let n = 0;
    const { client } = rig({ hub_overview: () => { n++; if (n === 1) return { error: "UNAVAILABLE" }; return overview; } });
    render(<HubFlow onBack={() => {}} client={client} />);
    expect(await screen.findByText("Couldn't Reach JARVIS · Try Again")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Claude")).toBeInTheDocument();
  });

  it("offline: the banner shows, saved content stays, and a save is refused with the offline line", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    try {
      const { client, calls } = rig();
      render(<HubFlow onBack={() => {}} client={client} />);
      expect(await screen.findByText(OFFLINE_LINE)).toBeInTheDocument();
      expect(screen.getByText("Claude")).toBeInTheDocument();
      tab("Review");
      fireEvent.click(screen.getByRole("button", { name: "Save Decision" }));
      await waitFor(() => expect(toasts).toContain("Connect to Save · Your Details Are Still Here"));
      expect(calls.some((c) => c.fn === "decision_save")).toBe(false);
    } finally {
      Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    }
  });

  it("no client at all is an honest unavailable, not a blank", async () => {
    render(<HubFlow onBack={() => {}} client={null} />);
    expect(await screen.findByText("Couldn't Reach JARVIS · Try Again")).toBeInTheDocument();
  });
});
