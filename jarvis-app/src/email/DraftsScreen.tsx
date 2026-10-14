// DRAFTS, AND WHAT LEFT FROM HERE (docs/jarvis-unified, slice 07;
// IMPLEMENTATION-SPEC.md 08 E19, 09 "Drafts and Sent are accessible through
// its mailbox picker"). Two lists from one read: the drafts (and the sends
// that failed, so Review Again is a tap away), newest saved first, with the
// copies this device holds that never reached the server; and the sends,
// newest first, each with its state. Sent means Gmail accepted it, and the
// row says so. Nothing here sends.

import { useEffect, useState } from "react";
import PageHeader from "../shared/PageHeader";
import ListFloor from "../shared/ListFloor";
import SkeletonRows from "../shared/SkeletonRows";
import { rowDoor } from "../shared/rowDoor";
import SwipeDelete from "../shared/SwipeDelete";
import { showToast } from "../shared/toast";
import { lineFor, type CommandFailure, type RpcClient } from "../substrate/commands/errors";
import { ACCOUNTS_TITLE, DRAFTS_TITLE, DRAFT_DISCARDED, DRAFT_KEPT, EMPTY_DRAFTS, FAILED_BADGE, NO_SUBJECT, UNDO, RETRY, SENDING_BADGE, SENT_BADGE, SENT_FOLDER, THIS_DEVICE, UNKNOWN_BADGE } from "./copy";
import EmailFacts from "./EmailFacts";
import { whenFacts, type EmailFact } from "./format";
import EmptyState from "./EmptyState";
import { deviceOnly, discardDraft, fieldsOf, listDrafts, outcomeOf, saveDraft, unsavedLocal, type DraftRow, type LocalDraft } from "./drafts";

export default function DraftsScreen({ client, userId, offline, onBack, onCompose, onOpenDraft, onOpenLocal, onOpenSent, reloadKey = 0 }: {
  client: RpcClient;
  userId: string;
  offline: boolean;
  onBack: () => void;
  onCompose: () => void;
  onOpenDraft: (d: DraftRow) => void;
  onOpenLocal: (d: LocalDraft) => void;
  onOpenSent: (d: DraftRow) => void;
  reloadKey?: number;
}) {
  const [lists, setLists] = useState<{ drafts: DraftRow[]; sent: DraftRow[] } | null>(null);
  const [error, setError] = useState<CommandFailure | null>(null);
  const [local, setLocal] = useState<LocalDraft[]>(() => unsavedLocal(userId));
  const load = async () => {
    setError(null);
    const r = await listDrafts(client);
    if (!r.ok) { setError(r); return; }
    setLists(r.value);
    // A copy of a draft the server lists (here or already sent) with the same words is that draft, listed once (issue 103).
    setLocal(deviceOnly(unsavedLocal(userId), [...r.value.drafts, ...(r.value.sent ?? [])]));
  };
  useEffect(() => { void load();
  }, [client, reloadKey]);

  // SWIPE LEFT DISCARDS A DRAFT (Dave 2026-10-13: swipe is the standard). The same discard the compose screen has, with the same
  // Undo: the words come back as a new draft. Only a plain draft swipes; one that is sending, sent or failed has a review to go
  // through first, so its row opens instead.
  const discardRow = async (d: DraftRow) => {
    const r = await discardDraft(client, d.id);
    if (!r.ok) { showToast({ message: lineFor(r) }); return; }
    setLists((cur) => (cur ? { ...cur, drafts: cur.drafts.filter((x) => x.id !== d.id) } : cur));
    const kept = fieldsOf(d);
    showToast({ message: DRAFT_DISCARDED, actionLabel: UNDO, onAction: () => void (async () => {
      const back = await saveDraft(client, null, d.account_id, kept, null);
      if (!back.ok) { showToast({ message: lineFor(back) }); return; }
      showToast({ message: DRAFT_KEPT });
      void load();
    })() });
  };

  // 2026-10-05: ONE facts line per row, the state first and in its key colour, the time as small caps, the recipients
  // last (the free text, so it is the one that ellipsizes). It was three greys in two stacked lines, a time with a
  // middle dot baked into its string, and "(No Recipient)" and a bare "Draft" saying nothing the section head does not.
  // Sent is green (done); Not Sent and Unknown are amber (they need you); Sending is amber too (not done yet). A draft
  // in the Drafts section needs no state word: the head says it.
  const stateFact = (d: DraftRow): EmailFact | null => {
    const o = outcomeOf(d);
    return o === "sent" ? { text: SENT_BADGE, tone: "good" } : o === "unknown" ? { text: UNKNOWN_BADGE, tone: "warn" } : o === "failed" ? { text: FAILED_BADGE, tone: "warn" } : o === "sending" ? { text: SENDING_BADGE, tone: "warn" } : null;
  };
  const whoFact = (to: readonly string[]): EmailFact[] => (to.length === 0 ? [] : [{ text: to.length === 1 ? to[0]! : `${to[0]} and ${to.length - 1} More` }]);
  const lineOf = (state: EmailFact | null, iso: string, to: readonly string[]): EmailFact[] => [...(state ? [state] : []), ...whenFacts(iso), ...whoFact(to)];
  const drafts = lists?.drafts ?? [];
  const sent = lists?.sent ?? [];
  const nothing = lists && drafts.length === 0 && local.length === 0 && sent.length === 0;

  return (
    <div className="screen ruled email-drafts">
      <PageHeader title={DRAFTS_TITLE} back={ACCOUNTS_TITLE} onBack={onBack} />
      {!lists && !error && <SkeletonRows rows={3} />}
      {error && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="row"><div className="row-grow"><div className="conn-name">{lineFor(error)}</div></div></div>
          <button className="row row-act" onClick={() => void load()} disabled={offline}>{RETRY}</button>
        </div></div>
      )}
      {nothing && <EmptyState copy={EMPTY_DRAFTS} onAction={onCompose} />}
      {lists && (drafts.length > 0 || local.length > 0) && (
        <div className="pad-x">
          <div className="eyebrow email-eyebrow">{DRAFTS_TITLE}</div>
          <div className="card list-card-ruled">
            {local.map((l) => (
              <div className="row" key={l.key} {...rowDoor(() => onOpenLocal(l))}>
                <div className="row-grow">
                  <div className="conn-name truncate">{l.fields.subject.trim() || NO_SUBJECT}</div>
                  <EmailFacts wrap facts={lineOf({ text: THIS_DEVICE, tone: "warn" }, l.saved_at, l.fields.to_addresses)} />
                </div>
              </div>
            ))}
            {drafts.map((d) => {
              const row = (
                <div className="row" key={d.id} {...rowDoor(() => onOpenDraft(d))}>
                  <div className="row-grow">
                    <div className="conn-name truncate">{d.subject.trim() || NO_SUBJECT}</div>
                    <EmailFacts wrap facts={lineOf(stateFact(d), d.saved_at, d.to_addresses)} />
                  </div>
                </div>
              );
              return outcomeOf(d) === "draft" && !offline
                ? <SwipeDelete key={d.id} label={d.subject.trim() || NO_SUBJECT} onDelete={() => void discardRow(d)}>{row}</SwipeDelete>
                : row;
            })}
          </div>
        </div>
      )}
      {lists && sent.length > 0 && (
        <div className="pad-x">
          <div className="eyebrow email-eyebrow">{SENT_FOLDER}</div>
          <div className="card list-card-ruled">
            {sent.map((d) => (
              <div className="row" key={d.id} {...rowDoor(() => onOpenSent(d))}>
                <div className="row-grow">
                  <div className="conn-name truncate">{d.subject.trim() || NO_SUBJECT}</div>
                  <EmailFacts wrap facts={lineOf(stateFact(d), d.updated_at, d.to_addresses)} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {lists && !nothing && <div className="pad-x"><ListFloor /></div>}
      <div className="screen-foot" />
    </div>
  );
}
