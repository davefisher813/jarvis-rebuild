// THE COMPOSER (docs/jarvis-unified, slice 07; IMPLEMENTATION-SPEC.md 08 E16,
// E17, E22; 09 M5; 11). Plain text, one account, To, Cc and Bcc, a subject, a
// body, attachments from the app's own storage. The words are saved on this
// device after a pause and on blur, then on the server with the revision this
// device last saw; a revision that moved on is a conflict with both copies in
// view and a choice, never a silent loss. Close keeps an inert draft; Discard
// is its own tap with Undo. Review Send is the only way out toward a send, and
// it is shut while offline, while an attachment is still uploading, and until
// there is a recipient. Nothing here sends.

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import PageHeader from "../shared/PageHeader";
import RowActionSheet from "../shared/RowActionSheet";
import { FieldRow, MenuRow, Row, TextRow, Tile } from "../shared/FormSheet";
import { Mail, Paperclip } from "../shared/icons";
import { rowDoor } from "../shared/rowDoor";
import { lineFor, type RpcClient } from "../substrate/commands/errors";
import { prepareUpload, validateUpload } from "../shared/fileStorage";
import type { FileStore } from "../files/FileStore";
import {
  ATTACH, ATTACH_FAILED, ATTACH_NEEDS_APP, ATTACH_TOO_MUCH, ATTACHMENTS_LABEL, ATTACHMENTS_WAIT, BAD_ADDRESS, BCC_LABEL, BODY_LABEL, CC_BCC, CC_LABEL, CLOSE_DRAFT, COMPOSE_TITLE,
  CONFLICT_TITLE, DISCARD_DRAFT, DRAFT_ONLY, EMAIL_TITLE, FROM_LABEL, KEEP_THIS_DRAFT, NEEDS_RECIPIENT, OFFLINE_SEND, OTHER_DEVICE, REMOVE_ATTACHMENT, REPLY, REVIEW_SEND, SAVE_FAILED, SAVED_HERE,
  NO_SUBJECT, SAVED_LINE, SAVING_LINE, SIGNATURE_OFFER_NOTE, SUBJECT_LABEL, THIS_DEVICE, TO_LABEL, UPLOADING, USE_NEWER_DRAFT, USE_SAVED_SIGNATURE,
} from "./copy";
import type { EmailAccount } from "./emailClient";
import { sizeLine } from "./format";
import EmailFacts from "./EmailFacts";
import {
  attachmentsBytes, badAddresses, canonicalFields, discardDraft, fieldsOf, MAX_ATTACHMENTS_BYTES, replaceSignature, reviewSend, saveDraft, saveLocalDraft, clearLocalDraft, sameFields, signatureUntouched, sha256Hex, splitAddresses,
  type AttachmentRef, type DraftFields, type DraftRow, type LocalDraft, type Review,
} from "./drafts";

export interface ComposeStart {
  /** The local store's key: the server id, or a device-made key before there is one. */
  localKey: string;
  draftId: string | null;
  accountId: string;
  fields: DraftFields;
  /** The server revision this device last saw. */
  revision: number | null;
  /** Who a reply answers, for the title line. */
  replyingTo?: string | null;
  /** The last send's refusal, when a failed draft is opened again. */
  failedLine?: string | null;
}

export const LOCAL_SAVE_MS = 500;
export const SERVER_SAVE_MS = 1000;

type SaveWord = "" | "local" | "saving" | "saved" | "failed";

export default function ComposeScreen({ client, userId, accounts, offline, fileStore, start, now, onBack, onReview, onDiscarded }: {
  client: RpcClient;
  userId: string;
  accounts: EmailAccount[];
  offline: boolean;
  fileStore: FileStore | null;
  start: ComposeStart;
  now: () => Date;
  /** Close: the draft stays, inert, saved where it could be. */
  onBack: () => void;
  onReview: (draftId: string, revision: number, fields: DraftFields, review: Review) => void;
  /** Discarded, with the copy an Undo can save again. */
  onDiscarded: (copy: { accountId: string; fields: DraftFields } | null) => void;
}) {
  const [fields, setFields] = useState<DraftFields>(() => canonicalFields(start.fields));
  const [accountId, setAccountId] = useState(start.accountId);
  const [draftId, setDraftId] = useState<string | null>(start.draftId);
  const [revision, setRevision] = useState<number | null>(start.revision);
  const [localKey, setLocalKey] = useState(start.localKey);
  const [toText, setToText] = useState(start.fields.to_addresses.join(", "));
  const [ccText, setCcText] = useState(start.fields.cc_addresses.join(", "));
  const [bccText, setBccText] = useState(start.fields.bcc_addresses.join(", "));
  const [ccOpen, setCcOpen] = useState(start.fields.cc_addresses.length > 0 || start.fields.bcc_addresses.length > 0);
  const [saveWord, setSaveWord] = useState<SaveWord>("");
  const [line, setLine] = useState<string | null>(start.failedLine ?? null);
  const [conflict, setConflict] = useState<DraftRow | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastServer = useRef<DraftFields | null>(start.revision !== null ? canonicalFields(start.fields) : null);
  const lastLocal = useRef<DraftFields>(canonicalFields(start.fields));
  const serverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const connected = accounts.filter((a) => a.state === "connected");

  // ---- the words this device holds -----------------------------------------
  const writeLocal = useCallback((f: DraftFields, serverSavedAt: string | null, id: string | null, key: string, rev: number | null) => {
    const copy: LocalDraft = { key, draft_id: id, account_id: accountId, fields: f, revision: rev, saved_at: now().toISOString(), server_saved_at: serverSavedAt };
    saveLocalDraft(userId, copy);
    lastLocal.current = f;
  }, [accountId, now, userId]);

  const flushLocal = useCallback(() => {
    if (localTimer.current) { clearTimeout(localTimer.current); localTimer.current = null; }
    if (sameFields(lastLocal.current, fields) && saveWord !== "") return;
    writeLocal(fields, lastServer.current && sameFields(lastServer.current, fields) ? now().toISOString() : null, draftId, localKey, revision);
    if (!(lastServer.current && sameFields(lastServer.current, fields))) setSaveWord((w) => (w === "saved" || w === "" ? "local" : w));
  }, [draftId, fields, localKey, now, revision, saveWord, writeLocal]);

  // ---- the server's copy, by revision ---------------------------------------
  const saveToServer = useCallback(async (f: DraftFields, expected: number | null): Promise<boolean> => {
    if (!client || offline || conflict) return false;
    setSaveWord("saving");
    const r = await saveDraft(client, draftId, accountId, f, expected);
    if (!live.current) return r.ok;
    if (!r.ok) {
      if (r.code === "DRAFT_CONFLICT") { setConflict(r.data.draft as DraftRow); setSaveWord("local"); return false; }
      if (r.code === "DRAFT_SENT") { setLine(lineFor(r)); setSaveWord("local"); return false; }
      setSaveWord("failed");
      return false;
    }
    const id = r.value.draft_id;
    lastServer.current = f;
    if (localKey !== id) { clearLocalDraft(userId, localKey); setLocalKey(id); }
    setDraftId(id);
    setRevision(r.value.revision);
    writeLocal(f, r.value.saved_at, id, id, r.value.revision);
    setSaveWord("saved");
    return true;
  }, [accountId, client, conflict, draftId, localKey, offline, userId, writeLocal]);

  const scheduleServer = useCallback((f: DraftFields) => {
    if (serverTimer.current) clearTimeout(serverTimer.current);
    serverTimer.current = setTimeout(() => { serverTimer.current = null; saving.current = saveToServer(f, revision).then(() => undefined); }, SERVER_SAVE_MS);
  }, [revision, saveToServer]);

  // Every change: the device after a pause, the server after a longer one.
  useEffect(() => {
    if (sameFields(lastLocal.current, fields) && (lastServer.current === null ? false : sameFields(lastServer.current, fields))) return;
    if (localTimer.current) clearTimeout(localTimer.current);
    localTimer.current = setTimeout(() => { localTimer.current = null; flushLocal(); }, LOCAL_SAVE_MS);
    if (!(lastServer.current && sameFields(lastServer.current, fields))) scheduleServer(fields);
    return () => { if (localTimer.current) clearTimeout(localTimer.current); };
    // The words themselves drive this; the callbacks are stable for a given revision.
  }, [fields]);

  // AC19: the still-untouched managed block is swapped in silence on an account switch; an edited one, or one
  // that was never there, is left alone, and the person gets a quiet explicit Use Saved Signature instead,
  // never a silent rewrite of words they wrote.
  const prevAccountId = useRef(accountId);
  const [sigOffer, setSigOffer] = useState<{ oldText: string; newText: string } | null>(null);
  const applySignature = () => {
    if (!sigOffer) return;
    const newAcct = accounts.find((a) => a.id === accountId) ?? null;
    setFields((f) => ({ ...f, body_text: replaceSignature(f.body_text, sigOffer.oldText, sigOffer.newText), signature_revision: newAcct?.signature_text ? newAcct.signature_revision : null }));
    setSigOffer(null);
  };

  // The account is part of the draft too; a switch also decides the signature.
  useEffect(() => {
    const prevId = prevAccountId.current;
    prevAccountId.current = accountId;
    if (prevId !== accountId) {
      const oldAcct = accounts.find((a) => a.id === prevId) ?? null;
      const newAcct = accounts.find((a) => a.id === accountId) ?? null;
      if (newAcct) {
        if (signatureUntouched(fields.body_text, fields.signature_revision, oldAcct)) {
          const nextBody = replaceSignature(fields.body_text, oldAcct!.signature_text, newAcct.signature_text);
          setFields((f) => ({ ...f, body_text: nextBody, signature_revision: newAcct.signature_text ? newAcct.signature_revision : null }));
          setSigOffer(null);
        } else {
          setSigOffer(newAcct.signature_text ? { oldText: oldAcct?.signature_text ?? "", newText: newAcct.signature_text } : null);
        }
      }
    }
    if (accountId !== start.accountId || lastServer.current) scheduleServer(fields);
    // Deliberately only accountId: this reacts to the switch itself, reading fields and accounts as they stand.
  }, [accountId]);

  const set = <K extends keyof DraftFields>(k: K, v: DraftFields[K]) => setFields((f) => ({ ...f, [k]: v }));
  const commitAddresses = () => {
    const to = splitAddresses(toText), cc = splitAddresses(ccText), bcc = splitAddresses(bccText);
    setToText(to.join(", ")); setCcText(cc.join(", ")); setBccText(bcc.join(", "));
    setFields((f) => ({ ...f, to_addresses: to, cc_addresses: cc, bcc_addresses: bcc }));
    return { to, cc, bcc };
  };
  const badTo = badAddresses(fields.to_addresses), badCc = badAddresses(fields.cc_addresses), badBcc = badAddresses(fields.bcc_addresses);

  // ---- attachments ------------------------------------------------------------
  const attach = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!fileStore) { setLine(ATTACH_NEEDS_APP); return; }
    for (const file of files) {
      const why = validateUpload(file.size, file.type);
      if (why) { setLine(why); continue; }
      if (attachmentsBytes(fields.attachment_refs) + file.size > MAX_ATTACHMENTS_BYTES) { setLine(ATTACH_TOO_MUCH); continue; }
      setUploading((u) => [...u, file.name]);
      try {
        const prepared = await prepareUpload(file);
        const sha256 = await sha256Hex(prepared.bytes);
        const stored = await fileStore.upload("draft-" + (draftId ?? localKey.replace(/[^a-z0-9]/gi, "")), file);
        const ref: AttachmentRef = { storage_id: stored.path, filename: stored.name, size_bytes: stored.bytes, sha256, mime_type: stored.mime };
        if (!live.current) return;
        setFields((f) => ({ ...f, attachment_refs: [...f.attachment_refs, ref] }));
        setLine(null);
      } catch {
        if (live.current) setLine(ATTACH_FAILED);
      } finally {
        if (live.current) setUploading((u) => u.filter((n) => n !== file.name));
      }
    }
  };
  const [removing, setRemoving] = useState<AttachmentRef | null>(null);
  const removeAttachment = (ref: AttachmentRef) => {
    setFields((f) => ({ ...f, attachment_refs: f.attachment_refs.filter((r) => r.storage_id !== ref.storage_id) }));
    void fileStore?.remove([ref.storage_id]);
  };

  // ---- the doors --------------------------------------------------------------
  const review = async () => {
    if (reviewing) return;
    const { to, cc, bcc } = commitAddresses();
    const f = { ...fields, to_addresses: to, cc_addresses: cc, bcc_addresses: bcc };
    if (to.length === 0) { setLine(NEEDS_RECIPIENT); return; }
    if (badAddresses([...to, ...cc, ...bcc]).length) { setLine(BAD_ADDRESS); return; }
    if (uploading.length) { setLine(ATTACHMENTS_WAIT); return; }
    if (attachmentsBytes(f.attachment_refs) > MAX_ATTACHMENTS_BYTES) { setLine(ATTACH_TOO_MUCH); return; }
    if (offline) { setLine(OFFLINE_SEND); flushLocal(); return; }
    setReviewing(true);
    setLine(null);
    if (serverTimer.current) { clearTimeout(serverTimer.current); serverTimer.current = null; }
    if (saving.current) await saving.current;
    let id = draftId, rev = revision;
    if (!lastServer.current || !sameFields(lastServer.current, f) || id === null) {
      const r = await saveDraft(client, id, accountId, f, rev);
      if (!live.current) return;
      if (!r.ok) {
        setReviewing(false);
        if (r.code === "DRAFT_CONFLICT") { setConflict(r.data.draft as DraftRow); return; }
        setLine(lineFor(r));
        return;
      }
      id = r.value.draft_id; rev = r.value.revision;
      lastServer.current = f;
      if (localKey !== id) { clearLocalDraft(userId, localKey); setLocalKey(id); }
      setDraftId(id); setRevision(rev); writeLocal(f, r.value.saved_at, id, id, rev); setSaveWord("saved");
    }
    const rv = await reviewSend(client, id, rev);
    if (!live.current) return;
    setReviewing(false);
    if (!rv.ok) {
      if (rv.code === "DRAFT_CONFLICT") { setConflict(rv.data.draft as DraftRow); return; }
      if (rv.code === "MISSING_DETAILS") { setLine(NEEDS_RECIPIENT); return; }
      if (rv.code === "INVALID_PAYLOAD" && (rv.detail === "to" || rv.detail === "cc" || rv.detail === "bcc")) { setLine(BAD_ADDRESS); return; }
      setLine(lineFor(rv));
      return;
    }
    onReview(id, rev ?? rv.value.draft_revision, f, rv.value);
  };

  const close = async () => {
    commitAddresses();
    flushLocal();
    if (serverTimer.current) { clearTimeout(serverTimer.current); serverTimer.current = null; }
    if (!offline && client && !conflict && !(lastServer.current && sameFields(lastServer.current, fields))) await saveToServer(fields, revision);
    onBack();
  };

  const discard = async () => {
    if (serverTimer.current) { clearTimeout(serverTimer.current); serverTimer.current = null; }
    if (localTimer.current) { clearTimeout(localTimer.current); localTimer.current = null; }
    clearLocalDraft(userId, localKey);
    if (draftId && client && !offline) await discardDraft(client, draftId);
    onDiscarded({ accountId, fields });
  };

  const keepThis = async () => {
    const server = conflict;
    setConflict(null);
    if (!server) return;
    // A plain save at the newer revision: this device's words win, on purpose.
    const r = await saveDraft(client, server.id, accountId, fields, null);
    if (!live.current) return;
    if (!r.ok) { setLine(lineFor(r)); return; }
    lastServer.current = fields;
    setDraftId(server.id); setRevision(r.value.revision); writeLocal(fields, r.value.saved_at, server.id, server.id, r.value.revision); setSaveWord("saved");
  };
  const useNewer = () => {
    const server = conflict;
    setConflict(null);
    if (!server) return;
    const f = fieldsOf(server);
    lastServer.current = f;
    lastLocal.current = f;
    setFields(f); setToText(f.to_addresses.join(", ")); setCcText(f.cc_addresses.join(", ")); setBccText(f.bcc_addresses.join(", "));
    setDraftId(server.id); setRevision(server.revision); writeLocal(f, server.saved_at, server.id, server.id, server.revision); setSaveWord("saved");
  };

  const saveLine = saveWord === "saving" ? SAVING_LINE : saveWord === "saved" ? SAVED_LINE : saveWord === "local" ? SAVED_HERE : saveWord === "failed" ? SAVE_FAILED : DRAFT_ONLY;
  const canReview = !reviewing && !conflict && uploading.length === 0;
  const title = start.replyingTo ? REPLY : COMPOSE_TITLE;

  return (
    <div className="screen ruled email-compose">
      <PageHeader title={title} back={EMAIL_TITLE} onBack={() => void close()} />
      {/* 2026-10-05: the name alone. "Reply · Name" said "Reply" again under a page already titled Reply. */}
      {start.replyingTo && <div className="email-note quiet"><EmailFacts wrap facts={[{ text: start.replyingTo }]} /></div>}
      <div className="pad-x"><div className="card xs-group xs">
        {connected.length > 1 ? (
          <MenuRow tone="teal" glyph={<Mail className="ic" />} label={FROM_LABEL} value={accountId} options={connected.map((a) => ({ value: a.id, label: a.address }))} onPick={(v) => setAccountId(v)} ariaLabel={FROM_LABEL} word={account?.address ?? ""} />
        ) : (
          <Row tone="teal" glyph={<Mail className="ic" />} label={FROM_LABEL} meta={account?.address ?? ""} />
        )}
        <FieldRow label={TO_LABEL} value={toText} onChange={setToText} placeholder="name@example.com" ariaLabel={TO_LABEL} error={badTo.length > 0} />
        {!ccOpen && <div className="row xs-row email-ccbcc" {...rowDoor(() => setCcOpen(true))}><div className="conn-name">{CC_BCC}</div><div className="chev"></div></div>}
        {ccOpen && <FieldRow label={CC_LABEL} value={ccText} onChange={setCcText} ariaLabel={CC_LABEL} error={badCc.length > 0} />}
        {ccOpen && <FieldRow label={BCC_LABEL} value={bccText} onChange={setBccText} ariaLabel={BCC_LABEL} error={badBcc.length > 0} />}
        <FieldRow label={SUBJECT_LABEL} value={fields.subject} onChange={(v) => set("subject", v)} ariaLabel={SUBJECT_LABEL} />
        <div onBlur={commitAddresses} className="email-body-row">
          <TextRow value={fields.body_text} onChange={(v) => set("body_text", v)} placeholder={BODY_LABEL} ariaLabel={BODY_LABEL} rows={8} />
        </div>
      </div></div>
      <div className="pad-x" onBlur={commitAddresses} />

      {/* AC19: an edited or absent managed block is never silently rewritten; this is the explicit Replace choice
          (Dave's locked row-actions rule: a quiet text action in the key colour, never a capsule). */}
      {sigOffer && <div className="email-note quiet"><span>{SIGNATURE_OFFER_NOTE}</span><button className="quiet-action" onClick={applySignature}>{USE_SAVED_SIGNATURE}</button></div>}

      <div className="pad-x"><div className="card list-card-ruled">
        {fields.attachment_refs.length > 0 && <div className="eyebrow email-eyebrow">{ATTACHMENTS_LABEL}</div>}
        {fields.attachment_refs.map((r) => (
          // 2026-10-05 (Dave, locked: clean rows, no pills): the row is a door. Tap opens its sheet, and Remove is in it,
          // so a stray tap on the row removes nothing and no control sits inside the row.
          <div className="row" key={r.storage_id} {...rowDoor(() => setRemoving(r))} aria-label={`${r.filename} · ${sizeLine(r.size_bytes)}`}>
            <div className="row-grow">
              <div className="conn-name truncate">{r.filename}</div>
              {/* A white size is the row's only fact. The file type repeated the extension. */}
              <EmailFacts facts={[{ text: sizeLine(r.size_bytes), strong: true }]} />
            </div>
            <div className="chev"></div>
          </div>
        ))}
        {uploading.map((n) => (
          <div className="row" key={"up-" + n}><div className="row-grow"><div className="conn-name truncate">{n}</div><div className="facts"><span className="fact">{UPLOADING}</span></div></div></div>
        ))}
        {fileStore ? (
          <div className="row" {...rowDoor(() => fileInput.current?.click())}><Tile tone="blue"><Paperclip className="ic" /></Tile><div className="conn-name">{ATTACH}</div><div className="chev"></div></div>
        ) : (
          <div className="row"><div className="row-grow"><div className="conn-name">{ATTACH}</div><div className="facts"><span className="fact">{ATTACH_NEEDS_APP}</span></div></div></div>
        )}
        <input ref={fileInput} type="file" multiple className="email-file-input" aria-label={ATTACH} onChange={(e) => void attach(e)} />
      </div></div>

      {conflict && (
        <div className="pad-x"><div className="card list-card-ruled email-conflict">
          {/* 2026-10-05: the kicker is the label ("Edited on Another Device"); the old one was a whole sentence in caps with its
              instruction ("Choose Which Draft to Keep") under two buttons that say it. Each copy is its subject, then its words. */}
          <div className="eyebrow email-eyebrow">{CONFLICT_TITLE}</div>
          <dl className="email-compare">
            <dt>{THIS_DEVICE}</dt><dd>{fields.subject || NO_SUBJECT}{fields.body_text && <EmailFacts wrap facts={[{ text: fields.body_text.slice(0, 160) }]} />}</dd>
            <dt>{OTHER_DEVICE}</dt><dd>{conflict.subject || NO_SUBJECT}{conflict.body_text && <EmailFacts wrap facts={[{ text: conflict.body_text.slice(0, 160) }]} />}</dd>
          </dl>
          <div className="email-sheet-acts">
            <button className="quiet-action" onClick={() => void keepThis()}>{KEEP_THIS_DRAFT}</button>
            <button className="quiet-action" onClick={useNewer}>{USE_NEWER_DRAFT}</button>
          </div>
        </div></div>
      )}

      {/* 2026-10-05: a refusal is an error line (the key's red, 14px), not a quiet note in a raw brown; the plain save state stays the quiet note. */}
      {saveWord === "failed" ? <div className="pad-x"><div className="input-error" role="alert">{saveLine}</div></div> : <div className="email-note quiet"><span>{saveLine}</span></div>}
      {line && <div className="pad-x"><div className="input-error" role="alert">{line}</div></div>}
      {offline && <div className="email-note quiet"><span>{OFFLINE_SEND}</span></div>}
      <div className="email-sheet-acts email-compose-acts">
        <button className="btn btn-primary" onClick={() => void review()} disabled={!canReview || offline}>{REVIEW_SEND}</button>
        <button className="quiet-action" onClick={() => void close()}>{CLOSE_DRAFT}</button>
        <button className="quiet-action" onClick={() => void discard()}>{DISCARD_DRAFT}</button>
      </div>
      <div className="screen-foot" />
      {removing && (
        <RowActionSheet
          title={removing.filename}
          actions={[{ label: REMOVE_ATTACHMENT, destructive: true, onPick: () => removeAttachment(removing) }]}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

