// ONE MESSAGE, AS A BOTTOM SHEET (Astra's design, approved 2026-10-10; docs/
// jarvis-unified, slice 05; IMPLEMENTATION-SPEC.md 08 E05, E06, E20, E22, E23,
// E29; 09 M2; 13; CLAUDE.md "Row actions, warm neutrals and the perfect bar").
// The message opens as a sheet over the dimmed inbox, never a full-screen
// push: the handle, the subject, the sender and date, the body, its
// attachments, the candidate cards, five visible rows (Add to JARVIS, Track
// This, Move to Section, Archive, Open in Gmail) and ONE prominent primary
// (Reply) at the foot, Reply All a quieter control beside it. Everything else
// -- headers, Copy Message Id, Forward in Gmail, File Under, Mark Read/Unread,
// Trash -- lives in the More overflow, the same RowActionSheet every other row
// uses; Move to Section is in both (issue 104: the face row is the door a
// person finds, the More entry stays as the second).
//
// The sender's words stay inert: the HTML goes through the app's sanitiser
// into a frame that runs nothing, the text is drawn as text. Opening marks
// the message read through a user-origin provider command; the badge comes
// back and Retry shows if Gmail refused. Archive and Trash are explicit
// taps, offered only when the account can do them, each with a receipt and
// an Undo that is itself a verified provider command. Open in Gmail is exact
// when the thread id is Gmail's; otherwise the row says Open Gmail and says
// why. Add to JARVIS and Track This hand off to the existing manual-capture
// door (EmailFlow's startCapture, the same candidate_propose -> CaptureSheet
// path the More menu's own Capture entry already uses): nothing here
// captures, extracts or infers on its own.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BarAction } from "../shared/PageHeader";
import RowActionSheet, { type RowAction } from "../shared/RowActionSheet";
import SkeletonRows from "../shared/SkeletonRows";
import { Archive as ArchiveIcon, CornerUpLeft, FileText, FolderKanban, Hourglass, MoreHorizontal, Share, Sparkles } from "../shared/icons";
import { rowDoor } from "../shared/rowDoor";
import { showToast } from "../shared/toast";
import { saveFile } from "../shared/saveFile";
import { copyText } from "../shared/shareText";
import { lineFor, type CommandFailure } from "../substrate/commands/errors";
import MailHtmlView from "../messages/MailHtmlView";
import { openExternal } from "../messages/openExternal";
import type { Category } from "../categories/types";
import type { CaptureKind } from "../substrate/contracts";
import {
  ADD_TO_JARVIS, ARCHIVE, ATTACHMENT_FAILED, ATTACHMENT_SAVED, ATTACHMENT_SHARED, ATTACHMENT_TOO_BIG, BODY_PENDING, COPIED_ID, COPY_ID, DOWNLOADING,
  EMAIL_TITLE, FILE_UNDER, GENERIC_WHY, HIDE_HEADERS, MARK_READ, MARK_UNREAD, MORE_LABEL, NO_BODY_OFFLINE, OPEN_GMAIL_EXACT, OPEN_GMAIL_GENERIC,
  IMAGES_OFF, PUT_BACK, READ_CONFLICT, READ_FAILED, RESTORED, RETRY, SHOW_HEADERS, SHOW_IMAGES, SOURCE_GONE, TRASH, UNREAD_FAILED, UNSUPPORTED_ACTION,
  FORWARD_IN_GMAIL, FORWARD_WHY, REPLY, REPLY_ALL,
  ALSO_IN, MOVE_TO_SECTION, contactDoorLabel,
} from "./copy";
import { attachmentBlob, attachmentText, downloadAttachment, gmailLink, isCalendarFile, labelMessage, openMessage, readMessage, type AttachmentMeta, type EmailAccount, type InboxRow, type MessageDetail, type RpcClient } from "./emailClient";
import { loadMessage, saveMessage } from "./deviceCache";
import { hasRemoteImages, sizeLine, whenFacts, type EmailFact } from "./format";
import EmailFacts from "./EmailFacts";
import { cleanSnippet } from "./snippet";
import { leadFor } from "../messages/rowAnatomy";
import "../styles/mail-rows.css";
import { KIND_WORD, PRIMARY, textOf } from "./candidates";
import BackPill from "../shared/BackPill";

const MAX_ATTACHMENT = 20 * 1024 * 1024;
const COPY_FAILED = "Couldn't Copy";
/** The kind picker behind Add to JARVIS: every capture kind but Waiting, which Track This goes to directly. */
const ADD_KINDS: readonly CaptureKind[] = ["bill", "receipt", "task", "event"];

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

export default function MessageScreen({ client, token, userId, row, account, offline, categories, categoryId, onBack, onRowChanged, onLeftInbox, onFileUnder, cards, finish, moreActions, onBodyText, onCalendarFile, onReply, onCapture, onMoveToSection, sectionName, alsoIn = [], onContact }: {
  client: RpcClient;
  token: string | null | undefined;
  userId: string;
  /** The list's row, so the sheet draws before the read lands. */
  row: InboxRow;
  account: EmailAccount | null;
  offline: boolean;
  categories: Category[];
  categoryId: string | null;
  /** Close the sheet, back to the dimmed inbox underneath. */
  onBack: () => void;
  /** The list follows the provider: read state, labels. */
  onRowChanged: (patch: Partial<InboxRow> & { id: string }) => void;
  /** Archived or trashed: the row leaves the inbox; the flow shows the toast whose Undo is the reverse provider command. */
  onLeftInbox: (row: InboxRow, info: LeftInbox) => void;
  onFileUnder: (row: InboxRow, categoryId: string) => void;
  /** The message's cards (slice 06), drawn by the flow. */
  cards?: ReactNode;
  /** The finish card (ruling 6, 2026-10-12): a confirmed meeting or booking's Add to Schedule, drawn at the top of the message. */
  finish?: ReactNode;
  /** A calendar file attached to the message, read as text once per message version, for the rules to read its event. */
  onCalendarFile?: (text: string) => void;
  /** Spec 3.3: the other connected mailboxes holding this exact Message-ID. Named here; each copy stays its own row. */
  alsoIn?: string[];
  /** Extra rows for the More menu (Find Useful Details, Capture, dismissed suggestions). */
  moreActions?: RowAction[];
  /** The body as text, once it is known, for the rules to read. */
  onBodyText?: (text: string) => void;
  /** Reply and Reply All (slice 07): the composer opens with the message's own headers. */
  onReply?: (m: MessageDetail, all: boolean) => void;
  /** Add to JARVIS and Track This: a blank candidate of the chosen kind, through the same manual-capture door the More menu's Capture entry already opens. */
  onCapture?: (kind: CaptureKind) => void;
  /** Move to Section (issue 104): the face row's door to the section picker the flow owns. Absent: no row, and nothing else changes. Local, so it is never disabled. */
  onMoveToSection?: () => void;
  /** Where the message sits now, the row's one fact. Absent when the flow cannot say (a message opened from outside the loaded list): the row then draws no fact. */
  sectionName?: string;
  /** The sender's circle is a button that opens the contact sheet over this one (issue 112, item 14). Absent: the circle is the plain mark it was. */
  onContact?: (who: { address: string; name: string }) => void;
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
  const [addingKind, setAddingKind] = useState(false);
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
  // A .ics ATTACHMENT (ruling 6): today only an invite pasted into the body was read. The file is fetched through
  // the same authorised attachment route a Download uses, once per message version, and handed to the rules as
  // text. Nothing is added to the calendar by this; the card it makes waits for the person's tap. Never an RSVP.
  const readCal = useRef<string | null>(null);
  useEffect(() => {
    if (!m || !onCalendarFile || !token || offline || m.deleted) return;
    const file = (m.attachments ?? []).find(isCalendarFile);
    if (!file) return;
    const key = `${m.id}:${m.source_hash}:${file.attachmentId}`;
    if (readCal.current === key) return;
    readCal.current = key;
    void (async () => {
      const r = await downloadAttachment(token, m.account, m.provider_id, file.attachmentId);
      if (!r.ok) { readCal.current = null; return; }
      try { onCalendarFile(attachmentText(r.value)); } catch { /* not text: nothing to read */ }
    })();
  }, [m, onCalendarFile, token, offline]);
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

  // COPY, AND SAY SO ONLY IF IT WORKED (2026-10-04). `navigator.clipboard?.`
  // resolved to undefined where there is no clipboard, so the await passed and
  // "Message Id Copied" went up over nothing, and a refused write fell into an
  // empty catch and said nothing at all. copyText throws in both cases; the
  // failure puts the id itself in the toast so it can be read off.
  const copyId = async () => {
    const text = `${row.account} · ${row.provider_id}`;
    try { await copyText(text); showToast({ message: COPIED_ID }); } catch { showToast({ message: `${COPY_FAILED} · ${text}` }); }
  };

  const openGmail = () => {
    if (!link.exact) setGmailWhy(true);
    openExternal(link.href);
  };

  // Headers, Copy Id, Forward and File Under stay in the overflow: the four
  // rows the sheet shows on its own face (Add to JARVIS, Track This, Archive,
  // Open in Gmail) are the ones Astra's design calls out by name, and the flow's
  // own Move to Section joined them (issue 104) while keeping its entry in
  // moreActions below. Archive left this list for the sheet face; Trash stays
  // here on purpose.
  const actions: RowAction[] = [
    { label: m?.read === false ? MARK_READ : MARK_UNREAD, onPick: () => void toggleUnread(), disabled: !token || offline || !m },
    { label: FILE_UNDER, onPick: () => setFiling(true), disabled: categories.length === 0 },
    { label: TRASH, onPick: () => void leave("trash"), disabled: !can("trash") || !token || offline || !m, destructive: true },
    { label: COPY_ID, onPick: () => void copyId() },
    // Forwarding and rich formatting stay in Gmail (11): the honest door, said so.
    { label: FORWARD_IN_GMAIL, onPick: () => { showToast({ message: FORWARD_WHY }); openGmail(); } },
    { label: headers ? HIDE_HEADERS : SHOW_HEADERS, onPick: () => setHeaders((h) => !h) },
    ...(moreActions ?? []),
  ];

  // The first words of the message with the sender's padding and plumbing taken off (issue 103); "" draws nothing.
  const preview = m ? cleanSnippet(m.snippet) : "";
  const attachments = m?.attachments?.length ? m.attachments : row.attachment_metadata;
  const area = categoryId ? categories.find((c) => c.id === categoryId)?.data : undefined;
  // V02 (the approved detail visual, 2026-10-12): the sender's circle, the name in white, the address as the head's
  // one grey, the day and time small caps at the right, and To with the real addresses in white. The mailbox is
  // named only when it is not already one of the recipients; the area rides on the To line as its dot and name.
  const fromName = (m?.from_name ?? row.from_name).trim();
  const fromAddress = m?.from_address ?? row.from_address;
  const face = leadFor({ from: fromName, fromEmail: fromAddress, displayName: fromName || fromAddress }, new Date());
  const recipients = m ? [...m.to_addresses, ...m.cc_addresses].map((a) => a.address).filter(Boolean) : [];
  const mailboxShown = recipients.some((a) => a.toLowerCase() === row.account.toLowerCase());
  const toFacts: EmailFact[] = recipients.length > 0 || !mailboxShown ? [
    ...(recipients.length ? [{ text: recipients.join(", "), strong: true }] : []),
    ...(!mailboxShown ? [{ text: row.account, tone: "date" as const }] : []),
    // Spec 3.3: the same Message-ID in another connected mailbox; named here, each copy stays its own row.
    ...(alsoIn.length ? [{ text: `${ALSO_IN} ${alsoIn.join(", ")}`, tone: "date" as const }] : []),
    ...(area ? [{ text: area.name, cat: area.color }] : []),
  ] : [];

  const archiveDisabled = !can("archive") || !token || offline || !m;
  const archiveLabel = can("archive") ? ARCHIVE : `${ARCHIVE} · ${UNSUPPORTED_ACTION}`;
  const openGmailLabel = link.exact ? OPEN_GMAIL_EXACT : OPEN_GMAIL_GENERIC;
  const replyDisabled = offline || !account || account.state !== "connected";

  return createPortal(
    <div className="sheet-scrim" onClick={onBack}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="msg-sheet-bar">
          <BackPill label={EMAIL_TITLE} onClick={onBack} />
          <BarAction label={MORE_LABEL} onClick={() => setMore(true)}><MoreHorizontal className="ic" /></BarAction>
        </div>

        <div className="pad-x sheet-list">
          <div className="email-head">
            <div className="email-subject">{(m?.subject ?? row.subject).trim() || "(No Subject)"}</div>
            <div className="email-from">
              {/* The circle is already 44 by 44 here (email.css), so the button needs no reach of its own; nothing around it is a tap. */}
              {onContact && fromAddress.trim() ? (
                <button type="button" className={"email-avatar mface cat-bg-" + face.face} aria-label={contactDoorLabel(fromName || fromAddress)}
                  onClick={() => onContact({ address: fromAddress, name: fromName })}>{((fromName || fromAddress)[0] ?? "?").toUpperCase()}</button>
              ) : (
                <span className={"email-avatar mface cat-bg-" + face.face} aria-hidden="true">{((fromName || fromAddress)[0] ?? "?").toUpperCase()}</span>
              )}
              <div className="email-from-who">
                <div className="email-from-top">
                  <span className="email-from-name">{fromName || fromAddress}</span>
                  <EmailFacts facts={whenFacts(m?.internal_date ?? row.internal_date)} />
                </div>
                {fromName && <EmailFacts wrap facts={[{ text: fromAddress }]} />}
                {toFacts.length > 0 && <div className="email-to"><span className="email-to-k">To</span><EmailFacts wrap facts={toFacts} /></div>}
              </div>
            </div>
          </div>

          {finish}

          {headers && m && (
            <dl className="email-headers">
              <dt>From</dt><dd>{m.from_name ? `${m.from_name} <${m.from_address}>` : m.from_address}</dd>
              {/* 2026-10-05: no To means no row, not a "(None)" placeholder. */}
              {m.to_addresses.length > 0 && <><dt>To</dt><dd>{m.to_addresses.map((a) => a.address).join(", ")}</dd></>}
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

          {loading && !m && !error && <SkeletonRows rows={3} />}
          {error && !m && (
            <div className="card list-card-ruled">
              <div className="row"><div className="row-grow"><div className="conn-name">{lineFor(error)}</div></div></div>
              <button className="row row-act" onClick={() => { setError(null); onBack(); }}>{EMAIL_TITLE}</button>
            </div>
          )}

          {m && (
            m.html ? (
              <>
                {hasRemoteImages(m.html) && !showImages && (
                  <div className="email-note quiet"><span>{IMAGES_OFF}</span><button className="quiet-action" onClick={() => setShowImages(true)}>{SHOW_IMAGES}</button></div>
                )}
                <MailHtmlView html={m.html} remoteImages={showImages} />
              </>
            )
              : m.text ? <div className="email-body">{m.text}</div>
                : fetchingBody ? <div className="email-note quiet"><span>{BODY_PENDING}</span></div>
                  : !m.has_body ? (offline || !token ? <div className="email-note quiet"><span>{NO_BODY_OFFLINE}</span></div>
                    : preview ? <div className="email-note quiet"><span>{preview}</span></div> : null)
                    : preview ? <div className="email-body">{preview}</div> : null
          )}

          {attachments.length > 0 && (
            <>
              {/* V02: each file is its own card: the type tile, the name in white, the size, the chevron. A tap downloads it. */}
              {attachments.map((a) => (
                <div className="card list-card-ruled email-attachment" key={a.attachmentId}>
                  <div className="row" {...rowDoor(() => void download(a))} aria-label={`${a.filename} · ${sizeLine(a.size)}`}>
                    <div className="sec-ico ico-blue" aria-hidden="true"><FileText className="ic" /></div>
                    <div className="row-grow">
                      <div className="conn-name truncate">{a.filename}</div>
                      <EmailFacts facts={[{ text: sizeLine(a.size), strong: true }, ...(downloading === a.attachmentId ? [{ text: DOWNLOADING }] : [])]} />
                    </div>
                    <div className="chev"></div>
                  </div>
                </div>
              ))}
              {attachmentLine && <div className="email-note quiet"><span>{attachmentLine}</span></div>}
            </>
          )}

          {cards}

          {/* Astra's design, approved 2026-10-10: four visible rows, not a More
              menu (Move to Section is a fifth, issue 104). Add to JARVIS and
              Track This hand off to the same manual-capture door the More
              menu's own Capture entry already opens (EmailFlow's
              startCapture); Archive and Open in Gmail are the message's own
              provider commands, promoted off the overflow. */}
          <div className="card list-card-ruled email-actions">
            {onCapture && (
              <div className="row" {...rowDoor(() => setAddingKind(true))}>
                <div className="sec-ico ico-blue" aria-hidden="true"><Sparkles className="ic" /></div>
                <div className="row-grow"><div className="conn-name">{ADD_TO_JARVIS}</div></div>
                <div className="chev"></div>
              </div>
            )}
            {onCapture && (
              <div className="row" {...rowDoor(() => onCapture("waiting"))}>
                <div className="sec-ico ico-teal" aria-hidden="true"><Hourglass className="ic" /></div>
                <div className="row-grow"><div className="conn-name">{PRIMARY.waiting}</div></div>
                <div className="chev"></div>
              </div>
            )}
            {/* Move to Section (issue 104, Dave 2026-10-13): the fifth face row. It names where the message sits now (its one
                fact, a span) and opens the flow's section picker; the More menu keeps its own Move to Section as the second
                door. Local to this phone, so it is never dimmed offline. The icon wears Email's teal. */}
            {onMoveToSection && (
              <div className="row" {...rowDoor(onMoveToSection)}>
                <div className="sec-ico ico-teal" aria-hidden="true"><FolderKanban className="ic" /></div>
                <div className="row-grow">
                  <div className="conn-name">{MOVE_TO_SECTION}</div>
                  {sectionName && <EmailFacts facts={[{ text: sectionName }]} />}
                </div>
                <div className="chev"></div>
              </div>
            )}
            <div className={"row" + (archiveDisabled ? " dim" : "")} {...(archiveDisabled ? {} : rowDoor(() => void leave("archive")))}>
              <div className="sec-ico ico-warn" aria-hidden="true"><ArchiveIcon className="ic" /></div>
              <div className="row-grow"><div className="conn-name">{archiveLabel}</div></div>
              {!archiveDisabled && <div className="chev"></div>}
            </div>
            <div className="row" {...rowDoor(openGmail)}>
              <div className="sec-ico ico-violet" aria-hidden="true"><Share className="ic" /></div>
              <div className="row-grow"><div className="conn-name">{openGmailLabel}</div></div>
              <div className="chev"></div>
            </div>
          </div>
          {gmailWhy && !link.exact && <div className="email-note quiet"><span>{GENERIC_WHY}</span></div>}
          <div className="xs-foot" />
        </div>

        {onReply && m && !m.deleted && (
          <div className="pad-x sheet-actions">
            <button className="btn btn-primary btn-launch btn-block" onClick={() => onReply(m, false)} disabled={replyDisabled}><CornerUpLeft className="ic" />{REPLY}</button>
            {othersOn(m, account) && <button className="quiet-action" onClick={() => onReply(m, true)} disabled={replyDisabled}>{REPLY_ALL}</button>}
          </div>
        )}
      </div>

      {more && <RowActionSheet title={MORE_LABEL} actions={actions.map((a) => ({ ...a, label: a.disabled && a.label === TRASH && !can("trash") ? `${a.label} · ${UNSUPPORTED_ACTION}` : a.label }))} onCancel={() => setMore(false)} />}
      {filing && <RowActionSheet title={FILE_UNDER} actions={categories.map((c) => ({ label: c.data.name, onPick: () => onFileUnder(row, c.id) }))} onCancel={() => setFiling(false)} />}
      {addingKind && onCapture && (
        <RowActionSheet title={ADD_TO_JARVIS} actions={ADD_KINDS.map((k) => ({ label: KIND_WORD[k], onPick: () => onCapture(k) }))} onCancel={() => setAddingKind(false)} />
      )}
    </div>,
    document.body,
  );
}
