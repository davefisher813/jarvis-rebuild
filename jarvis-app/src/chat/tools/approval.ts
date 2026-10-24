// THE TAP: THE ONLY ROAD FROM A CARD TO A WRITE (chat box order, 2026-10-24).
//
// This is the one module that imports execute.ts, and the hook calls it from the card's button and from nowhere else. It asks the store to
// approve the proposal against the hash the card drew (proposals.ts: open, inside five minutes, the same content, once), and only a yes
// goes on to execute. Every other answer is a reason in words and nothing was changed.
//
// The proposal is not finished here. The thread has still to write its receipt, and the card stays on screen, working, until it has, so
// the person never sees the card vanish before the line that says what happened. The screen ends it (the hook's `settle`) once it has.

import { executeProposal, type Executed, type WriteDeps } from "./execute";
import type { ApprovalVerdict, ProposalStore } from "./proposals";

type Refused = Extract<ApprovalVerdict, { ok: false }>["reason"];

/** What the person is told when a tap does nothing. Every one of them says nothing was changed, because that is true. */
export const REFUSED_WORDS: Record<Refused, string> = {
  gone: "That card is gone · Nothing was changed",
  not_open: "That one was already handled · Nothing was changed",
  expired: "That card timed out · Nothing was changed",
  changed: "That card changed since you saw it · Nothing was changed",
  superseded: "A newer card replaced that one · Nothing was changed",
};

export type Approved =
  | (Extract<Executed, { ok: true }> & { proposalId: string })
  | { ok: false; reason: Refused | "failed"; message: string };

/** The person tapped a card. `shownHash` is the hash of the content that card drew. */
export async function approveAndRun(store: ProposalStore, id: string, shownHash: string, deps: WriteDeps): Promise<Approved> {
  const verdict = await store.approve(id, shownHash);
  if (!verdict.ok) return { ok: false, reason: verdict.reason, message: REFUSED_WORDS[verdict.reason] };
  const done = await executeProposal(verdict.proposal.content, deps);
  if (!done.ok) return { ok: false, reason: "failed", message: done.message };
  return { ...done, proposalId: id };
}
