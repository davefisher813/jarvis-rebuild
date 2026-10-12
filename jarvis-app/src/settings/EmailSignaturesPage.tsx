import { useCallback, useEffect, useState } from "react";
import SkeletonRows from "../shared/SkeletonRows";
import { Mail } from "../shared/icons";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Head, Card, Row, Foot } from "./kit";
import { supabase } from "../auth/supabaseClient";
import { useUserId } from "../data/NotesProvider";
import { lineFor, type RpcClient } from "../substrate/commands/errors";
import { listAccounts, type EmailAccount } from "../email/emailClient";
import SignatureSheet from "../email/SignatureSheet";
import { announceSignature } from "../email/signatureBus";
import { MAILBOXES, NO_SIGNATURE, SIGNATURES_FOOT, SIGNATURES_TITLE } from "../email/copy";

// EMAIL SIGNATURES (Email v1 fix order item 2, 2026-10-11). The per-account
// signature editor lives here, in Settings, where a person looks for it. It
// used to hide behind Email, Accounts, More Actions, and both of Dave's
// accounts were left empty. One row per mailbox shows the saved signature's
// first line (or Not Set); a tap opens the same editor the Accounts menu uses.
// A save is announced (signatureBus) so an Email tab already open picks the
// new text up for the next compose without a reload.

/** The first non-empty line of a signature, for the row. */
export function signaturePreview(text: string): string {
  return text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
}

// A CRAFTED LOADING AND EMPTY STATE (2026-10-12, V14): the page was blank while the mailboxes loaded and blank when there
// were none. It now draws skeleton rows while it asks, a glyph, a title and a door to Connections when no mailbox is
// connected, and the failure with Try Again when the read did not land.
export const NO_MAILBOXES_TITLE = "No Mailboxes Connected";
export const NO_MAILBOXES_SUB = "Connect Gmail and Each Mailbox Gets Its Own Signature";
export const OPEN_CONNECTIONS = "Open Connections";
export const LOAD_FAILED_TITLE = "Couldn't Load Your Mailboxes";
export const TRY_AGAIN = "Try Again";

export default function EmailSignaturesPage({ onBack, onOpenConnections, client: given, userId: givenUser }: {
  onBack: () => void;
  /** Settings, Connections: the empty state's door. */
  onOpenConnections?: () => void;
  /** A test passes its own; undefined means the app's. */
  client?: RpcClient | null;
  userId?: string;
}) {
  const client: RpcClient | null = given === undefined ? supabase : given;
  const ctxUser = useUserId();
  const userId = givenUser ?? ctxUser ?? "";
  const [accounts, setAccounts] = useState<EmailAccount[] | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [editing, setEditing] = useState<EmailAccount | null>(null);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // No mailbox client at all: nothing can be connected from here, so it is the empty state, never a blank page.
    if (!client) { setAccounts([]); return; }
    let alive = true;
    setLine(null);
    void listAccounts(client).then((r) => {
      if (!alive) return;
      if (r.ok) setAccounts(r.value.filter((a) => a.state !== "disconnected"));
      else setLine(lineFor(r));
    });
    return () => { alive = false; };
  }, [client, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const loading = accounts === null && line === null;
  const failed = accounts === null && line !== null;

  return (
    <div className="screen ruled">
      <LargeTitleNav title={SIGNATURES_TITLE} back="Settings" onBack={onBack} />
      {accounts && accounts.length > 0 && (
        <>
          <Head label={MAILBOXES} count={accounts.length} />
          <Card>
            {accounts.map((a) => (
              <Row key={a.id} label={a.address} meta={signaturePreview(a.signature_text) || NO_SIGNATURE} chev onClick={() => setEditing(a)} />
            ))}
          </Card>
          <Foot>{SIGNATURES_FOOT}</Foot>
        </>
      )}
      {loading && <SkeletonRows rows={2} />}
      {/* One empty state, two causes: no connected mailbox (its door is Connections) or a read that did not land (Try Again). */}
      {(failed || (accounts !== null && accounts.length === 0)) && (
        <div className="empty-state empty-compact">
          <div className="empty-icon cat-fg-teal"><Mail className="ic" /></div>
          <div className="empty-title">{failed ? LOAD_FAILED_TITLE : NO_MAILBOXES_TITLE}</div>
          <div className="empty-sub">{failed ? line : NO_MAILBOXES_SUB}</div>
          {(failed || onOpenConnections) && <button className="btn btn-primary" onClick={failed ? retry : onOpenConnections}>{failed ? TRY_AGAIN : OPEN_CONNECTIONS}</button>}
        </div>
      )}
      {editing && client && (
        <SignatureSheet client={client} userId={userId} account={editing} onClose={() => setEditing(null)}
          onSaved={(accountId, text, revision) => {
            setAccounts((prev) => (prev ?? []).map((a) => (a.id === accountId ? { ...a, signature_text: text, signature_revision: revision } : a)));
            announceSignature({ accountId, text, revision });
          }} />
      )}
      <div className="screen-foot" />
    </div>
  );
}
