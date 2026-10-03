// ONE MESSAGE (docs/jarvis-unified, slice 05; IMPLEMENTATION-SPEC.md 08 E05,
// E06, E20, E22, E23, E29; 09 M2; 13). The sender's words, inert: the HTML
// goes through the app's sanitiser into a frame that runs nothing, the text
// is drawn as text. Opening marks the message read through a user-origin
// provider command; the badge comes back and Retry shows if Gmail refused.
// Archive and Move to Trash are explicit taps in the More menu, offered only
// when the account can do them, each with a receipt and an Undo that is
// itself a verified provider command. Open in Gmail is exact when the thread
// id is Gmail's; otherwise the button says Open Gmail and says why. Nothing
// here captures, extracts or infers; a card is slice 06's.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import RowActionSheet, { type RowAction } from "../shared/RowActionSheet";
import SkeletonRows from "../shared/SkeletonRows";
import { MoreHorizontal } from "../shared/icons";
import { rowDoor } from "../shared/rowDoor";
import { showToast } from "../shared/toast";
import { saveFile } from "../shared/saveFile";
import { lineFor, type CommandFailure } from "../substrate/commands/errors";
import MailHtmlView from "../messages/MailHtmlView";
import { openExternal } from "../messages/openExternal";
import { whenLine } from "../hub/format";
import type { Category } from "../categories/types";
import {
  ARCHIVE, ATTACHMENTS, ATTACHMENT_FAILED, ATTACHMENT_SAVED, ATTACHMENT_SHARED, ATTACHMENT_TOO_BIG, BODY_PENDING, COPIED_ID, COPY_ID, DOWNLOADING,
  EMAIL_TITLE, FILE_UNDER, GENERIC_WHY, HIDE_HEADERS, MARK_READ, MARK_UNREAD, MESSAGE_TITLE, MORE_LABEL, NO_BODY_OFFLINE, OPEN_GMAIL_EXACT, OPEN_GMAIL_GENERIC,
  IMAGES_OFF, PUT_BACK, READ_CONFLICT, READ_FAILED, RESTORED, RETRY, SHOW_HEADERS, SHOW_IMAGES, SOURCE_GONE, TRASH, UNREAD_FAILED, UNSUPPORTED_ACTION,
  FORWARD_IN_GMAIL, FORWARD_WHY, REPLY, REPLY_ALL,
} from "./copy";
import { attachmentBlob, downloadAttachment, gmailLink, labelMessage, openMessage, readMessage, type AttachmentMeta, type EmailAccount, type InboxRow, type MessageDetail, type RpcClient } from "./emailClient";
import { loadMessage, saveMessage } from "./deviceCache";
import { hasRemoteImages, senderOf, sizeLine } from "./format";
import { textOf } from "./candidates";

const MAX_ATTACHMENT = 20 * 1024 * 1024;

/** Somebody besides the person and the sender was on the message: Reply All has a reason to exist. */
export function othersOn(m: Pick<MessageDetail, "from_address" | "to_addresses" | "cc_addresses">, account: Pick<EmailAccount, "address"> | null): boolean {
  const mine = (account?.address ?? "").toLowerCase();
  const from = m.from_address.toLowerCase();
  return [...m.to_addresses, ...m.cc_addresses].some((a) => { const x = a.address.toLowerCase(); return x && x !== mine && x !== from; });
}

export interface LeftInbox {
  op: "archive" | "trash";
  /** The reverse provider command (unarchive, untrash). True when Gmail confirmed it. */
  undo: () => Promise<boolean>;
  /** What the row looks like once it is back. */
  restored: Partial<InboxRow>;
}

export default function MessageScreen({ client, token, userId, row, account, offline, categories, categoryId, onBack, onRowChanged, onLeftInbox, onFileUnder, cards, moreActions, onBodyText, onReply }: {
  client: RpcClient;
  token: string | null | undefined;
  userId: string;
  /** The list's row, so the header draws before the read lands. */
  row: InboxRow;
  account: EmailAccount | null;
  offline: boolean;
  categories: Category[];
  categoryId: string | null;
  onBack: () => void;
  /** The list follows the provider: read state, labels. */
  onRowChanged: (patch: Partial<InboxRow> & { id: string }) => void;
  /** Archived or trashed: the row leaves the inbox; the flow shows the toast whose Undo is the reverse provider command. */
  onLeftInbox: (row: InboxRow, info: LeftInbox) => void;
  onFileUnder: (row: InboxRow, categoryId: string) => void;
  /** The message's cards (slice 06), drawn by the flow. */
  cards?: ReactNode;
  /** Extra rows for the More menu (Find Useful Details, Capture, dismissed suggestions). */
  moreActions?: RowAction[];
  /** The body as text, once it is known, for the rules to read. */
  onBodyText?: (text: string) => void;
  /** Reply and Reply All (slice 07): the composer opens with the message's own headers. */
  onReply?: (m: MessageDetail, all: boolean) => void;
}) {
  const [detail, setDetail] = useState<MessageDetail | null>(() => loadMessage(userId, row.id));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CommandFailure | null>(null);
  const [fetchingBody, setFetchingBody] = useState(false);
  const [readLine, setReadLine] = useState<string | null>(null);
  const [readRetry, setReadRetry] = useState<(() => void) | null>(null);
  const [headers, setHeaders] = useState(false);
  const [more, setMore] = useState(false);
  const [filing, setFiling] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [attachmentLine, setAttachmentLine] = useState<string | null>(null);
  const [gmailWhy, setGmailWhy] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const marked = useRef(false);

  const keep = useCallback((m: MessageDetail) => {
    setDetail(m);
    saveMessage(userId, m);
  }, [userId]);

  // Mark read: the open is the person's tap (E06). Optimistic in the list,
  // undone with Retry when Gmail refuses; a conflicting remote state shows
  // "Read status updated in Gmail" rather than pretending (11).
  const markRead = useCallback(async (m: MessageDetail) => {
    if (!token || offline) return;
    onRowChanged({ id: m.id, read: true });
    const r = await labelMessage(token, m.account, m.provider_id, "read");
    if (!r.ok) {
      onRowChanged({ id: m.id, read: false });
      setReadLine(`${READ_FAILED} · ${lineFor(r)}`);
      setReadRetry(() => () => { setReadLine(null); setReadRetry(null); void markRead(m); });
      return;
    }
    setDetail((d) => (d ? { ...d, read: r.value.read, provider_labels: r.value.labels } : d));
    onRowChanged({ id: m.id, read: r.value.read, provider_labels: r.value.labels });
  }, [token, offline, onRowChanged]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const r = await readMessage(client, row.id);
      if (!alive) return;
      if (!r.ok) { setError(r); setLoading(false); return; }
      let m = r.value;
      // The list said unread and the cache says read: another device read it
      // first. Say so once, and do not send a command Gmail already answered.
      if (!row.read && m.read) setReadLine(READ_CONFLICT);
      if (!m.has_body && token && !offline) {
        setFetchingBody(true);
        const opened = await openMessage(token, m.account, m.provider_id);
        if (!alive) return;
        setFetchingBody(false);
        if (opened.ok) {
          const again = await readMessage(client, row.id);
          if (!alive) return;
          if (again.ok) m = again.value;
          const wasUnreadRemotely = opened.value.labels.includes("UNREAD");
          if (!row.read && !wasUnreadRemotely) setReadLine(READ_CONFLICT);
        }
      }
      keep(m);
      setLoading(false);
      if (!m.read && !marked.current) { marked.current = true; void markRead(m); }
    })();
    return () => { alive = false; };
    // One read per open: the row id is the key, the rest is read inside.
  }, [client, row.id]);

  const m = detail;
  const link = useMemo(() => gmailLink(row.account, m?.thread_id ?? row.thread_id), [row.account, row.thread_id, m?.thread_id]);
  const toldRules = useRef<string | null>(null);
  useEffect(() => {
    if (!m || !onBodyText || !m.has_body) return;
    const key = `${m.id}:${m.source_hash}`;
    if (toldRules.current === key) return;
    toldRules.current = key;
    onBodyText(textOf(m));
  }, [m, onBodyText]);
  const can = (what: "archive" | "trash") => !!account?.capabilities?.[what];

  const toggleUnread = async () => {
    if (!m || !token) return;
    const op = m.read ? "unread" : "read";
    setBusy(op);
    const r = await labelMessage(token, m.account, m.provider_id, op);
    setBusy(null);
    if (!r.ok) { showToast({ message: `${op === "unread" ? UNREAD_FAILED : READ_FAILED} · ${lineFor(r)}` }); return; }
    keep({ ...m, read: r.value.read, provider_labels: r.value.labels });
    onRowChanged({ id: m.id, read: r.value.read, provider_labels: r.value.labels });
  };

  // Archive or trash: the provider's answer is the truth, a receipt lands on
  // the server, the row leaves the inbox, and Undo is the reverse command.
  const leave = async (op: "archive" | "trash") => {
    if (!m || !token) return;
    setBusy(op);
    const r = await labelMessage(token, m.account, m.provider_id, op);
    setBusy(null);
    if (!r.ok) { showToast({ message: lineFor(r) }); return; }
    const undoOp = op === "archive" ? "unarchive" : "untrash";
    const undo = async (): Promise<boolean> => {
      const back = await labelMessage(token, m.account, m.provider_id, undoOp);
      if (!back.ok) { showToast({ message: lineFor(back) }); return false; }
      showToast({ message: op === "archive" ? PUT_BACK : RESTORED });
      return true;
    };
    onLeftInbox({ ...row, provider_labels: r.value.labels, read: r.value.read }, { op, undo, restored: { provider_labels: [...r.value.labels.filter((l) => l !== "TRASH"), "INBOX"] } });
    onBack();
  };

  const download = async (a: AttachmentMeta) => {
    if (!m || !token) return;
    setAttachmentLine(null);
    if (a.size > MAX_ATTACHMENT) { setAttachmentLine(ATTACHMENT_TOO_BIG); return; }
    setDownloading(a.attachmentId);
    const r = await downloadAttachment(token, m.account, m.provider_id, a.attachmentId);
    setDownloading(null);
    if (!r.ok) { setAttachmentLine(r.data.status === 413 ? ATTACHMENT_TOO_BIG : `${ATTACHMENT_FAILED} · ${lineFor(r)}`); return; }
    try {
      const saved = await saveFile(attachmentBlob(r.value), r.value.filename || a.filename, { title: a.filename });
      if (saved) showToast({ message: `${saved === "shared" ? ATTACHMENT_SHARED : ATTACHMENT_SAVED} · ${a.filename}` });
    } catch {
      setAttachmentLine(ATTACHMENT_FAILED);
    }
  };

  const copyId = async () => {
    try { await navigator.clipboard?.writeText(`${row.account} · ${row.provider_id}`); showToast({ message: COPIED_ID }); } catch { /* no clipboard here */ }
  };

  const openGmail = () => {
    if (!link.exact) setGmailWhy(true);
    openExternal(link.href);
  };

  const actions: RowAction[] = [
    { label: m?.read === false ? MARK_READ : MARK_UNREAD, onPick: () => void toggleUnread(), disabled: !token || offline || !m },
    { label: FILE_UNDER, onPick: () => setFiling(true), disabled: categories.length === 0 },
    { label: ARCHIVE, onPick: () => void leave("archive"), disabled: !can("archive") || !token || offline || !m },
    { label: TRASH, onPick: () => void leave("trash"), disabled: !can("trash") || !token || offline || !m, destructive: true },
    { label: COPY_ID, onPick: () => void copyId() },
    // Forwarding and rich formatting stay in Gmail (11): the honest door, said so.
    { label: FORWARD_IN_GMAIL, onPick: () => { showToast({ message: FORWARD_WHY }); openGmail(); } },
    ...(moreActions ?? []),
  ];

  const attachments = m?.attachments?.length ? m.attachments : row.attachment_metadata;

  return (
    <div className="screen ruled">
      <PageHeader title={MESSAGE_TITLE} back={EMAIL_TITLE} onBack={onBack}
        actions={<BarAction label={MORE_LABEL} onClick={() => setMore(true)}><MoreHorizontal className="ic" /></BarAction>} />

      <div className="email-head">
        <div className="email-subject">{(m?.subject ?? row.subject).trim() || "(No Subject)"}</div>
        <div className="email-meta">{senderOf(m ?? row)} · {whenLine(m?.internal_date ?? row.internal_date)}</div>
        <div className="email-meta">{row.account}{categoryId ? ` · ${categories.find((c) => c.id === categoryId)?.data.name ?? ""}` : ""}</div>
        <button className="quiet-action" onClick={() => setHeaders((h) => !h)}>{headers ? HIDE_HEADERS : SHOW_HEADERS}</button>
      </div>
      {onReply && m && !m.deleted && (
        <div className="email-reply-acts">
          <button className="btn-primary" onClick={() => onReply(m, false)} disabled={offline || !account || account.state !== "connected"}>{REPLY}</button>
          {othersOn(m, account) && <button className="quiet-action" onClick={() => onReply(m, true)} disabled={offline || !account || account.state !== "connected"}>{REPLY_ALL}</button>}
        </div>
      )}
      {headers && m && (
        <dl className="email-headers">
          <dt>From</dt><dd>{m.from_name ? `${m.from_name} <${m.from_address}>` : m.from_address}</dd>
          <dt>To</dt><dd>{m.to_addresses.map((a) => a.address).join(", ") || "(None)"}</dd>
          {m.cc_addresses.length > 0 && <><dt>Cc</dt><dd>{m.cc_addresses.map((a) => a.address).join(", ")}</dd></>}
          <dt>Date</dt><dd>{new Date(m.internal_date).toLocaleString()}</dd>
          <dt>Account</dt><dd>{m.account}</dd>
          <dt>Id</dt><dd>{m.provider_id}</dd>
        </dl>
      )}

      {readLine && (
        <div className="email-note quiet">
          <span>{readLine}</span>
          {readRetry && <button className="quiet-action" onClick={readRetry}>{RETRY}</button>}
        </div>
      )}
      {m?.deleted && <div className="email-note quiet"><span>{SOURCE_GONE}</span></div>}
      {cards}

      {loading && !m && !error && <SkeletonRows rows={3} />}
      {error && !m && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="row"><div className="row-grow"><div className="conn-name">{lineFor(error)}</div></div></div>
          <button className="row row-act" onClick={() => { setError(null); onBack(); }}>{EMAIL_TITLE}</button>
        </div></div>
      )}

      {m && (
        m.html ? (
          <>
            {hasRemoteImages(m.html) && !showImages && (
              <div className="email-note quiet"><span>{IMAGES_OFF}</span><button className="quiet-action" onClick={() => setShowImages(true)}>{SHOW_IMAGES}</button></div>
            )}
            <div className="pad-x"><MailHtmlView html={m.html} remoteImages={showImages} /></div>
          </>
        )
          : m.text ? <div className="email-body">{m.text}</div>
            : fetchingBody ? <div className="email-note quiet"><span>{BODY_PENDING}</span></div>
              : !m.has_body ? <div className="email-note quiet"><span>{offline || !token ? NO_BODY_OFFLINE : m.snippet}</span></div>
                : <div className="email-body">{m.snippet}</div>
      )}

      {attachments.length > 0 && (
        <div className="pad-x">
          <div className="sh2 sh2-quiet"><span className="t">{ATTACHMENTS}</span><span className="n">{attachments.length}</span></div>
          <div className="card list-card-ruled">
            {attachments.map((a) => (
              <div className="row" key={a.attachmentId} {...rowDoor(() => void download(a))} aria-label={`${a.filename} · ${sizeLine(a.size)}`}>
                <div className="row-grow">
                  <div className="conn-name truncate">{a.filename}</div>
                  <div className="facts"><span className="fact">{sizeLine(a.size)}</span><span className="fact">{downloading === a.attachmentId ? DOWNLOADING : a.mime}</span></div>
                </div>
              </div>
            ))}
          </div>
          {attachmentLine && <div className="email-note quiet"><span>{attachmentLine}</span></div>}
        </div>
      )}

      <div className="pad-x"><div className="card list-card-ruled">
        <button className="row row-act" onClick={openGmail}>{link.exact ? OPEN_GMAIL_EXACT : OPEN_GMAIL_GENERIC}</button>
        {gmailWhy && !link.exact && <div className="email-note quiet"><span>{GENERIC_WHY}</span></div>}
      </div></div>
      <div className="screen-foot" />

      {more && <RowActionSheet title={MORE_LABEL} actions={actions.map((a) => ({ ...a, label: a.disabled && (a.label === ARCHIVE || a.label === TRASH) && !can(a.label === ARCHIVE ? "archive" : "trash") ? `${a.label} · ${UNSUPPORTED_ACTION}` : a.label }))} onCancel={() => setMore(false)} />}
      {filing && <RowActionSheet title={FILE_UNDER} actions={categories.map((c) => ({ label: c.data.name, onPick: () => onFileUnder(row, c.id) }))} onCancel={() => setFiling(false)} />}
    </div>
  );
}
