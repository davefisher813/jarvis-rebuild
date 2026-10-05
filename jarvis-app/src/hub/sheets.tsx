// THE HUB'S SMALL SHEETS, on the shared form sheet kit: a name for a new
// assistant, a reason for a withdrawal, a pasted conversation, and one
// confirmation for the single destructive verb (deleting a receipt).

import { useState } from "react";
import { FormSheet, Group, FieldRow, TextRow, Note, ErrorLine } from "../shared/FormSheet";
import { COMMAND_LINES } from "../substrate/commands/errors";
import { EXPORT_DISCLOSURE } from "../substrate/context/exportImport";
import HubFacts from "./HubFacts";
import { IMPORT_LANDS } from "./copy";

export function AddAssistantSheet({ onSave, onCancel, busy = false }: { onSave: (name: string) => void; onCancel: () => void; busy?: boolean }) {
  const [name, setName] = useState("");
  const [tried, setTried] = useState(false);
  const missing = name.trim().length === 0;
  return (
    <FormSheet title="Add Assistant" onCancel={onCancel} saveLabel={busy ? "Adding…" : "Add"} saveDisabled={missing || busy}
      onSave={() => { setTried(true); if (!missing && !busy) onSave(name.trim()); }}>
      <Group label="Name">
        <FieldRow value={name} onChange={setName} placeholder="Claude, ChatGPT, a Colleague" ariaLabel="Assistant name" error={tried && missing} right={false} />
      </Group>
      <Note>Manual · You Export Context to It and Paste Back What It Suggests · No Token, No Direct Access</Note>
      {tried && missing && <ErrorLine text={COMMAND_LINES.MISSING_DETAILS} />}
    </FormSheet>
  );
}

export function WithdrawSheet({ title, onSave, onCancel, busy = false }: { title: string; onSave: (reason: string) => void; onCancel: () => void; busy?: boolean }) {
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const missing = reason.trim().length === 0;
  return (
    <FormSheet title="Withdraw Decision" onCancel={onCancel} saveLabel={busy ? "Withdrawing…" : "Withdraw Decision"} saveDisabled={missing || busy}
      onSave={() => { setTried(true); if (!missing && !busy) onSave(reason.trim()); }}>
      <Group label="Decision"><div className="row"><div className="conn-name">{title}</div></div></Group>
      <Group label="Why">
        <TextRow value={reason} onChange={setReason} placeholder="What Changed" ariaLabel="Reason for withdrawing" />
      </Group>
      <Note>Withdrawn Decisions No Longer Guide New Plans · The History and Every Related Record Stay</Note>
      {tried && missing && <ErrorLine text={COMMAND_LINES.MISSING_DETAILS} />}
    </FormSheet>
  );
}

export function ImportSheet({ projectTitle, onSave, onCancel, busy = false, error }: { projectTitle: string; onSave: (text: string) => void; onCancel: () => void; busy?: boolean; error?: string | null }) {
  const [text, setText] = useState("");
  const empty = text.trim().length === 0;
  return (
    <FormSheet title="Paste a Conversation" onCancel={onCancel} saveLabel={busy ? "Importing…" : "Import"} saveDisabled={empty || busy}
      onSave={() => { if (!empty && !busy) onSave(text); }}>
      <Group label="Into">
        <div className="row"><div className="row-grow"><div className="conn-name">{projectTitle}</div><HubFacts facts={[{ text: IMPORT_LANDS }]} /></div></div>
      </Group>
      <Group label="The Words">
        <TextRow value={text} onChange={setText} placeholder="A JARVIS Context Response or the Conversation Itself" ariaLabel="Pasted conversation" rows={8} />
      </Group>
      <Note>{EXPORT_DISCLOSURE}</Note>
      {error && <ErrorLine text={error} />}
    </FormSheet>
  );
}

export function ConfirmSheet({ title, line, verb, onConfirm, onCancel, busy = false }: { title: string; line: string; verb: string; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  return (
    <FormSheet title={title} onCancel={onCancel} saveLabel={busy ? "Working…" : verb} saveDisabled={busy} onSave={() => { if (!busy) onConfirm(); }}>
      <Note>{line}</Note>
    </FormSheet>
  );
}
