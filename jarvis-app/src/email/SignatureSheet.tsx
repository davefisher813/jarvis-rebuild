// EDIT A SAVED SIGNATURE (Email v1 spec section 6; Dave's locked decision L3:
// "One saved plain-text signature per provider account... Settings exposes
// exact text and Save."). One field, plain text, empty is a valid explicit
// save. Reached from AccountsScreen's row menu, never from the row's own tap
// target (that still opens Connections).

import { useState } from "react";
import { FormSheet, Group, TextRow, ErrorLine, Note } from "../shared/FormSheet";
import { lineFor, type RpcClient } from "../substrate/commands/errors";
import { setSignature, type EmailAccount } from "./emailClient";
import { showToast } from "../shared/toast";
import { EDIT_SIGNATURE, SIGNATURE_LABEL, SIGNATURE_NOTE, SIGNATURE_SAVED } from "./copy";

export default function SignatureSheet({ client, userId, account, onClose, onSaved }: {
  client: RpcClient;
  userId: string;
  account: EmailAccount;
  onClose: () => void;
  /** The server's new signature_text and signature_revision, once saved. */
  onSaved: (accountId: string, text: string, revision: number) => void;
}) {
  const [text, setText] = useState(account.signature_text);
  const [line, setLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setLine(null);
    const r = await setSignature(client, userId, account.id, text, account.signature_revision);
    setBusy(false);
    if (!r.ok) { setLine(lineFor(r)); return; }
    onSaved(account.id, r.value.signature_text, r.value.signature_revision);
    showToast({ message: SIGNATURE_SAVED });
    onClose();
  };

  return (
    <FormSheet title={EDIT_SIGNATURE} onCancel={onClose} onSave={() => void save()} saveDisabled={busy} dirty={text !== account.signature_text}>
      <div className="email-note quiet"><span>{account.address}</span></div>
      <Group label={SIGNATURE_LABEL}>
        <TextRow value={text} onChange={setText} placeholder={SIGNATURE_LABEL} ariaLabel={SIGNATURE_LABEL} rows={5} />
        <Note>{SIGNATURE_NOTE}</Note>
      </Group>
      <ErrorLine text={line} />
    </FormSheet>
  );
}
