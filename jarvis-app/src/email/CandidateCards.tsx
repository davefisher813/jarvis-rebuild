// THE CARDS UNDER A MESSAGE (docs/jarvis-unified, slice 06;
// IMPLEMENTATION-SPEC.md 08 E07, E09, E10, E11; 09 M1; 10; 13). Each card
// proposes one effect and names it: Save Bill, Save Receipt, Add Task, Add to
// Schedule, Track This. One tap on that word commits exactly what the card
// shows, once, through slice 03's atomic door, with no second question; the
// confirmed row becomes a compact receipt line with View. Details opens the
// sheet; the cross dismisses the card and only the card; a dismissed card
// comes back from the menu. At most two show at first; the rest wait behind
// a count. A card read from a copy of the email that has since changed says
// so and offers to review the latest details instead of saving. A card for a
// module that is not ready says so and keeps its Save shut; the card stays.
// No card here is red: the screen's one red belongs to the screen.

import { useState } from "react";
import { showToast } from "../shared/toast";
import { approveCapture, undoCapture, UNDO_TOAST_MS, type ActionResult } from "../substrate/commands/captures";
import { dismissCandidate, restoreCandidate } from "../substrate/commands/captures";
import { failure, lineFor, type CommandFailure, type RpcClient } from "../substrate/commands/errors";
import type { PrepareContext } from "../substrate/destinations/types";
import type { CaptureKind } from "../substrate/contracts";
import { AGENT_SUGGESTION, DETAILS, DISMISS, EMAIL_CHANGED, KEEP_SEPARATE, MAY_EXIST, NEEDS_DETAILS, NOT_SAVED_YET, PREVIOUSLY_SAVED, LATEST, RESTORE, REVIEW_LATEST, UNDO, UPDATE_IN, VIEW_RECEIPT, moreSuggestions } from "./copy";
import { BADGE, PRIMARY, cardLines, isProvisional, isStale, moduleOf, toCard, type Candidate } from "./candidates";
import EmailFacts from "./EmailFacts";
import { dotFacts } from "./format";
import type { InboxRow } from "./emailClient";

export const SHOWN_AT_FIRST = 2;


export default function CandidateCards({ client, candidates, row, ctx, ready, readyLine, offline, evidenceExcerpt, showDismissed, conflictOf, now, onChanged, onDetails, onReview, onReceipt, onOpenModule }: {
  client: RpcClient;
  /** This message's cards, every status. */
  candidates: Candidate[];
  row: Pick<InboxRow, "id" | "thread_id" | "account" | "source_hash">;
  ctx: PrepareContext;
  /** Whether the module behind a kind can take a record right now. */
  ready: (kind: CaptureKind) => boolean;
  readyLine: (kind: CaptureKind) => string;
  offline: boolean;
  /** The text the receipt's evidence keeps, when the message is open; the snippet otherwise (the server's fallback). */
  evidenceExcerpt?: string;
  showDismissed: boolean;
  /** A record of the same facts the module already holds (10.1 step 7): the card says so and asks before a second one is made. */
  conflictOf?: (c: Candidate) => boolean;
  now?: () => Date;
  /** The cards changed on the server: read them again. */
  onChanged: () => void | Promise<void>;
  onDetails: (c: Candidate) => void;
  /** A stale card: re-read the message with the rules and open the refreshed card. */
  onReview: (c: Candidate) => void;
  onReceipt: (actionId: string) => void;
  onOpenModule?: (module: string, destinationId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, string>>({});
  const [separate, setSeparate] = useState<Record<string, true>>({});
  const clock = now ?? (() => new Date());

  const provisional = candidates.filter((c) => isProvisional(c));
  const saved = candidates.filter((c) => c.status === "saved");
  const dismissed = candidates.filter((c) => c.status === "dismissed");
  const shown = expanded ? provisional : provisional.slice(0, SHOWN_AT_FIRST);
  const hidden = provisional.length - shown.length;

  const say = (id: string, f: CommandFailure | string | null) => setLines((l) => ({ ...l, [id]: f === null ? "" : typeof f === "string" ? f : lineFor(f) }));

  const save = async (c: Candidate) => {
    if (busy) return;
    if (!ready(c.kind)) { say(c.id, readyLine(c.kind)); return; }
    if (offline) { say(c.id, failure("OFFLINE")); return; }
    setBusy(c.id);
    say(c.id, null);
    const r = await approveCapture(client, toCard(c, evidenceExcerpt), ctx, { ready });
    setBusy(null);
    if (!r.ok) {
      if (r.code === "MISSING_DETAILS") { onDetails(c); return; }
      if (r.code === "SOURCE_CHANGED") { say(c.id, EMAIL_CHANGED); await onChanged(); return; }
      say(c.id, r);
      if (r.code === "IDEMPOTENCY_CONFLICT") await onChanged();
      return;
    }
    const a: ActionResult = r.value;
    await onChanged();
    const undo = a.item_updated_at && !a.already
      ? async () => {
        const u = await undoCapture(client, a.action_id, a.item_updated_at!);
        if (!u.ok) { showToast({ message: lineFor(u) }); return; }
        showToast({ message: u.value.safe_message });
        await onChanged();
      }
      : null;
    showToast({ message: a.safe_message, ...(undo ? { actionLabel: UNDO, onAction: () => void undo() } : {}) }, UNDO_TOAST_MS);
  };

  const dismiss = async (c: Candidate) => {
    if (busy) return;
    setBusy(c.id);
    const r = await dismissCandidate(client, c);
    setBusy(null);
    if (!r.ok) { say(c.id, r); return; }
    await onChanged();
  };

  const restore = async (c: Candidate) => {
    if (busy) return;
    setBusy(c.id);
    const r = await restoreCandidate(client, c);
    setBusy(null);
    if (!r.ok) { say(c.id, r); return; }
    await onChanged();
  };

  const card = (c: Candidate) => {
    const { value, facts } = cardLines(c, clock());
    const stale = isStale(c);
    const needs = c.status === "needs_details" || c.missing_fields.length > 0;
    const module = moduleOf(c.kind);
    const notReady = !ready(c.kind);
    const conflict = !separate[c.id] && !!conflictOf?.(c);
    const sibling = c.saved_sibling;
    const line = lines[c.id];
    return (
      <div className={"email-card " + c.kind + (stale ? " stale" : "")} key={c.id} data-candidate={c.id}>
        <div className="email-card-head">
          <div>
            <span className="email-badge">{BADGE[c.kind]}</span>
            {c.origin === "agent" && <span className="email-badge">{AGENT_SUGGESTION}</span>}
            {c.origin === "agent" && c.agent_name && <span className="email-badge">{c.agent_name}</span>}
            {stale ? <span className="email-badge">{EMAIL_CHANGED}</span> : needs ? <span className="email-badge">{NEEDS_DETAILS}</span> : <span className="email-badge">{NOT_SAVED_YET}</span>}
          </div>
          <button className="email-card-x" aria-label={`${DISMISS} · ${value}`} onClick={() => void dismiss(c)} disabled={busy === c.id}>{"×"}</button>
        </div>
        <div className="email-card-value">{value}</div>
        {/* With a saved sibling the facts ARE the two copies below; drawing them a third time was a second grey on one card. */}
        {!sibling && <EmailFacts wrap facts={facts} />}
        {sibling && (() => {
          const was = cardLines({ payload: sibling.payload }, clock());
          return (
            <dl className="email-compare">
              <dt>{PREVIOUSLY_SAVED}</dt><dd>{was.value}<EmailFacts facts={was.facts} wrap /></dd>
              <dt>{LATEST}</dt><dd>{value}<EmailFacts facts={facts} wrap /></dd>
            </dl>
          );
        })()}
        {conflict && <EmailFacts wrap facts={[{ text: MAY_EXIST, tone: "warn" }]} />}
        {/* 2026-10-05: the reason only, in amber. "Your Bill Is Still Here" after the dot was a second grey on a card whose facts line already spends the grey. */}
        {notReady && !stale && <EmailFacts wrap facts={dotFacts(readyLine(c.kind), "warn").slice(0, 1)} />}
        {line && <div className="input-error" role="alert">{line}</div>}
        {/* 2026-10-05: the card's action is the shared capsule (the Capsule, section AL), not a filled button of its own in the kind's
            colour. Green, blue, violet and yellow cards said nothing: colour is for meaning, and an unsaved proposal is not done. */}
        <div className="email-card-acts">
          {sibling ? (
            <button className="pill-act" onClick={() => onOpenModule?.(module, sibling.destination_id)} disabled={!onOpenModule}>{UPDATE_IN[module]}</button>
          ) : stale ? (
            <button className="pill-act" onClick={() => onReview(c)} disabled={busy === c.id}>{REVIEW_LATEST}</button>
          ) : conflict ? (
            <button className="pill-act" onClick={() => setSeparate((s) => ({ ...s, [c.id]: true }))}>{KEEP_SEPARATE}</button>
          ) : (
            <button className="pill-act" onClick={() => void (needs ? onDetails(c) : save(c))} disabled={busy === c.id || (!needs && (notReady || offline))}>{PRIMARY[c.kind]}</button>
          )}
          <button className="quiet-action" onClick={() => onDetails(c)}>{DETAILS}</button>
        </div>
      </div>
    );
  };

  return (
    <>
      {shown.map(card)}
      {hidden > 0 && <button className="quiet-action email-more" onClick={() => setExpanded(true)}>{moreSuggestions(hidden)}</button>}
      {saved.map((c) => {
        const { value } = cardLines(c, clock());
        return (
          <div className="email-receipt-line" key={c.id} data-candidate={c.id}>
            <EmailFacts facts={[{ text: "\u2713 " + PRIMARY[c.kind].replace(/^(Save|Add|Track) /, (m) => m.replace("Save", "Saved").replace("Add", "Added").replace("Track", "Tracked")), tone: "good" }, { text: value }]} />
            {c.action_id && <button className="quiet-action" onClick={() => onReceipt(c.action_id!)}>{VIEW_RECEIPT}</button>}
          </div>
        );
      })}
      {showDismissed && dismissed.map((c) => {
        const { value, facts } = cardLines(c, clock());
        return (
          <div className={"email-card dismissed"} key={c.id} data-candidate={c.id}>
            <div className="email-card-head"><span className="email-badge">{BADGE[c.kind]}</span><span className="email-badge">{DISMISS}</span></div>
            <div className="email-card-value">{value}</div>
            <EmailFacts wrap facts={facts} />
            <div className="email-card-acts"><button className="quiet-action" onClick={() => void restore(c)} disabled={busy === c.id}>{RESTORE}</button></div>
          </div>
        );
      })}
    </>
  );
}
