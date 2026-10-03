// H7 RECEIPT DETAIL (IMPLEMENTATION-SPEC.md 07.4, 09). The exact verb, the
// status, who acted and who approved, when, the scope, the before and after,
// the evidence, the provider's acknowledgement, Undo while eligible, the
// destination opened live, Copy receipt without anything private, and
// Delete receipt, which is a tombstone and never an undo.

import { useEffect, useState } from "react";
import PageHeader from "../shared/PageHeader";
import { showToast } from "../shared/toast";
import { undoCapture } from "../substrate/commands/captures";
import { COMMAND_LINES } from "../substrate/commands/errors";
import { actorLine, assuranceLine, eraseReceipt, exportReceipt, receiptDetail, statusLine, ERASE_NOTE, type ReceiptDetail as Detail } from "../substrate/commands/receipts";
import { COPIED, COPY_RECEIPT, DELETE_RECEIPT, ITEM_REMOVED, OPEN_DESTINATION, UNDO, UNDONE } from "./copy";
import { destinationKindOf, type RpcClient } from "./hubClient";
import { ConfirmSheet } from "./sheets";
import { facts, whenLine } from "./format";

async function copyText(t: string): Promise<boolean> {
  try {
    const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { clipboard?: { writeText: (s: string) => Promise<void> } }) : undefined;
    if (nav?.clipboard) { await nav.clipboard.writeText(t); return true; }
  } catch { /* no clipboard */ }
  return false;
}

export default function ReceiptDetail({ client, actionId, offline, back, onBack, onChanged, onOpenItem }: {
  client: RpcClient;
  actionId: string;
  offline: boolean;
  /** The parent names where back goes. */
  back: string;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
  onOpenItem?: (kind: string, id: string) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = async () => {
    const r = await receiptDetail(client, actionId);
    if (r.ok) { setD(r.value); setError(null); } else setError(COMMAND_LINES[r.code]);
  };
  useEffect(() => { void load();
  }, [client, actionId]);

  const undo = async () => {
    if (!d || !d.item_updated_at || offline) { showToast({ message: COMMAND_LINES.OFFLINE }); return; }
    setBusy("undo");
    const r = await undoCapture(client, d.action_id, d.item_updated_at);
    setBusy(null);
    if (!r.ok) { showToast({ message: COMMAND_LINES[r.code] }); await load(); return; }
    showToast({ message: `${UNDONE} · ${r.value.safe_message}` });
    await load(); await onChanged();
  };

  const erase = async () => {
    if (!d || offline) return;
    setBusy("erase");
    const r = await eraseReceipt(client, d.action_id);
    setBusy(null);
    setConfirming(false);
    if (!r.ok) { showToast({ message: COMMAND_LINES[r.code] }); return; }
    showToast({ message: "Receipt Deleted · The Action Stands" });
    await load(); await onChanged();
  };

  const copy = async () => {
    if (!d) return;
    const ok = await copyText(exportReceipt(d));
    showToast({ message: ok ? COPIED : "Copy Isn't Available Here" });
  };

  const kind = d ? destinationKindOf(d.kind) : null;
  const last = d?.receipts[d.receipts.length - 1];
  const scope = d?.receipts.find((r) => r.scope_summary)?.scope_summary ?? "";
  const diff = d?.receipts.flatMap((r) => r.diff) ?? [];
  const ack = d?.outbox?.provider_ack ?? d?.receipts.find((r) => r.provider_ack)?.provider_ack ?? null;

  return (
    <div className="screen ruled hub">
      <PageHeader title="Receipt" back={back} onBack={onBack} />
      {!d && !error && <div className="hub-note">Loading…</div>}
      {error && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="row"><div className="conn-name">{error}</div></div>
          <button className="row row-act hub-quiet" onClick={() => void load()}>Retry</button>
        </div></div>
      )}
      {d && (
        <>
          <div className="pad-x"><div className="card pad hub-card">
            <span className={"hub-cap" + (d.state === "confirmed" ? " hub-cap-money" : d.state === "failed" ? " hub-cap-error" : d.state === "outcome_unknown" ? " hub-cap-waiting" : "")}>{statusLine(d.state)}</span>
            <div className="conn-name">{d.verb}</div>
            <div className="hub-text">{actorLine({ ...d, assurance: last?.assurance })}</div>
            <div className="facts"><span className="fact">{facts(whenLine(d.created_at), scope || null, last ? assuranceLine(last.assurance) : null)}</span></div>
          </div></div>

          {diff.length > 0 && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Before and After</span></div>
              <div className="pad-x"><div className="card pad"><div className="hub-diff">
                {diff.map((x, i) => {
                  const oldCls = x.before == null ? "" : "hub-diff-old";
                  return (
                    <div key={`${x.field}-${i}`} className="hub-diff-k">{x.field}
                      <div className="hub-diff">
                        <span className={oldCls}>{x.before == null ? "None" : String(typeof x.before === "object" ? JSON.stringify(x.before) : x.before)}</span>
                        <span>{x.after == null ? "None" : String(typeof x.after === "object" ? JSON.stringify(x.after) : x.after)}</span>
                      </div>
                    </div>
                  );
                })}
              </div></div></div>
            </>
          )}

          {d.evidence.length > 0 && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Evidence</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {d.evidence.map((e) => (
                  <div className="row" key={e.id}><div className="row-grow">
                    <div className="hub-text">{e.excerpt}</div>
                    <div className="conn-meta">{facts(e.type === "email" ? "From an Email" : e.type === "import" ? "From an Import" : "Entered by You", e.availability === "deleted" ? "Source Removed · Excerpt Kept" : e.availability === "disconnected" ? "Mailbox Disconnected · Excerpt Kept" : null)}</div>
                  </div></div>
                ))}
              </div></div>
            </>
          )}

          {(ack || d.outbox) && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">Provider</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                <div className="row"><div className="row-grow">
                  <div className="conn-name">{ack ? "Accepted by Gmail" : "No Acknowledgement"}</div>
                  <div className="conn-meta">{facts(ack ? `Message ${String(ack.id ?? ack.provider_message_id ?? "")}` : null, d.outbox ? `Outbox ${statusLine(d.outbox.state)}` : null, d.outbox?.attempt ? (d.outbox.attempt === 1 ? "1 Attempt" : `${d.outbox.attempt} Attempts`) : null, "Accepted Means Gmail Took It, Not That It Was Read")}</div>
                </div></div>
              </div></div>
            </>
          )}

          <div className="sh2 sh2-quiet"><span className="t">History</span></div>
          <div className="pad-x"><div className="card list-card-ruled">
            {d.receipts.map((r) => (
              <div className="row" key={r.receipt_id}><div className="row-grow">
                <div className="conn-name">{r.exact_verb}</div>
                <div className="conn-meta">{facts(statusLine(r.state), r.actor_display, whenLine(r.occurred_at), r.error_code ? COMMAND_LINES[r.error_code as keyof typeof COMMAND_LINES] ?? r.error_code : null)}</div>
              </div></div>
            ))}
          </div></div>

          <div className="pad-x"><div className="card list-card-ruled">
            {d.undoable && <button className="row row-act" disabled={busy === "undo" || offline} onClick={() => void undo()}>{busy === "undo" ? "Undoing…" : UNDO}</button>}
            {kind && d.destination_id && onOpenItem && <button className={"row row-act" + (d.undoable ? " hub-quiet" : "")} onClick={() => onOpenItem(kind, d.destination_id!)}>{OPEN_DESTINATION}</button>}
            {kind && !d.destination_id && <div className="row"><div className="conn-name">{ITEM_REMOVED}</div></div>}
            <button className="row row-act hub-quiet" onClick={() => void copy()}>{COPY_RECEIPT}</button>
            {!d.receipts.every((r) => r.erased_at) && <button className="row row-act hub-danger" disabled={offline} onClick={() => setConfirming(true)}>{DELETE_RECEIPT}</button>}
          </div></div>
          <div className="hub-note">{ERASE_NOTE}</div>
        </>
      )}
      <div className="screen-foot" />
      {confirming && <ConfirmSheet title="Delete Receipt" line={`${ERASE_NOTE} · The Words Go, a Tombstone Stays`} verb="Delete Receipt" busy={busy === "erase"} onConfirm={() => void erase()} onCancel={() => setConfirming(false)} />}
    </div>
  );
}
