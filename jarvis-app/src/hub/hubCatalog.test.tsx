// @vitest-environment jsdom
// THE VISUAL-CATALOG GATE FOR THE AI HUB (Dave, 2026-10-05: "I am sick of this
// shit." A thin grey subtext came back on the Email card; he spent hours
// fixing it once). Every Hub screen is rendered through the real components
// and the real class names, and the STRUCTURAL properties the catalog rules
// name are asserted in the DOM, not in a string:
//
//   R1/R5  a facts or meta line has at most ONE untoned fact (a fact with a key
//          colour, small-caps date or a white number is not the line's grey);
//          a row with nothing to say draws no line at all
//   R3/K.3 at most one key COLOUR per line
//   R6     no middle dot inside a facts or meta line (the CSS draws it)
//   R8     a neutral date or time is .fact.date, and a clock time is 12-hour
//   casing every fact is Title Case (lineCase leaves it unchanged)
//   R7/R9  no private note, brief, head or mode-lines class: a note under a card
//          is .input-hint, a head is .sh2
//
// and the stylesheet that draws them (hub.css) carries no raw colour and no
// quiet class on the wrong ink. Each assertion was proven to bite: the fix it
// pins was undone, the test went red, the fix was put back.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import HubFlow from "./HubFlow";
import ContextPreview from "./ContextPreview";
import { ImportSheet } from "./sheets";
import HubFacts from "./HubFacts";
import type { HubOverview, RpcClient } from "./hubClient";
import { setAdminAiBlocked, setAIControl } from "../ai/levelStore";
import { resetToasts } from "../shared/toast";
import { lineCase } from "../shared/casing";
import type { ReceiptDetail as Detail, FeedRow } from "../substrate/commands/receipts";
import { capsulesInCards, loneActionBoxes } from "../laws/catalogCheck";

const NOW = new Date().toISOString();
const DOT = "·";
const TONES = ["warn", "good", "red", "est"];

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

beforeEach(() => { setAdminAiBlocked(false); });
afterEach(() => { resetToasts(); setAdminAiBlocked(false); setAIControl(undefined); cleanup(); vi.restoreAllMocks(); });

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const isDate = (f: Element) => f.classList.contains("date");
const isTone = (f: Element) => TONES.some((t) => f.classList.contains(t));
/** A fact is the line's grey when nothing but its words say so: no key colour, not a date, not st/cat, and not wholly a white number. */
const isGrey = (f: Element) => {
  if (isDate(f) || isTone(f) || f.classList.contains("st") || f.classList.contains("cat")) return false;
  const kids = Array.from(f.children);
  return !(kids.length === 1 && kids[0]!.tagName === "B" && kids[0]!.textContent === f.textContent);
};

/** Every catalog property the DOM can show, on every facts or meta line currently on screen. */
export function lineViolations(root: ParentNode = document.body): string[] {
  const bad: string[] = [];
  root.querySelectorAll(".conn-meta, .facts").forEach((line) => {
    const said = (line.textContent ?? "").trim();
    const facts = Array.from(line.querySelectorAll(":scope > .fact"));
    const at = `"${said.slice(0, 70)}"`;
    if (said.includes(DOT)) bad.push(`R6 middle dot inside a facts or meta line: ${at}`);
    if (said.length === 0) bad.push("R1 an empty facts or meta line is drawn");
    if (/^(none|nothing|no [a-z ]+|not set|n\/a)$/i.test(said)) bad.push(`R1 placeholder line: ${at}`);
    if (facts.filter(isGrey).length > 1) bad.push(`R1/R5 more than one grey fact: ${at}`);
    if (facts.filter(isTone).length > 1) bad.push(`R3 more than one key colour on one line: ${at}`);
    facts.forEach((f) => {
      const t = (f.textContent ?? "").trim();
      if (/\d{1,2}:\d{2}/.test(t) && !/\b(AM|PM)\b/.test(t)) bad.push(`clock law: no AM or PM in ${at}`);
      if (/\d{1,2}:\d{2}/.test(t) && !isDate(f)) bad.push(`R8 a clock time that is not .fact.date: ${at}`);
      // A provider's message id is spelled as it was issued, like any word with its own capitals.
      if (!isDate(f) && !/^Message [0-9a-z]+$/i.test(t) && lineCase(t) !== t) bad.push(`casing: "${t}" is not Title Case`);
    });
  });
  // R7, R9, R10: no private note, brief, head or mode-lines class.
  for (const c of ["hub-note", "hub-brief", "hub-head", "hub-mode-lines"]) if (root.querySelector("." + c)) bad.push(`a private .${c} is drawn (use .input-hint under a card, .sh2 for a head)`);
  return bad;
}

describe("the Hub follows the visual catalog on every screen", () => {
  it("Agents: one grey per row, the status in the key, no placeholder, notes are .input-hint", async () => {
    render(<HubFlow onBack={() => {}} client={rig()} onOpenEmail={() => {}} />);
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(lineViolations()).toEqual([]);
    // The Manual assistant says what it may do and nothing else: no "Manual", no "No Project Yet".
    expect(screen.queryByText("No Project Yet")).toBeNull();
    expect(screen.queryByText("Manual")).toBeNull();
    // Connected wears the done green, an expired link the late red.
    expect(screen.getByText("Connected").className).toContain("fg-good");
    expect(screen.getByText("Expired").className).toMatch(/fact red/);
    // The revoked row carries its time as a small-caps date, and nothing that repeats its section head.
    expect(screen.queryByText("Access Revoked")).toBeNull();
    expect(document.querySelectorAll(".input-hint").length).toBeGreaterThanOrEqual(3);
  });

  it("Agents: the AI row says nothing when on, one fragment with no dot when off", async () => {
    setAIControl({ level: "off" } as never);
    const { unmount } = render(<HubFlow onBack={() => {}} client={rig()} onOpenEmail={() => {}} />);
    await screen.findByText("Claude");
    expect(screen.getByText("Nothing Runs")).toBeInTheDocument();
    expect(lineViolations()).toEqual([]);
    unmount();
    setAIControl(undefined);
    render(<HubFlow onBack={() => {}} client={rig()} onOpenEmail={() => {}} />);
    await screen.findByText("Claude");
    expect(screen.queryByText("On")).toBeNull();
  });

  it("Agent detail: the status, mode and grant lines follow the rules; each mode is one grey line", async () => {
    render(<HubFlow onBack={() => {}} client={rig()} onOpenEmail={() => {}} />);
    fireEvent.click(await screen.findByText("Claude"));
    await screen.findByText("What's Shared");
    expect(lineViolations()).toEqual([]);
    // Each of the three modes states its ceiling once, as one line.
    expect(document.querySelectorAll('[role="radio"] .conn-meta').length).toBe(3);
    expect(document.querySelectorAll('[role="radio"] .conn-meta .fact').length).toBe(3);
    // Fields are Title Case words, not raw keys; a grant with no end says nothing about one.
    expect(screen.getByText("Title, Due Date")).toBeInTheDocument();
    expect(screen.queryByText("For This Project")).toBeNull();
    // The grant's count is a white number and its end a small-caps date.
    expect(document.querySelector(".conn-meta .fact b")?.textContent).toMatch(/Records?$/);
    expect(Array.from(document.querySelectorAll(".conn-meta .fact.date")).some((f) => /^Until /.test(f.textContent ?? ""))).toBe(true);
  });

  it("Review: the source line, the decided rows and the notes are lists of facts; the head is .sh2", async () => {
    render(<HubFlow onBack={() => {}} client={rig()} onOpenEmail={() => {}} />);
    await screen.findByText("Claude");
    tab("Review");
    expect(await screen.findByText("Fly on the 12th")).toBeInTheDocument();
    expect(lineViolations()).toEqual([]);
    expect(document.querySelector(".sh2 .t")?.textContent).toBe("Save What We Decided");
    // Who and how much it rests on are one grey; the moment is two date facts.
    expect(screen.getByText("Suggested by Claude, 2 Evidence Links")).toBeInTheDocument();
    // Version 1 says nothing; version 2 is a white number; the long statement is the last fact.
    const rows = Array.from(document.querySelectorAll(".row")).filter((r) => r.querySelector(".conn-name")?.textContent === "Trip Budget");
    const facts = Array.from(rows[0]!.querySelectorAll(".conn-meta > .fact"));
    expect(facts[0]!.querySelector("b")?.textContent).toBe("Version 2");
    expect(facts[facts.length - 1]!.textContent).toBe("Cap the Trip at $2,400");
    // The Email row's line restated the row; it has none.
    const emailRow = screen.getByText("5 Email Items to Review").closest(".row")!;
    expect(emailRow.querySelector(".conn-meta, .facts")).toBeNull();
    tab("Mentioned");
    expect(await screen.findByText("A Second Team")).toBeInTheDocument();
    expect(lineViolations()).toEqual([]);
    // A note with no date has only its one grey.
    const bare = screen.getByText("Night Tournaments").closest(".row")!;
    expect(bare.querySelectorAll(".fact").length).toBe(1);
  });

  it("Activity: the feed rows, the suggestions and the Email row follow the rules", async () => {
    render(<HubFlow onBack={() => {}} client={rig()} onOpenEmail={() => {}} />);
    await screen.findByText("Claude");
    tab("Activity");
    expect(await screen.findByText("Sent a Reply")).toBeInTheDocument();
    expect(lineViolations()).toEqual([]);
    // The suggestion says what it touches. With no decision to name it says nothing.
    expect(screen.getByText("Affects Trip Budget")).toBeInTheDocument();
    const noName = screen.getByText("Hotel Was Removed").closest(".row")!;
    expect(noName.querySelector(".conn-meta, .facts")).toBeNull();
    // A reported action is Not Verified in amber, beside a time in small caps.
    const reported = screen.getByText("Read 3 Records in Summer Travel").closest(".row")!;
    expect(reported.querySelector(".fact.warn")?.textContent).toBe("Not Verified");
    expect(reported.querySelector(".fact.date")).not.toBeNull();
    // The Email row is its count and nothing under it (it was "Inside Email · No Preview Here").
    const email = screen.getByText("5 Email Items to Review").closest(".row")!;
    expect(email.querySelector(".conn-meta, .facts")).toBeNull();
    // A failed row's chip wears the key's red through the key's token, not a private hex.
    expect(document.querySelector(".hub-cap.hub-cap-error")?.textContent).toBe("Not Done");
  });

  it("Receipt: the card, the evidence, the provider and the history follow the rules", async () => {
    render(<HubFlow onBack={() => {}} client={rig()} onOpenEmail={() => {}} />);
    await screen.findByText("Claude");
    tab("Activity");
    fireEvent.click(await screen.findByText("Sent a Reply"));
    expect(await screen.findByText("Provider")).toBeInTheDocument();
    expect(lineViolations()).toEqual([]);
    // One grey (who), the approval folded into it, the assurance in green, the moment in small caps.
    expect(screen.getByText("Suggested by Claude, Approved by You")).toBeInTheDocument();
    expect(screen.getByText("Verified by JARVIS").className).toContain("good");
    // The provider's sentence is the card's note, not a fourth grey on its row.
    expect(screen.getByText("Accepted Means Gmail Took It, Not That It Was Read").closest(".input-hint")).not.toBeNull();
    expect(screen.getByText("Outbox Not Done, 3 Attempts").className).toContain("red");
    // A caveat on an evidence row is amber and never carries a dot.
    expect(screen.getByText("Source Removed, Excerpt Kept").className).toContain("warn");
    // The history's failed row shows the error in red where the status would be, and the proposed row folds its status into who.
    expect(screen.getByText("Suggested, Claude")).toBeInTheDocument();
    // The scope is content, in primary ink, not a grey line.
    expect(screen.getByText("Con Edison · $142.30 · Due Oct 15").className).toContain("hub-text");
  });

  it("Decision: the version, dependency, source and constraint lines follow the rules", async () => {
    render(<HubFlow onBack={() => {}} client={rig()} onOpenEmail={() => {}} />);
    await screen.findByText("Claude");
    tab("Review");
    fireEvent.click(screen.getAllByText("Trip Budget").find((e) => e.closest(".row"))!);
    expect(await screen.findByText("Depends On")).toBeInTheDocument();
    expect(lineViolations()).toEqual([]);
    // The kind is the section's own head, so the row names only the record's kind, in Title Case.
    expect(screen.getByText("Decision Record")).toBeInTheDocument();
    expect(screen.queryByText(/^Depends on/)).toBeNull();
    // A dependency's state wears the key: current green, changed amber, missing red.
    const caps = Array.from(document.querySelectorAll(".hub-cap")).map((c) => c.className.replace("hub-cap", "").trim());
    expect(caps).toEqual(["hub-cap-money", "hub-cap-waiting", "hub-cap-error"]);
    // Active is the key's green; Superseded is the line's grey; both versions are white numbers.
    expect(screen.getAllByText("Active").some((e) => e.classList.contains("good"))).toBe(true);
    expect(screen.getByText("Superseded").className).toBe("fact");
    expect(screen.getByText("Withdrawn Because Plans changed")).toBeInTheDocument();
    expect(screen.getByText("Trip Budget Usd")).toBeInTheDocument();
  });

  it("Shared Context: the preview rows follow the rules; the always-true lines are the card's note", async () => {
    render(<ContextPreview client={rig()} connection={overview.connections[0]!} projectId="p1" projectTitle="Summer Travel" offline={false} onBack={() => {}} onImported={() => {}} />);
    expect(await screen.findByText("Left Out")).toBeInTheDocument();
    expect(lineViolations()).toEqual([]);
    // The purpose only restated the title, so the row has no line; fields are Title Case, not raw keys.
    expect(screen.getByText("Summer Travel").closest(".row")!.querySelector(".conn-meta")).toBeNull();
    expect(screen.getByText("Phone Number", { exact: false })).toBeInTheDocument();
    const left = screen.getByText("Left Out").closest(".row")!;
    expect(left.querySelector(".fact.red")?.textContent).toBe("1 Over the Limit");
    expect(left.querySelector(".fact b")?.textContent).toBe("2 Outside This Project");
    expect(screen.getByText("Health, Money and Mail Are Never Shared, and a Read Receipt Is Written First").closest(".input-hint")).not.toBeNull();
  });

  it("Shared Context: a preview with no fields and nothing left out draws no line under those rows (no \"None\")", async () => {
    const bare = rig({ context_preview: () => ({ manifest: [{ resource_id: "p1", revision: 1, fields: [], redactions: [], evidence_refs: [] }], redactions: [], record_count: 1, content_bytes: 0, omitted_counts: { unauthorized: 0, over_limit: 0 }, manifest_hash: "f".repeat(64), requires_user_grant: true, job_id: "j1", project_id: "p1", purpose: "A Custom Purpose" }) });
    render(<ContextPreview client={bare} connection={overview.connections[0]!} projectId="p1" projectTitle="Summer Travel" offline={false} onBack={() => {}} onImported={() => {}} />);
    expect(await screen.findByText("Left Out")).toBeInTheDocument();
    expect(lineViolations()).toEqual([]);
    expect(screen.queryByText("None")).toBeNull();
    expect(screen.getByText("Fields").closest(".row")!.querySelector(".conn-meta")).toBeNull();
    expect(screen.getByText("Left Out").closest(".row")!.querySelector(".conn-meta")).toBeNull();
    // A purpose that says something the title does not is the one grey on the project row.
    expect(screen.getByText("A Custom Purpose")).toBeInTheDocument();
  });

  it("the Add and Import sheets: the Into row is one grey fragment with no dot", async () => {
    render(<ImportSheet projectTitle="Summer Travel" onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Everything Lands in Mentioned, Nothing Is Decided by Pasting")).toBeInTheDocument();
    expect(lineViolations()).toEqual([]);
  });

  it("the conflict card draws each side's key as the one grey and its value as a white fact", async () => {
    const dup = rig({ decision_save: () => ({ error: "DESTINATION_CHANGED", detail: "conflict", conflicts: [{ item_id: "d1", version_id: "v1", title: "Trip Budget", statement: "Cap the trip at $2,400", key: "trip_budget_usd", theirs: "2400", mine: null }] }) });
    render(<HubFlow onBack={() => {}} client={dup} />);
    await screen.findByText("Claude");
    tab("Review");
    fireEvent.click(screen.getByRole("button", { name: "Save Decision" }));
    fireEvent.change(screen.getByLabelText("Decision title"), { target: { value: "Trip Budget" } });
    fireEvent.change(screen.getByLabelText("Statement"), { target: { value: "Cap it" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Money" } });
    fireEvent.click(document.querySelector<HTMLButtonElement>(".sheet-bar-save")!);
    expect(await screen.findByText("Conflicts With Trip Budget")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll(".hub-compare .conn-meta").length).toBe(2));
    expect(lineViolations()).toEqual([]);
    // "None" was the placeholder for a side with no value; that side shows its key only.
    expect(screen.queryByText("None")).toBeNull();
  });
});

// CLEAN ROWS, NO PILLS INSIDE A CARD, AND NO ACTION ALONE IN A BOX (Dave 2026-10-05, locked; ROW-ACTIONS-SPEC sections 2 and
// 5; catalog rule 12). Alfred 2026-10-04 and the lone-box measurement named Clear Expired Shares, Dismiss Suggestion,
// Paste or Import a Conversation and Revoke Access. Every Hub screen is rendered and the two DOM checks the laws own are
// run on what it draws: no capsule in a card or a row except in a settled home (a section head, a sheet bar, a notice's
// own action row), and no card whose only content is a button.
describe("the Hub holds no capsule in a card and no action alone in a box", () => {
  const clean = () => { expect(capsulesInCards(document.body)).toEqual([]); expect(loneActionBoxes(document.body)).toEqual([]); };

  it("Agents: Add Assistant is the Assistants head's capsule, and Clear Expired Shares stands by itself", async () => {
    render(<HubFlow onBack={() => {}} client={rig()} onOpenEmail={() => {}} />);
    await screen.findByText("Claude");
    clean();
    const head = screen.getByText("Assistants").closest(".sh2")!;
    expect(head.querySelector("button")!.textContent).toBe("Add Assistant");
    expect(head.querySelector("button")).toHaveClass("see-all", "pill-action");
    const sweep = screen.getByRole("button", { name: "Clear Expired Shares" });
    expect(sweep.closest(".card")).toBeNull();
    expect(sweep.parentElement).toHaveClass("notice-clear-row");
  });

  it("Agent detail: Preview Shared Context and Revoke Access stand under the page as capsules, none in a card", async () => {
    render(<HubFlow onBack={() => {}} client={rig()} onOpenEmail={() => {}} />);
    fireEvent.click(await screen.findByText("Claude"));
    await screen.findByText("What's Shared");
    clean();
    const preview = screen.getByRole("button", { name: "Preview Shared Context" });
    const revoke = screen.getByRole("button", { name: "Revoke Access" });
    for (const b of [preview, revoke]) { expect(b.closest(".card")).toBeNull(); expect(b.parentElement).toHaveClass("hub-acts"); }
    expect(revoke).toHaveClass("row-act", "hub-danger");
  });

  it("Review: Paste or Import a Conversation stands alone as one capsule on both lists, and a proposal's own answers stay on its card", async () => {
    render(<HubFlow onBack={() => {}} client={rig()} onOpenEmail={() => {}} />);
    await screen.findByText("Claude");
    tab("Review");
    await screen.findByText("Fly on the 12th");
    clean();
    // Its own words are the head; the action stands by itself under the choosers, as one capsule with no box (rule 12).
    const paste = screen.getByRole("button", { name: "Paste or Import a Conversation" });
    expect(paste.closest(".card")).toBeNull();
    expect(paste.parentElement).toHaveClass("notice-clear-row");
    expect(screen.getAllByRole("button", { name: "Paste or Import a Conversation" })).toHaveLength(1);
    // The suggestion's answers are the settled card-with-its-own-words home, and are still reachable.
    expect(screen.getByRole("button", { name: "Save Decision" }).closest(".notice-actions")).not.toBeNull();
    tab("Mentioned");
    await screen.findByText("A Second Team");
    clean();
  });

  it("Activity and the receipt: the receipt's verbs stand under it as capsules, none in a card", async () => {
    render(<HubFlow onBack={() => {}} client={rig()} onOpenEmail={() => {}} />);
    await screen.findByText("Claude");
    tab("Activity");
    fireEvent.click(await screen.findByText("Read 3 Records in Summer Travel"));
    await screen.findByText("Copy Receipt");
    clean();
    const copy = screen.getByRole("button", { name: "Copy Receipt" });
    expect(copy.closest(".card")).toBeNull();
    expect(copy.parentElement).toHaveClass("hub-acts");
  });

  it("Decision detail: Mark Reviewed is the Depends On head's capsule; Replace and Withdraw stand under the page", async () => {
    render(<HubFlow onBack={() => {}} client={rig()} onOpenEmail={() => {}} />);
    await screen.findByText("Claude");
    tab("Review");
    fireEvent.click(await screen.findByText("Team Size"));
    await screen.findByText("Withdraw Decision");
    clean();
    for (const name of ["Replace With a New Decision", "Withdraw Decision"]) expect(screen.getByRole("button", { name }).closest(".card")).toBeNull();
  });
});

describe("HubFacts itself", () => {
  it("draws nothing for a line with nothing to say, a date as small caps, and keeps one key colour", () => {
    const { container } = render(<><HubFacts facts={[]} /><HubFacts facts={[null, false, "", { text: "  " }]} /></>);
    expect(container.innerHTML).toBe("");
    cleanup();
    const r = render(<HubFacts facts={[{ text: "Who" }, { text: "Today", tone: "date" }, { text: "Done", tone: "good" }, { text: "Late", tone: "red" }, { text: "3", strong: true }]} />);
    const spans = Array.from(r.container.querySelectorAll(".fact"));
    expect(spans.map((s) => s.className)).toEqual(["fact", "fact date", "fact good", "fact", "fact"]);
    expect(spans[4]!.querySelector("b")?.textContent).toBe("3");
    expect(r.container.firstElementChild?.className).toBe("conn-meta");
  });
});

describe("the Hub's stylesheet", () => {
  const css = readFileSync(`${process.cwd()}/src/styles/hub.css`, "utf8");
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  it("carries no raw colour: every ink is a token of the Colour Key", () => {
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/rgba?\(/);
  });
  it("has no violet review or blue travel role, which are not in the key", () => {
    expect(rules).not.toMatch(/hub-review|hub-travel/);
  });
  it("has no private note, brief, head or mode-lines rule", () => {
    expect(rules).not.toMatch(/\.hub-(note|brief|head|mode-lines)\b/);
  });
  it("draws a record's content in primary ink, never the grey the facts line under it takes", () => {
    const text = rules.match(/\.hub-text \{([^}]*)\}/)![1]!;
    expect(text).toMatch(/color:\s*var\(--tx-1\)/);
  });
  it("sets no quiet text at 13 or 11 sizes beyond the state capsule", () => {
    const quiet = rules.split("}").filter((r) => /font-size:\s*var\(--t-caption\)/.test(r));
    expect(quiet).toEqual([]);
  });
});
