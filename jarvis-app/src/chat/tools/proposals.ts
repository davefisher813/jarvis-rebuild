// WHAT THE PERSON IS ASKED TO APPROVE (chat box order, 2026-10-24: "Reads free, writes ask. Every consequential action shows its EXACT
// content before it can happen. Any edit invalidates the approval: hash-bound, 5-minute expiry, single use").
//
// A model that wants a change does not make it. It PROPOSES: the dispatcher turns the call into a Proposal, a card in the thread shows the
// person exactly what would be saved, and only their tap on that card makes the change. This file is the whole of what a proposal is:
//
//   - THE CONTENT is a closed shape per tool (ProposalContent), built from the validated call and from the record as it is NOW. The card is
//     drawn from the content by cardLines, never from the model's words, so the card cannot say anything the change does not do.
//   - THE HASH is of that content, in the one canonical form every approval in this app binds to (substrate/canonical.ts). Approving
//     presents the hash of what the card shows; if it is not the hash the proposal was opened with, nothing happens.
//   - FIVE MINUTES, like the email send review: a card left on the screen goes stale and says so.
//   - ONCE: the moment an approval is accepted the proposal is spent, so a double tap, a retry or a second tab cannot make the change twice.
//   - A newer proposal for the same thing replaces the older one, which can no longer be approved: two cards for one task never both work.
//
// The substrate's own approvals (server side, migrations 0046 and after) cover email candidates and email-draft sends only. This is the
// chat's version of the same rules for the writes the chat can make, held in the dispatcher where the model cannot reach them. It runs
// nothing: executing is writeTools.ts, reachable only from an approval.

import { hashPayload } from "../../substrate/canonical";
import type { Json } from "../../substrate/contracts";
import { weekdayShortDate } from "../../shared/dateFormat";
import { titleCase } from "../../shared/casing";
import type { WriteToolName } from "./registry";

export const APPROVAL_MS = 5 * 60_000;
export const PROPOSAL_SCHEMA = 1;
/** Cards one turn may put in the thread. A turn that wants more is told to stop: a wall of cards is not a review. */
export const MAX_PROPOSALS_PER_TURN = 3;

export type Priority = "high" | "low";

// Text a person cannot see (zero-width characters, a soft hyphen, the byte-order mark) or that reorders what they read (the bidirectional
// marks and overrides). Written as escapes, never literal bytes (laws/controlBytes.test.ts).
const HIDDEN = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * One line of plain, visible words. A task's words can come from a stranger (an email subject filed as a task), and a card is the one place
 * the person decides on what they read, so a line break inside a title cannot forge a second line of the card, and nothing invisible rides
 * along. New text is made plain BEFORE it is hashed, so what the card shows is exactly what would be saved.
 */
export function plain(s: string): string {
  return s.replace(HIDDEN, "").replace(/\s+/g, " ").trim();
}

export type ProposalContent =
  | { kind: "create_task"; text: string; due?: string; priority?: Priority; personId?: string; personName?: string }
  | {
      kind: "update_task";
      taskId: string;
      /** The task's words as they were when the card was drawn. */
      title: string;
      /** What the task was, so the change is judged against the record the person saw and not whatever it has become. */
      basis: { text: string; due: string | null; done: boolean; priority: Priority | null };
      change: { due?: string | null; done?: true; text?: string; priority?: Priority | null };
    }
  | { kind: "capture_decision"; decision: string; why?: string; ruledOut?: string };

export type ProposalState = "open" | "approved" | "executed" | "failed" | "cancelled" | "expired" | "superseded";

export interface Proposal {
  id: string;
  tool: WriteToolName;
  content: ProposalContent;
  hash: string;
  createdAt: number;
  expiresAt: number;
  state: ProposalState;
}

/** The hash an approval is bound to: the canonical form of exactly what the card shows. */
export function contentHash(content: ProposalContent): Promise<string> {
  return hashPayload(PROPOSAL_SCHEMA, content as unknown as Json);
}

/** What makes two proposals "the same thing", so a newer one replaces an older one. */
export function slotOf(c: ProposalContent): string {
  switch (c.kind) {
    case "create_task": return `create:${c.text.trim().toLowerCase()}`;
    case "update_task": return `update:${c.taskId}`;
    case "capture_decision": return `decision:${c.decision.trim().toLowerCase()}`;
  }
}

export type ApprovalVerdict =
  | { ok: true; proposal: Proposal }
  | { ok: false; reason: "gone" | "not_open" | "expired" | "changed" | "superseded" };

export class ProposalStore {
  private all = new Map<string, Proposal>();
  private subs = new Set<() => void>();

  constructor(
    private now: () => number = Date.now,
    // Minted here, never by the model: a model-made id could repeat or collide.
    private newId: () => string = () => crypto.randomUUID(),
  ) {}

  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }

  private changed() { for (const fn of this.subs) fn(); }

  /** Open a proposal. Any open one for the same thing is superseded, and can no longer be approved. */
  async open(tool: WriteToolName, content: ProposalContent): Promise<Proposal> {
    const slot = slotOf(content);
    for (const p of this.all.values()) if (p.state === "open" && slotOf(p.content) === slot) p.state = "superseded";
    this.prune();
    const createdAt = this.now();
    const p: Proposal = { id: this.newId(), tool, content, hash: await contentHash(content), createdAt, expiresAt: createdAt + APPROVAL_MS, state: "open" };
    this.all.set(p.id, p);
    this.changed();
    return p;
  }

  get(id: string): Proposal | undefined {
    return this.all.get(id);
  }

  /**
   * Everything still on the screen, oldest first: the open ones, the one being made right now (approved, until its receipt is written),
   * and the ones that ran out of time. A card that was replaced is simply gone.
   */
  list(): Proposal[] {
    return [...this.all.values()].filter((p) => p.state === "open" || p.state === "approved" || p.state === "expired").sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * The person tapped the card. `shownHash` is the hash of the content the card DREW. Accepted only while the proposal is open, inside
   * its five minutes, and bound to that very content; accepting spends it, so it can never be accepted twice. Nothing else changes anything.
   *
   * The hash is taken again from the content as it stands NOW, so an edit made to a proposal after the card was drawn (by anything) is
   * caught here and not honoured. The single await comes first on purpose: everything after it runs without a break, so two taps that
   * arrive together are decided one after the other, and the second finds the first one's claim.
   */
  async approve(id: string, shownHash: string): Promise<ApprovalVerdict> {
    const p = this.all.get(id);
    if (!p) return { ok: false, reason: "gone" };
    const current = await contentHash(p.content);
    if (p.state === "superseded") return { ok: false, reason: "superseded" };
    if (p.state === "open" && this.now() >= p.expiresAt) { p.state = "expired"; this.changed(); }
    if (p.state === "expired") return { ok: false, reason: "expired" };
    if (p.state !== "open") return { ok: false, reason: "not_open" };
    if (shownHash !== p.hash || current !== p.hash) return { ok: false, reason: "changed" };
    p.state = "approved";
    this.changed();
    return { ok: true, proposal: p };
  }

  finish(id: string, ok: boolean): void {
    const p = this.all.get(id);
    if (p && p.state === "approved") { p.state = ok ? "executed" : "failed"; this.changed(); }
  }

  cancel(id: string): boolean {
    const p = this.all.get(id);
    if (!p || p.state !== "open") return false;
    p.state = "cancelled";
    this.changed();
    return true;
  }

  /** Mark what has run out of time. Called when the screen redraws and again at the tap. */
  sweep(): void {
    let any = false;
    for (const p of this.all.values()) if (p.state === "open" && this.now() >= p.expiresAt) { p.state = "expired"; any = true; }
    if (any) this.changed();
  }

  /** The person closed a card that had run out of time. An open one is never dismissed, only cancelled or approved. */
  dismiss(id: string): boolean {
    const p = this.all.get(id);
    if (!p || p.state !== "expired") return false;
    this.all.delete(id);
    this.changed();
    return true;
  }

  /** Forget what is spent: replaced, cancelled, finished or failed cards an hour old, so a long session holds nothing it does not need. */
  private prune(): void {
    const cutoff = this.now() - 60 * 60_000;
    for (const [id, p] of this.all) if (p.state !== "open" && p.state !== "expired" && p.state !== "approved" && p.createdAt < cutoff) this.all.delete(id);
  }
}

// ---- WHAT THE CARD SAYS ----
//
// Drawn from the content alone, as lines of text: the question first, then the facts of the change, one to a line. A line is never a run of
// facts joined by a separator (the catalog draws those as spans), and nothing is cut: a task's words show whole, however long.

export function cardLines(c: ProposalContent): string[] {
  switch (c.kind) {
    case "create_task":
      return [
        "Add this task?",
        c.text,
        ...(c.due ? [`Due ${weekdayShortDate(c.due)}`] : []),
        ...(c.priority ? [`${titleCase(c.priority)} Priority`] : []),
        ...(c.personName ? [`About ${plain(c.personName)}`] : []),
      ];
    case "update_task": {
      const lines = ["Change this task?", plain(c.title)];
      const ch = c.change;
      if (ch.done) lines.push("Mark it done");
      if (ch.text !== undefined) lines.push(`New words: ${ch.text}`);
      if (ch.due !== undefined) {
        const was = c.basis.due ? ` (was ${weekdayShortDate(c.basis.due)})` : "";
        lines.push(ch.due === null ? `Clear the due date${was}` : `Due ${weekdayShortDate(ch.due)}${was}`);
      }
      if (ch.priority !== undefined) lines.push(ch.priority === null ? "Clear the priority" : `${titleCase(ch.priority)} Priority`);
      return lines;
    }
    case "capture_decision":
      return ["Save this decision?", c.decision, ...(c.why ? [`Why: ${c.why}`] : []), ...(c.ruledOut ? [`Instead of: ${c.ruledOut}`] : [])];
  }
}

/** The button that makes the change, named for what it does (Title Case: it is a control). */
export function confirmLabel(c: ProposalContent): string {
  switch (c.kind) {
    case "create_task": return "Add Task";
    case "capture_decision": return "Save Decision";
    case "update_task": {
      const ch = c.change;
      const keys = Object.keys(ch).filter((k) => (ch as Record<string, unknown>)[k] !== undefined);
      if (keys.length === 1 && ch.done) return "Mark Done";
      if (keys.length === 1 && ch.due !== undefined) return ch.due === null ? "Clear Date" : "Move Task";
      return "Change Task";
    }
  }
}

export const CANCEL_LABEL = "Not Now";

/** What the change is about, in a few words, for the line the thread keeps when a card is set aside. */
export function subjectOf(c: ProposalContent): string {
  switch (c.kind) {
    case "create_task": return c.text;
    case "update_task": return plain(c.title);
    case "capture_decision": return c.decision;
  }
}
