// THE COMPOSER (docs/jarvis-unified, slice 07; IMPLEMENTATION-SPEC.md 08 E16,
// E17, E22; 09 M5; 11). Plain text, one account, To, Cc and Bcc, a subject, a
// body, attachments from the app's own storage. The words are saved on this
// device after a pause and on blur, then on the server with the revision this
// device last saw; a revision that moved on is a conflict with both copies in
// view and a choice, never a silent loss. Close keeps an inert draft and says
// so (a composer with words in it is never dropped without a word; an empty one
// just closes); Discard is its own tap, behind one confirm, with Undo. Review Send is the only way out toward a send, and
// it is shut while offline, while an attachment is still uploading, and until
// there is a recipient. Nothing here sends.
//
// ONE SAVE AT A TIME (issue 103, D5 part 2, 2026-10-13). Every write to the server's copy (an autosave, Close, the save inside Review Send,
// Keep This Draft, the farewell) takes its turn in one queue, and reads the draft's id and revision from the refs WHEN IT RUNS, so a save asked
// for while another is out can neither make a second draft nor race a Close or a Review. Leaving the screen any other way (a tab, the app going
// to the background) writes the words to this device at once and brings a draft the server ALREADY HAS up to date; it never creates one, and
// it does nothing for a draft that was discarded or handed to the review (`stopped`). Do not turn that into a create: see `put`.

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import PageHeader from "../shared/PageHeader";
import RowActionSheet from "../shared/RowActionSheet";
import { FieldRow, MenuRow, Row, TextRow, Tile } from "../shared/FormSheet";
import { Mail, Paperclip } from "../shared/icons";
import { rowDoor } from "../shared/rowDoor";
import { failure, lineFor, type CommandFailure, type CommandResult, type RpcClient } from "../substrate/commands/errors";
import { prepareUpload, validateUpload } from "../shared/fileStorage";
import type { FileStore } from "../files/FileStore";
import {
  ATTACH, ATTACH_FAILED, ATTACH_NEEDS_APP, ATTACH_TOO_MUCH, ATTACHMENTS_LABEL, ATTACHMENTS_WAIT, BAD_ADDRESS, BCC_LABEL, BODY_LABEL, CC_BCC, CC_LABEL, CLOSE_DRAFT, COMPOSE_TITLE,
  CONFLICT_TITLE, DISCARD_ASK, DISCARD_DRAFT, DISCARD_OFFLINE, DRAFT_ONLY, EMAIL_TITLE, FROM_LABEL, KEEP_THIS_DRAFT, NEEDS_RECIPIENT, OFFLINE_SEND, OTHER_DEVICE, REMOVE_ATTACHMENT, REPLY, REVIEW_SEND, SAVE_FAILED, SAVED_HERE,
  NO_SUBJECT, SAVED_LINE, SAVING_LINE, SIGNATURE_OFFER_NOTE, ADD_SIGNATURE, NO_SIGNATURE_NOTE, SUBJECT_LABEL, THIS_DEVICE, TO_LABEL, UPLOADING, USE_NEWER_DRAFT, USE_SAVED_SIGNATURE,
} from "./copy";
import type { EmailAccount } from "./emailClient";
import { sizeLine } from "./format";
import EmailFacts from "./EmailFacts";
import SignatureSheet from "./SignatureSheet";
import { announceSignature } from "./signatureBus";
import ReplyCoverage from "../messages/coverage/ReplyCoverage";
import type { CoverageOverride, CoverageOverrides } from "../messages/replyCoverage";
import type { ThreadBriefAI } from "../messages/threadBrief";
import { replyThreadOf, useEmailReplyRequirements } from "./useEmailReplyRequirements";
import {
  withSignature, attachmentsBytes, badAddresses, canonicalFields, discardDraft, fieldsOf, MAX_ATTACHMENTS_BYTES, replaceSignature, reviewSend, saveDraft, saveLocalDraft, clearLocalDraft, sameFields, signatureUntouched, sha256Hex, splitAddresses,
  type AttachmentRef, type DraftFields, type DraftRow, type Review, type Saved,
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
  /** Opened from a device copy the server may not hold (Drafts, On This Device): its words are not known to be saved, so the first save pushes them. */
  unsynced?: boolean;
}

const hasWords = (f: DraftFields): boolean =>
  f.to_addresses.length + f.cc_addresses.length + f.bcc_addresses.length > 0 || f.subject.trim() !== "" || f.body_text.trim() !== "" || f.attachment_refs.length > 0;

export const LOCAL_SAVE_MS = 500;
export const SERVER_SAVE_MS = 1000;

type SaveWord = "" | "local" | "saving" | "saved" | "failed";

/** What one turn at the server's copy came to. */
type Landed =
  | { kind: "same" }                                // the server already held exactly these words
  | { kind: "saved" }                               // the server answered, and holds them now
  | { kind: "refused"; failure: CommandFailure }    // the server said no (or could not be reached); the words are still on this device
  | { kind: "skipped" };                            // nothing was asked of the server: offline, a conflict on screen, a discard under way, or a screen that has gone

/** The save and the review as one turn at the draft (Review Send). */
interface ReviewTurn { landed: Landed; rv: CommandResult<Review> | null; id: string | null; rev: number | null }

export default function ComposeScreen({ client, userId, accounts, offline, fileStore, start, now, onBack, onReview, onDiscarded, briefAI }: {
  client: RpcClient;
  userId: string;
  accounts: EmailAccount[];
  offline: boolean;
  fileStore: FileStore | null;
  start: ComposeStart;
  now: () => Date;
  /** Close: the draft stays, inert, saved where it could be. `server` when the server answered, `device` when the words are
   *  on this phone only, null when there was nothing to keep (an empty composer). */
  onBack: (saved: "server" | "device" | null) => void;
  onReview: (draftId: string, revision: number, fields: DraftFields, review: Review) => void;
  /** Discarded, with the copy an Undo can save again. */
  onDiscarded: (copy: { accountId: string; fields: DraftFields } | null) => void;
  /** The one thread reading (ruling 7, "Answered X of Y"); absent or unavailable means no indicator at all. */
  briefAI?: ThreadBriefAI | null;
}) {
  const [fields, setFields] = useState<DraftFields>(() => canonicalFields(start.fields));
  const [accountId, setAccountId] = useState(start.accountId);
  const [draftId, setDraftId] = useState<string | null>(start.draftId);
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
  // The words the server is known to hold for this draft, when it stamped them, and the account it holds them under. A composer opened
  // from a device copy with edits the server never saw (`unsynced`) knows none of it: its first save pushes them.
  const trusted = start.revision !== null && !start.unsynced;
  const lastServer = useRef<DraftFields | null>(trusted ? canonicalFields(start.fields) : null);
  const lastServerAt = useRef<string | null>(null);
  const lastAcct = useRef<string | null>(trusted ? start.accountId : null);
  const lastLocal = useRef<DraftFields>(canonicalFields(start.fields));
  const opened = useRef<DraftFields>(canonicalFields(start.fields));
  const unsynced = useRef(!!start.unsynced);
  const serverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);
  // The draft's id, revision and device key as the LAST save left them, readable by a handler or a timer that was made before it
  // landed (a Close tapped while an autosave is out must not save a second draft).
  const idRef = useRef<string | null>(start.draftId);
  const revRef = useRef<number | null>(start.revision);
  const keyRef = useRef(start.localKey);
  const conflictRef = useRef<DraftRow | null>(null);
  // The save queue (see `exclusive`), and the newest words anything has asked it to put on the server.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const wanted = useRef<DraftFields | null>(null);
  // Discarded, or handed to the review: nothing may write this draft any more, here or on the way out (skipFlush).
  const stopped = useRef(false);
  const closing = useRef(false);
  const [askDiscard, setAskDiscard] = useState(false);

  // The words on screen NOW: the To, Cc and Bcc text that has not been committed yet included (it is committed on blur, and a Close or a
  // pause in typing can come first). `cur` is what an async step (a queued save, a timer, the farewell below) must read: the screen as it
  // stands when it runs, never as it stood in the render that made it.
  const effective = useMemo<DraftFields>(() => ({ ...fields, to_addresses: splitAddresses(toText), cc_addresses: splitAddresses(ccText), bcc_addresses: splitAddresses(bccText) }), [fields, toText, ccText, bccText]);
  const cur = useRef({ client, offline, accountId, userId, now, words: effective });
  cur.current = { client, offline, accountId, userId, now, words: effective };

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const connected = accounts.filter((a) => a.state === "connected");

  // ANSWERED X OF Y (ruling 7, 2026-10-12), replies only. What the thread asked is read once per thread revision
  // (cached per account and thread); the draft is checked against it locally, 300 ms after the last keystroke.
  // Quiet, never blocking Review Send; with AI off nothing is drawn.
  const requirements = useEmailReplyRequirements({ client, ai: briefAI, userId, account: account?.address ?? null, threadId: replyThreadOf(start.fields), selfEmails: accounts.map((a) => a.address) });
  const [coverageMarks, setCoverageMarks] = useState<CoverageOverrides>({});
  const markCoverage = (key: string, mark: CoverageOverride | null) => setCoverageMarks((m) => { const next = { ...m }; if (mark) next[key] = mark; else delete next[key]; return next; });

  // ---- the words this device holds -----------------------------------------
  // Everything from here to the doors is plain functions that read only refs and `cur`, never the render that made them: a timer, a pagehide
  // and the farewell run long after it, and a copy written under a key a save has since retired would list the one draft twice.
  const writeLocal = (f: DraftFields, serverSavedAt: string | null, id: string | null, key: string, rev: number | null) => {
    const e = cur.current;
    // A copy the server holds is stamped with the SERVER's time, so it reads as saved; one it does not hold is stamped now, by this phone's clock.
    saveLocalDraft(e.userId, { key, draft_id: id, account_id: e.accountId, fields: f, revision: rev, saved_at: serverSavedAt ?? e.now().toISOString(), server_saved_at: serverSavedAt });
    lastLocal.current = f;
  };

  // Nothing here yet worth a draft anywhere: nobody typed (the words are what the composer opened with, or empty), no draft exists, and it did
  // not open from a device copy. Opening a composer and walking away leaves nothing behind.
  const nothingYet = (w: DraftFields): boolean =>
    !unsynced.current && idRef.current === null && lastServer.current === null && (sameFields(w, opened.current) || !hasWords(w));

  // Whether the server holds exactly these words, under the account the composer is on now.
  const onServer = (w: DraftFields): boolean => !!lastServer.current && sameFields(lastServer.current, w) && lastAcct.current === cur.current.accountId;

  // The device copy of these words, marked as saved only if the server holds exactly them. Synchronous, so it is also what a page that is
  // going away can rely on. True when it wrote.
  const keepOnDevice = (words: DraftFields): boolean => {
    if (stopped.current || nothingYet(words) || sameFields(lastLocal.current, words)) return false;
    writeLocal(words, onServer(words) ? (lastServerAt.current ?? cur.current.now().toISOString()) : null, idRef.current, keyRef.current, revRef.current);
    return true;
  };

  const flushLocal = () => {
    if (localTimer.current) { clearTimeout(localTimer.current); localTimer.current = null; }
    const words = cur.current.words;
    if (keepOnDevice(words) && !onServer(words) && live.current) setSaveWord((w) => (w === "saved" || w === "" ? "local" : w));
  };

  // ---- the server's copy, by revision ---------------------------------------
  const markConflict = (row: DraftRow | null) => { conflictRef.current = row; if (live.current) setConflict(row); };

  // What a save that landed leaves behind, whether or not the screen is still here: what the server holds now, the device copy under its id (the
  // device-made key retired), the refs. Only the setState calls wait for a screen that is there. A save that finished after the person had left
  // used to skip all of it, and the one draft was then listed twice: the server's row, and "On This Device".
  const settle = (f: DraftFields, acct: string, saved: Saved) => {
    const e = cur.current;
    const id = saved.draft_id;
    lastServer.current = f; lastServerAt.current = saved.saved_at; lastAcct.current = acct;
    if (keyRef.current !== id) clearLocalDraft(e.userId, keyRef.current);
    idRef.current = id; revRef.current = saved.revision; keyRef.current = id;
    // The device copy is the newest words this screen ever had, marked as saved only if the server holds exactly those: a keystroke may have
    // come in while the answer was out.
    const words = e.words;
    const same = sameFields(words, f);
    writeLocal(words, same ? saved.saved_at : null, id, id, saved.revision);
    if (live.current) { setDraftId(id); setLocalKey(id); setSaveWord(same ? "saved" : "local"); }
  };

  // One turn at the server's copy, from the refs as they stand WHEN IT RUNS. Only ever called from `exclusive`, so nothing else is saving this
  // draft meanwhile. `quiet` leaves the saving words and the error lines to the caller (Review Send says its own); `overwrite` is Keep This Draft.
  const put = async (f: DraftFields, o: { quiet?: boolean; overwrite?: string } = {}): Promise<Landed> => {
    const e = cur.current;
    if (stopped.current || !e.client || e.offline || (conflictRef.current && !o.overwrite)) return { kind: "skipped" };
    // A screen that has gone only brings a draft the server already has up to date. It never makes one: a first save nobody is watching could
    // land beside a copy reopened from Drafts, or after a discard, and make a draft nobody asked for. (A discarded row answers NOT_FOUND to an update.)
    if (!live.current && idRef.current === null && !o.overwrite) return { kind: "skipped" };
    if (!o.overwrite && idRef.current !== null && onServer(f)) return { kind: "same" };
    const acct = e.accountId;
    if (!o.quiet && live.current) setSaveWord("saving");
    const r = await saveDraft(e.client, o.overwrite ?? idRef.current, acct, f, o.overwrite ? null : revRef.current);
    if (!r.ok) {
      if (r.code === "DRAFT_CONFLICT") { markConflict(r.data.draft as DraftRow); if (!o.quiet && live.current) setSaveWord("local"); }
      else if (!o.quiet && live.current) {
        if (r.code === "DRAFT_SENT") { setLine(lineFor(r)); setSaveWord("local"); } else setSaveWord("failed");
      }
      return { kind: "refused", failure: r };
    }
    settle(f, acct, r.value);
    return { kind: "saved" };
  };

  // THE QUEUE: one turn at the draft at a time, in the order asked. Before it, an autosave that came due while another was still out went with the
  // draft's id not yet known, made a second draft, and a Close or a Review Send then raced both.
  const exclusive = <T,>(job: () => Promise<T>): Promise<T> => {
    const turn = queue.current.then(job);
    queue.current = turn.then(() => undefined, () => undefined);
    return turn;
  };
  // An autosave, a Close, or the farewell. What goes out is the NEWEST words anything asked for, read when the turn comes: a train of saves that
  // built up behind a slow answer is one save, and an older request can never put older words over newer ones.
  const enqueue = (f: DraftFields): Promise<Landed> => {
    wanted.current = f;
    return exclusive(async (): Promise<Landed> => {
      try { return await put(wanted.current ?? f); } catch { return { kind: "refused", failure: failure("UNAVAILABLE") }; }
    });
  };
  const scheduleServer = (f: DraftFields) => {
    if (serverTimer.current) clearTimeout(serverTimer.current);
    serverTimer.current = setTimeout(() => { serverTimer.current = null; void enqueue(f); }, SERVER_SAVE_MS);
  };

  // LEAVING without Close (a tab, the app, anything that unmounts this screen). The device copy first, in the same breath: localStorage is
  // synchronous, so the words are kept even when the page is gone a moment later. Then the server, only for a draft it already has, queued behind
  // any save still out: an update, never a create (see `put`). A draft that is not there yet stays on this device until it is opened and saved.
  // Discarded and reviewed drafts are skipped (`stopped`): a flush must not resurrect the one or void the other.
  const farewell = () => {
    if (serverTimer.current) { clearTimeout(serverTimer.current); serverTimer.current = null; }
    if (localTimer.current) { clearTimeout(localTimer.current); localTimer.current = null; }
    if (stopped.current) return;
    const e = cur.current;
    if (nothingYet(e.words)) return;
    keepOnDevice(e.words);
    if (e.client && !e.offline && !conflictRef.current && !onServer(e.words)) void enqueue(e.words);
  };
  useEffect(() => {
    live.current = true;
    // The app going to the background or away: the device copy only. A request cannot be relied on while the page is being suspended.
    const onHide = () => { if (document.visibilityState === "hidden") keepOnDevice(cur.current.words); };
    const onGone = () => { keepOnDevice(cur.current.words); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onGone);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onGone);
      live.current = false;
      farewell();
    };
    // Mounted once; everything it calls reads refs. (Setting `live` here, not only clearing it, is what keeps StrictMode's mount, unmount, mount honest.)
  }, []);

  // Every change: the device after a pause, the server after a longer one. A composer with nothing in it yet saves nothing anywhere.
  useEffect(() => {
    if (serverTimer.current) { clearTimeout(serverTimer.current); serverTimer.current = null; }
    if (stopped.current) return;
    const words = effective;
    if (nothingYet(words)) {
      // Typed and taken out again: the device copy an earlier keystroke made goes with it.
      if (!sameFields(lastLocal.current, words)) { clearLocalDraft(userId, keyRef.current); lastLocal.current = words; }
      return;
    }
    const onDevice = sameFields(lastLocal.current, words);
    if (onDevice && onServer(words)) return;
    if (!onDevice) localTimer.current = setTimeout(() => { localTimer.current = null; flushLocal(); }, LOCAL_SAVE_MS);
    if (!onServer(words)) scheduleServer(words);
    return () => { if (localTimer.current) { clearTimeout(localTimer.current); localTimer.current = null; } };
    // The words themselves drive this; everything it calls reads refs.
  }, [effective]);

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

  // Fix order item 2 (2026-10-11): an account with no saved signature says so in the composer, with Add Signature.
  // Saving it here saves it for the account (the same RPC as Settings) and adds it to this draft once, at the end.
  const [addingSig, setAddingSig] = useState(false);
  const [sigAdded, setSigAdded] = useState<string | null>(null);
  const currentAcct = accounts.find((a) => a.id === accountId) ?? null;
  const noSignature = !!currentAcct && !currentAcct.signature_text && sigAdded === null;

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
    // The account is saved with the draft, so a switch is a change to it; a composer with nothing in it yet saves nothing for a switch.
    if (prevId !== accountId && !nothingYet(effective)) scheduleServer(effective);
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
    wanted.current = f;
    // The save and the review are ONE turn at the draft: an autosave still out finishes first, and none starts between the save and the review
    // (it would move the revision the review is bound to). Once the review is made the draft is the review's, and nothing may save it again, here
    // or on the way out (`stopped`), or the approval would be void. A debounce the committed addresses started meanwhile is cleared with it.
    const turn: ReviewTurn = await exclusive(async (): Promise<ReviewTurn> => {
      const landed = await put(f, { quiet: true });
      if (landed.kind !== "saved" && landed.kind !== "same") return { landed, rv: null, id: null, rev: null };
      const id = idRef.current!, rev = revRef.current;
      const made = await reviewSend(client, id, rev);
      if (made.ok) {
        stopped.current = true;
        if (serverTimer.current) { clearTimeout(serverTimer.current); serverTimer.current = null; }
        if (localTimer.current) { clearTimeout(localTimer.current); localTimer.current = null; }
      }
      return { landed, rv: made, id, rev };
    });
    if (!live.current) return;
    setReviewing(false);
    if (turn.landed.kind === "refused") {
      // A conflict is on screen already, as the two copies; any other refusal is said here.
      if (turn.landed.failure.code !== "DRAFT_CONFLICT") setLine(lineFor(turn.landed.failure));
      return;
    }
    const rv = turn.rv;
    if (!rv) return; // skipped: a conflict on screen, or a discard under way
    if (!rv.ok) {
      if (rv.code === "DRAFT_CONFLICT") { markConflict(rv.data.draft as DraftRow); return; }
      if (rv.code === "MISSING_DETAILS") { setLine(NEEDS_RECIPIENT); return; }
      if (rv.code === "INVALID_PAYLOAD" && (rv.detail === "to" || rv.detail === "cc" || rv.detail === "bcc")) { setLine(BAD_ADDRESS); return; }
      setLine(lineFor(rv));
      return;
    }
    onReview(turn.id!, turn.rev ?? rv.value.draft_revision, f, rv.value);
  };

  // CLOSE (issue 103, 2026-10-13). The words are read from what is on screen now (the To, Cc and Bcc text that has not
  // been committed yet included), never from a closure made before the last keystroke; the save takes its turn behind any
  // autosave still out, so Close never makes a second draft beside it; and a composer with words in it is never dropped
  // without a word: the draft is kept and the toast says where (EmailFlow). An empty composer just closes.
  const close = async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      if (serverTimer.current) { clearTimeout(serverTimer.current); serverTimer.current = null; }
      if (localTimer.current) { clearTimeout(localTimer.current); localTimer.current = null; }
      const { to, cc, bcc } = commitAddresses();
      const f: DraftFields = { ...fields, to_addresses: to, cc_addresses: cc, bcc_addresses: bcc };
      if (nothingYet(f)) {
        // Never typed in, or typed and taken out again, and no draft exists anywhere: nothing is kept, and a device copy an earlier keystroke made goes too.
        if (!sameFields(lastLocal.current, f)) { clearLocalDraft(userId, keyRef.current); lastLocal.current = f; }
        onBack(null);
        return;
      }
      keepOnDevice(f);
      let where: "server" | "device" = "device";
      if (!offline && client && !conflictRef.current) {
        const landed = await enqueue(f);
        if (landed.kind === "same" || landed.kind === "saved") where = "server";
      }
      // Words typed while the save was out are on this device only (the farewell carries them on), and the toast says so.
      if (where === "server" && !sameFields(cur.current.words, f)) where = "device";
      onBack((sameFields(f, opened.current) && !unsynced.current) || !hasWords(f) ? null : where);
    } finally {
      closing.current = false;
    }
  };

  // A Discard that was refused puts the composer back as it was: saving again, and what was typed meanwhile kept.
  const resume = () => {
    // Not if the screen has gone meanwhile (the review took the draft over while the discard was out): `stopped` is then the review's, not ours.
    if (!live.current) return;
    stopped.current = false;
    const words = cur.current.words;
    keepOnDevice(words);
    if (!nothingYet(words)) scheduleServer(words);
  };

  // DISCARD (issue 103): only reached from the confirm. From the moment it is confirmed nothing may write this draft (`stopped`: queued saves skip,
  // the farewell skips), and a save still out lands first, so the id it made is known and goes with the rest. The server's answer decides the
  // toast: a refusal keeps the composer open with the reason, and offline with a draft already on the server says so instead of saying Discarded.
  const discard = async () => {
    stopped.current = true;
    if (serverTimer.current) { clearTimeout(serverTimer.current); serverTimer.current = null; }
    if (localTimer.current) { clearTimeout(localTimer.current); localTimer.current = null; }
    await queue.current;
    const e = cur.current;
    const id = idRef.current;
    if (id) {
      if (!e.client || e.offline) { resume(); setLine(DISCARD_OFFLINE); return; }
      const r = await discardDraft(e.client, id);
      if (!r.ok && r.code !== "NOT_FOUND") { resume(); setLine(lineFor(r)); return; }
    }
    clearLocalDraft(e.userId, keyRef.current);
    onDiscarded({ accountId: e.accountId, fields: cur.current.words });
  };

  const keepThis = async () => {
    const server = conflict;
    if (!server) return;
    markConflict(null);
    // A plain save at the newer revision: this device's words win, on purpose. It takes its turn like any save.
    const landed = await exclusive(() => put(cur.current.words, { quiet: true, overwrite: server.id }));
    if (!live.current) return;
    if (landed.kind === "refused") setLine(lineFor(landed.failure));
    // Nothing was asked of the server (offline): the choice is still open, and the card stays.
    else if (landed.kind === "skipped") { markConflict(server); setLine(lineFor(failure("OFFLINE"))); }
  };
  const useNewer = () => {
    const server = conflict;
    if (!server) return;
    markConflict(null);
    const f = fieldsOf(server);
    lastServer.current = f; lastServerAt.current = server.saved_at; lastAcct.current = cur.current.accountId;
    lastLocal.current = f;
    if (keyRef.current !== server.id) clearLocalDraft(userId, keyRef.current);
    idRef.current = server.id; revRef.current = server.revision; keyRef.current = server.id;
    setFields(f); setToText(f.to_addresses.join(", ")); setCcText(f.cc_addresses.join(", ")); setBccText(f.bcc_addresses.join(", "));
    setDraftId(server.id); setLocalKey(server.id);
    writeLocal(f, server.saved_at, server.id, server.id, server.revision); setSaveWord("saved");
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
      {requirements && (
        <div className="pad-x email-coverage" data-coverage="">
          <ReplyCoverage quiet requirements={requirements} text={fields.body_text} attachments={fields.attachment_refs.map((r) => ({ filename: r.filename, ...(r.mime_type ? { mime: r.mime_type } : {}) }))} overrides={coverageMarks} onOverride={markCoverage} />
        </div>
      )}

      {/* AC19: an edited or absent managed block is never silently rewritten; this is the explicit Replace choice
          (Dave's locked row-actions rule: a quiet text action in the key colour, never a capsule). */}
      {noSignature && !sigOffer && <div className="email-note quiet"><span>{NO_SIGNATURE_NOTE}</span><button className="quiet-action" onClick={() => setAddingSig(true)}>{ADD_SIGNATURE}</button></div>}
      {addingSig && currentAcct && (
        <SignatureSheet client={client} userId={userId} account={currentAcct} onClose={() => setAddingSig(false)}
          onSaved={(id, text, revision) => {
            announceSignature({ accountId: id, text, revision });
            setSigAdded(text);
            if (text) setFields((f) => ({ ...f, body_text: withSignature(f.body_text, text), signature_revision: revision }));
          }} />
      )}
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
        <button className="quiet-action" onClick={() => setAskDiscard(true)}>{DISCARD_DRAFT}</button>
      </div>
      <div className="screen-foot" />
      {askDiscard && (
        <RowActionSheet
          title={DISCARD_ASK}
          actions={[{ label: DISCARD_DRAFT, destructive: true, onPick: () => void discard() }]}
          onCancel={() => setAskDiscard(false)}
        />
      )}
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

