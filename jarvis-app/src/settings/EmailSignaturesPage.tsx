import { useEffect, useState } from "react";
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

export default function EmailSignaturesPage({ onBack, client: given, userId: givenUser }: {
  onBack: () => void;
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

  useEffect(() => {
    if (!client) return;
    let alive = true;
    void listAccounts(client).then((r) => {
      if (!alive) return;
      if (r.ok) setAccounts(r.value.filter((a) => a.state !== "disconnected"));
      else setLine(lineFor(r));
    });
    return () => { alive = false; };
  }, [client]);

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
      {line && <Foot>{line}</Foot>}
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
