// THE EMAIL TAB, REDESIGNED IN PLACE (docs/jarvis-unified, slices 05 and 06;
// IMPLEMENTATION-SPEC.md 08 E01 to E11, E20 to E25, E28, E29; 09 M1, M2, M3,
// M8, M9; 10; 11; 13). Behind the email_intake_v1 flag the Email tab mounts
// this instead of the old MessagesFlow. What it is:
//
//   - every inbox row of every connected mailbox, newest first by Gmail's
//     receipt time with a stable id tiebreak, thirty at a time, under day
//     headers; no ranking, no collapsed threads, no category ever hides a row;
//   - honest freshness: the stalest good sync among the live accounts, under
//     the title, and a line when one account did not refresh while the other
//     did; one failing mailbox never blanks the other; while a mailbox is
//     still listing its 90-day window (Email v1 spec 8.1, 8.3, AC39) the line
//     says Catching Up on Mail instead of a time, and an empty list is a
//     loading list, never "Nothing in Your Inbox";
//   - search that says what it searched (saved mail, then Gmail, by account);
//   - the mail home (Email v1 spec 3.1 to 3.3, Dave 2026-10-12): the loaded
//     page in the five fixed sections (sections.ts), or All by Date, the
//     choice kept on this device; chips (the person's own areas) filter the
//     loaded rows in All by Date; an exact Message-ID held by two connected
//     mailboxes labels both rows Same Content and merges nothing;
//   - select mode (spec 11): a frozen selection, a section's own Select,
//     Select All Loaded, the tray's Read, Unread, Archive and Delete (Gmail's
//     Trash) in batches of 100 with an outcome per message, retry of only the
//     proven failures, and Undo of only what this action changed;
//   - the message, sanitised; read on open through a provider command the
//     person caused; archive and trash explicit, receipted, undoable;
//   - offline: the last page and the opened messages, readable, nothing
//     queued; reauth: the mail stays, the banner asks for the one fix;
//   - cards (slice 06): the deterministic rules read a loaded row's subject
//     and snippet, and an opened message's text, once per message per
//     version, and propose at most one card per kind; a card commits in one
//     tap through slice 03's atomic door and becomes a receipt line; manual
//     capture is the same sheet with empty fields and needs no model.
//
// The Gmail token is never here. Reads go to the cache with the session;
// commands go to api/email/* with the session; the server holds the grant.
// Nothing runs on a timer: open, pull, tap. The one thing that follows on
// from them is the coverage crawl the open or pull started: while a sync
// answers coverage_complete false, the open screen calls it again, one call
// after the other, at most CRAWL_MAX_ROUNDS times, and stops on a failure or
// when it closes. No card is ever an item until the person's tap makes it one.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import SkeletonRows from "../shared/SkeletonRows";
import RowActionSheet, { type RowAction } from "../shared/RowActionSheet";
import { ChevronRight, PenLine, RotateCcw, Search } from "../shared/icons";
import { usePushDepth } from "../shared/pushNav";
import { showToast } from "../shared/toast";
import { attemptWrite } from "../shared/guard";
import { supabase } from "../auth/supabaseClient";
import { useOptionalSession } from "../auth/AuthProvider";
import { useConnectionStatus } from "../connections/useConnectionStatus";
import { useOptionalCategories, useOptionalLedger, useFileStore, useStore, useUserId } from "../data/NotesProvider";
import { failure, lineFor, newRequestId, type CommandFailure } from "../substrate/commands/errors";
import { cancelCommand } from "../substrate/commands/sends";
import { fetchReadiness, notReadyLine, readinessFrom, type Readiness } from "../substrate/destinations/registry";
import type { CaptureKind, CapturePayload } from "../substrate/contracts";
import type { Category } from "../categories/types";
import type { Bill, Receipt } from "../money/ledger/types";
import ReceiptDetail from "../hub/ReceiptDetail";
import {
  ALL_CHIP, ARCHIVED, AREAS_LABEL, CAPTURE_KIND, CAPTURE_TITLE, EMAIL_TITLE, EMPTY_ACCOUNTS, EMPTY_FILTER, EMPTY_INBOX, EMPTY_WAITING, FIND_DETAILS, HIDE_DISMISSED, MESSAGE_TITLE, NOT_NOW,
  NO_CLIENT, OFFLINE_LINE, PULL_HINT, REAUTH_LINE, RECONNECT, REFRESHING, REFRESH_FAILED, REFRESH_LABEL, REMEMBER, RETRY, SEARCH_LABEL, SEGMENTS, SHOW_DISMISSED, SUGGEST_TITLE,
  TRASHED, UNDO, foundLine, type Segment,
  COMPOSE_LABEL, DRAFT_DISCARDED, DRAFT_KEPT, DRAFT_SAVED, DRAFT_SAVED_HERE, NOT_SENT_TITLE, NOW_CONFIRMED, SENT_TITLE, STILL_UNKNOWN, UNKNOWN_TITLE, SENDING_LINE, UNDONE_LINE,
  REVIEW_OPEN, reviewItemsLine, WAITING_TITLE, waitingDeleted,
  ACCOUNT_PICK_TITLE, ALL_ACCOUNTS_PICK, CANCEL, INBOX_TITLE, MOVE_TO_SECTION, NOTHING_SELECTED, PUT_BACK_SECTION, RECONNECT_FIRST, RETRY_FAILED, SEARCH_PLACEHOLDER, SELECT,
  SIGN_IN_FIRST, VIEW_DATE, VIEW_GROUPED, VIEW_LABEL, WAITING_SEGMENT_TITLE, selectAllLoaded, selectedWord,
} from "./copy";
import {
  answerSuggestion, inboxPage, listAccounts, mergeRows, mirrorAccounts, newestFirst, offerSuggestion, readMessage, syncAccount, PAGE,
  type EmailAccount, type InboxRow, type MessageDetail, type RpcClient,
} from "./emailClient";
import { forgetMessage, loadSnapshot, saveSnapshot } from "./deviceCache";
import { categoryOf, countsByCategory, fileUnder, loadRules, loadTags, notNow, remember, rowsUnderRule, ruleKeptLine, type RulesStore, type SuggestionDue, type Tags } from "./categories";
import { accountLabels, dayGroups, homeFreshness, isCatchingUp, senderOf } from "./format";
import { SECTION_KEYS, SECTION_NAME, SECTION_SLOT, groupSections, loadOverrides, loadView, loadedWord, recordMove, saveView, sameContent as sameContentOf, sectionOf, threadCounts, type HomeView, type Overrides } from "./sections";
import { OP_OF, REVERSE, attentionLine, doneLine, pickOf, reasonsOf, runBatch, tally, type BatchOutcome, type Picked, type TrayVerb } from "./bulk";
import MailSelectTray from "./MailSelectTray";
import type { BatchOp } from "./emailClient";
import EmailFacts from "./EmailFacts";
import { usePull } from "./usePull";
import InboxList from "./InboxList";
import MessageScreen, { type LeftInbox } from "./MessageScreen";
import SearchScreen, { EMPTY_SEARCH_STATE, type SearchState } from "./SearchScreen";
import AccountsScreen from "./AccountsScreen";
import ComposeScreen, { type ComposeStart } from "./ComposeScreen";
import SendReviewScreen from "./SendReviewScreen";
import SendOutcomeScreen from "./SendOutcomeScreen";
import HeldSendView from "./HeldSendView";
import { onSignatureSaved as listenSignature } from "./signatureBus";
import { isHeld, type HoldStatus } from "./drafts";
import type { HeldSend } from "./sendHold";
import DraftsScreen from "./DraftsScreen";
import ConnectionBanner from "./ConnectionBanner";
import { CHECK_SEND, OPEN_CONNECTIONS, RETRY_SYNC, VIEW_ACCOUNTS, statusHeadline, type HeadlineAction } from "./statusHeadline";
import { useReconnect } from "./useReconnect";
import { useOptionalGoogle } from "../connections/google/GoogleSession";
import { useIncidentLedger } from "../connections/useConnectionAnnouncements";
import { bannerModels, recoveryNotes } from "../connections/incidentView";
import { emptyFields, fieldsOf, getDraft, listDrafts, newLocalKey, outcomeOf, pausedOpenTarget, reconcileSend, reopenDraft, replyFields, saveDraft, sendApproved, withSignature, type DraftFields, type DraftRow, type LocalDraft, type Review } from "./drafts";
import WaitingList, { type WaitingView } from "./WaitingList";
import WaitingDetail, { type FollowUpStart } from "./WaitingDetail";
import { localDate, pausedSends, reviewCount, reviewList, threadsLatest, type EmailFocus, type LatestInThread, type PausedSends } from "./waiting";
import ReviewListScreen from "./ReviewListScreen";
import PausedScreen from "./PausedScreen";
import type { ActionResult } from "../substrate/commands/captures";
import { useFreshLists } from "../data/useFreshLists";
import type { ThreadBriefAI } from "../messages/threadBrief";
import { WaitingService } from "../substrate/waiting/WaitingService";
import type { WaitingItem } from "../substrate/waiting/types";
import { replySubject } from "../connections/google/map";
import EmptyState from "./EmptyState";
import CandidateCards from "./CandidateCards";
import CaptureSheet from "./CaptureSheet";
import {
  candidatesFor, contextFor, isProvisional, isToReview, proposeCandidate, proposeExtracted, readWithRules, readerZone, readingKey, readingsOf, rememberReading, textOf,
  type Candidate,
} from "./candidates";
import { EXTRACTOR_VERSION } from "../substrate/extract";

/** Crawl calls per open or pull. A 90-day window of a few thousand messages is listed well inside it; the next open carries on from the saved page. */
export const CRAWL_MAX_ROUNDS = 40;
/** Calls in a row that moved nothing (another tab took the page, a reconciliation still cut off) after which a mailbox waits for the next open or pull. */
export const CRAWL_MAX_IDLE = 2;

type Screen =
  | { kind: "root" }
  | { kind: "message"; row: InboxRow; from: "inbox" | "search" | "review" }
  // Every card the review count counts, with its message (Dave 2026-10-12: the count lives in Email, all of it reachable).
  | { kind: "reviewList" }
  // V10: the sends that stopped before Gmail, each reviewed on its own.
  | { kind: "paused" }
  | { kind: "search" }
  | { kind: "accounts" }
  | { kind: "receipt"; actionId: string; from: Screen }
  // Slice 07: the composer, the exact review, the outcome, the drafts.
  | { kind: "compose"; start: ComposeStart; from: Screen }
  | { kind: "review"; draftId: string; revision: number; fields: DraftFields; review: Review; requestId: string; start: ComposeStart; from: Screen }
  | { kind: "outcome"; draft: DraftRow }
  // Email v1: approved and HELD on the server for 30 seconds (migration 0059); Undo brings the draft back.
  | { kind: "held"; actionId: string; held: HeldSend; receivedAt: number; draftId: string; subject: string; from: string; recipients: string[]; start: ComposeStart; origin: Screen }
  | { kind: "drafts" }
  // Slice 08: one waiting record.
  | { kind: "waiting"; id: string };

const outcomeTitle = (d: DraftRow): string => { const o = outcomeOf(d); return o === "sent" ? SENT_TITLE : o === "unknown" ? UNKNOWN_TITLE : o === "failed" ? NOT_SENT_TITLE : SENDING_LINE; };

interface Question extends SuggestionDue { suggestionId: string | null }

const rowOf = (m: MessageDetail): InboxRow => ({
  id: m.id, account_id: m.account_id, account: m.account, provider_id: m.provider_id, thread_id: m.thread_id, internal_date: m.internal_date,
  from_address: m.from_address, from_name: m.from_name, subject: m.subject, snippet: m.snippet, has_body: m.has_body,
  attachment_metadata: m.attachments ?? [], provider_labels: m.provider_labels, source_hash: m.source_hash, read: m.read,
});

/** A manual capture starts empty, with what the message already says (the sender, its date) filled in and the rest named as missing. */
export function manualStart(kind: CaptureKind, row: InboxRow, zone: string, now: Date): { payload: CapturePayload; missing: string[] } {
  const who = row.from_name.trim() || row.from_address;
  const day = row.internal_date.slice(0, 10);
  switch (kind) {
    case "bill": return { payload: { kind, issuer: who, amount: { minor_units: 0, currency: "" }, due_date: null, no_due_date_confirmed: false }, missing: ["amount", "currency", "due_date"] };
    case "receipt": return { payload: { kind, merchant: who, amount: { minor_units: 0, currency: "" }, purchase_date: day, transaction_type: "purchase" }, missing: ["amount", "currency"] };
    case "task": return { payload: { kind, title: "", due_date: null, notes: "" }, missing: ["title"] };
    case "event": {
      const start = new Date(now.getTime() + 3600e3); start.setMinutes(0, 0, 0);
      const end = new Date(start.getTime() + 3600e3);
      return { payload: { kind, title: "", time: { all_day: false, start_at: start.toISOString(), end_at: end.toISOString(), timezone: zone, selected_offset: "" }, location: null, external_uid: null }, missing: ["title"] };
    }
    case "waiting": return { payload: { kind, title: "", waiting_for: "", counterparty_display: who, contact_id: null, follow_up_on: null }, missing: ["title", "waiting_for"] };
  }
}

export default function EmailFlow({ onOpenConnections, onOpenEntity, onOpenModule, openId, openNonce, onOpenConsumed, focus, focusNonce, onFocusConsumed, client: given, token: givenToken, userId: givenUser, categories: givenCategories, now: nowFn = () => new Date(), zone: givenZone, initialScreen, waiting: givenWaiting, briefAI: givenBriefAI }: {
  onOpenConnections: () => void;
  /** A life record's own screen (a receipt's destination). */
  onOpenEntity?: (kind: string, id: string) => void;
  /** A module's tab, when a record has no screen of its own to open (Money). */
  onOpenModule?: (module: string) => void;
  /** A message id another surface asked for (the Hub's evidence, a receipt). */
  openId?: string | null;
  openNonce?: number;
  onOpenConsumed?: () => void;
  /** The session's client, token and user. A test passes its own; undefined means the app's. */
  client?: RpcClient | null;
  token?: string | null;
  userId?: string;
  categories?: Category[];
  now?: () => Date;
  /** The reader's zone; a test pins it. */
  zone?: string;
  /** Where a bench or a test starts; the app always starts at the root. */
  initialScreen?: "search" | "accounts";
  /** A focus another surface asked for (Today's review line, a waiting record). */
  focus?: EmailFocus | null;
  focusNonce?: number;
  onFocusConsumed?: () => void;
  /** The Waiting store. A test passes its own; undefined means the app's. */
  waiting?: WaitingService | null;
  /** The thread reading behind a reply's "Answered X of Y", from the shell. Absent: no coverage line, and nothing else changes. */
  briefAI?: ThreadBriefAI | null;
}) {
  const client: RpcClient | null = given === undefined ? supabase : given;
  const session = useOptionalSession();
  const token = givenToken === undefined ? session?.access_token ?? null : givenToken;
  const ctxUser = useUserId();
  const userId = givenUser ?? ctxUser ?? "local";
  const catsSvc = useOptionalCategories();
  const ledger = useOptionalLedger();
  const store = useStore();
  const zone = givenZone ?? readerZone();
  // The thread reading is handed in from the shell: this module imports no model client (SUBSTRATE law 5), and with
  // none given, or with AI off, the composer simply shows no coverage line.
  const briefAI: ThreadBriefAI | null = givenBriefAI ?? null;

  const snapshot = useMemo(() => loadSnapshot(userId), [userId]);
  const [accounts, setAccounts] = useState<EmailAccount[]>(snapshot?.accounts ?? []);
  // A signature saved in Settings (Email Signatures) is the one the next compose inserts, without a reload.
  useEffect(() => listenSignature(({ accountId, text, revision }) =>
    setAccounts((prev) => prev.map((a) => (a.id === accountId ? { ...a, signature_text: text, signature_revision: revision } : a)))), []);
  const [rows, setRows] = useState<InboxRow[]>(snapshot?.rows ?? []);
  const [cachedTotal, setCachedTotal] = useState<number>(snapshot?.rows.length ?? 0);
  const [providerNext, setProviderNext] = useState<Record<string, string | null>>({});
  const [pending, setPending] = useState(true);
  const [moreBusy, setMoreBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<CommandFailure | null>(null);
  const [syncIssues, setSyncIssues] = useState<Record<string, string>>({});
  const [offline, setOffline] = useState(typeof navigator !== "undefined" && navigator.onLine === false);
  const [segment, setSegment] = useState<Segment>("inbox");
  const [chip, setChip] = useState<string | null>(null);
  // The mail home (spec 3.1): grouped or by date, kept per device; Move to Section, kept per device; one account or all.
  const [view, setView] = useState<HomeView>(() => loadView(userId));
  const [overrides, setOverrides] = useState<Overrides>(() => loadOverrides(userId));
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const [pickingAccount, setPickingAccount] = useState(false);
  const [movingRow, setMovingRow] = useState<InboxRow | null>(null);
  // Select mode (spec 11): the selection is frozen at each tap, as exact messages, never "whatever is loaded later".
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState<{ op: BatchOp; done: number; attention: BatchOutcome[]; retry: Picked[] } | null>(null);
  const [bulkBlocked, setBulkBlocked] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>(initialScreen ? { kind: initialScreen } : { kind: "root" });
  const [search, setSearch] = useState<SearchState>(EMPTY_SEARCH_STATE);
  const [searchChip, setSearchChip] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>(givenCategories ?? []);
  const [tags, setTags] = useState<Tags>(() => loadTags(userId));
  const [rules, setRules] = useState<RulesStore>(() => loadRules(localStorage));
  const [question, setQuestion] = useState<Question | null>(null);
  // Cards (slice 06).
  const [cards, setCards] = useState<Record<string, Candidate[]>>({});
  const [showDismissed, setShowDismissed] = useState(false);
  const [sheet, setSheet] = useState<{ candidate: Candidate; row: InboxRow; text?: string } | null>(null);
  const [capturing, setCapturing] = useState<{ row: InboxRow; text?: string } | null>(null);
  const [readiness, setReadiness] = useState<Readiness>(() => readinessFrom(null, "unknown"));
  const [bills, setBills] = useState<Bill[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const bodyText = useRef<Record<string, string>>({});
  const loaded = useRef(false);
  // Compose, review, send (slice 07).
  const fileStore = useFileStore();
  const [sending, setSending] = useState(false);
  const [sendFailure, setSendFailure] = useState<CommandFailure | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkLine, setCheckLine] = useState<string | CommandFailure | null>(null);
  const [draftsReload, setDraftsReload] = useState(0);
  // Waiting (slice 08).
  const waitingSvc = useMemo(() => (givenWaiting !== undefined ? givenWaiting : store ? new WaitingService(store, userId) : null), [givenWaiting, store, userId]);
  const [waitingItems, setWaitingItems] = useState<WaitingItem[]>([]);
  const [waitingView, setWaitingView] = useState<WaitingView>("open");
  const [waitingLatest, setWaitingLatest] = useState<Record<string, LatestInThread>>({});
  /** The server's review count (the number Today used to carry), read on each load: the door to the review list. */
  const [reviewTotal, setReviewTotal] = useState<number | null>(null);
  /** The review list's messages; null until read. */
  const [reviewRows, setReviewRows] = useState<InboxRow[] | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [paused, setPaused] = useState<PausedSends | null>(null);
  // How many replies are paused, read while a banner is up, so View Paused Actions is offered only when there is one to view.
  const [pausedCount, setPausedCount] = useState<number | null>(null);
  // The sent rows (draft_list), for the send tier of the headline: an unknown outcome is its own state (spec 8.1, 10).
  const [sentRows, setSentRows] = useState<DraftRow[]>([]);
  const [pausedFailure, setPausedFailure] = useState<CommandFailure | null>(null);
  /** Waiting records this screen just saw saved, by id: shown at once, before the list's own cache catches up. */
  const tracked = useRef<Record<string, WaitingItem>>({});
  // The message is a sheet over whichever screen it opened from (Astra's
  // bottom-sheet design, 2026-10-10), not a push: its depth is its parent's,
  // so the dimmed inbox or search list underneath never slides.
  const depth = screen.kind === "message" ? (screen.from === "search" || screen.from === "review" ? 1 : 0)
    : screen.kind === "root" ? 0
      : screen.kind === "receipt" || screen.kind === "review" || screen.kind === "outcome" || screen.kind === "drafts" ? 2
        : screen.kind === "compose" && screen.from.kind !== "root" ? 2 : 1;
  const pushCls = usePushDepth(depth);
  const now = nowFn();

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => {
    if (givenCategories) { setCategories(givenCategories); return; }
    let alive = true;
    void catsSvc?.list().then((c) => { if (alive) setCategories(c); });
    return () => { alive = false; };
  }, [catsSvc, givenCategories]);

  // Which doors are open, asked once; a module that cannot be proven ready is not.
  useEffect(() => {
    if (!client) return;
    let alive = true;
    void fetchReadiness((fn) => client.rpc(fn, {})).then((r) => { if (alive) setReadiness(r); });
    return () => { alive = false; };
  }, [client]);

  // Money's own records, for the cross-message duplicate question (10.1 step 7).
  useEffect(() => {
    if (!ledger) return;
    let alive = true;
    void Promise.all([ledger.listBills(), ledger.listReceipts()]).then(([b, r]) => { if (alive) { setBills(b); setReceipts(r); } }).catch(() => { /* Money not reachable: no conflict line, the save still asks the server */ });
    return () => { alive = false; };
  }, [ledger, cards]);

  const persist = useCallback((a: EmailAccount[], r: InboxRow[]) => saveSnapshot(userId, { accounts: a, rows: r }), [userId]);

  // ---- cards --------------------------------------------------------------

  const loadCards = useCallback(async (ids: string[], includeDismissed = showDismissed) => {
    if (!client || ids.length === 0) return;
    const r = await candidatesFor(client, ids, includeDismissed);
    if (!r.ok) return;
    setCards((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = [];
      for (const c of r.value) (next[c.message_id] ??= []).push(c);
      return next;
    });
  }, [client, showDismissed]);

  // The rules over a loaded row's subject and snippet, once per message per
  // version on this phone (the server deduplicates by fingerprint anyway).
  const readRows = useCallback(async (list: InboxRow[]) => {
    if (!client || offline) return;
    const seen = readingsOf(userId);
    const touched: string[] = [];
    for (const row of list) {
      const key = readingKey(row.account_id, row.id, row.source_hash);
      if (seen.has(key)) continue;
      const proposals = readWithRules(row, zone);
      // A reading is remembered only when every proposal reached the server:
      // a dropped signal is read again next time, not lost to this phone.
      let kept = true;
      if (proposals.length) {
        kept = (await proposeExtracted(client, proposals, { id: row.id, source_hash: row.source_hash })).failed === 0;
        touched.push(row.id);
      }
      if (kept) rememberReading(userId, key);
    }
    if (touched.length) await loadCards(touched);
  }, [client, offline, userId, zone, loadCards]);

  // The rules over an opened message's text, once per message per version;
  // Find Useful Details reads it again on purpose.
  const readBody = useCallback(async (row: InboxRow, text: string, force = false): Promise<number> => {
    bodyText.current[row.id] = text;
    if (!client || offline) return 0;
    const key = readingKey(row.account_id, row.id, row.source_hash) + ":body";
    if (!force && readingsOf(userId).has(key)) return 0;
    const proposals = readWithRules(row, zone, text);
    let kept = true;
    if (proposals.length) kept = (await proposeExtracted(client, proposals, { id: row.id, source_hash: row.source_hash })).failed === 0;
    if (kept) rememberReading(userId, key);
    await loadCards([row.id]);
    return proposals.length;
  }, [client, offline, userId, zone, loadCards]);

  // A calendar file attached to an opened message (ruling 6): its event, read once per message version, and only
  // its event (an invite's text is not a bill or a task). The card it proposes waits for the person's tap.
  const readCalendarFile = useCallback(async (row: InboxRow, ics: string): Promise<void> => {
    if (!client || offline || !/BEGIN:VCALENDAR/.test(ics)) return;
    const key = readingKey(row.account_id, row.id, row.source_hash) + ":ics";
    if (readingsOf(userId).has(key)) return;
    const proposals = readWithRules(row, zone, ics).filter((p) => p.kind === "event");
    let kept = true;
    if (proposals.length) kept = (await proposeExtracted(client, proposals, { id: row.id, source_hash: row.source_hash })).failed === 0;
    if (kept) rememberReading(userId, key);
    if (proposals.length) await loadCards([row.id]);
  }, [client, offline, userId, zone, loadCards]);

  useEffect(() => {
    // Dismissed cards shown or hidden: the page reads again.
    const ids = Object.keys(cards);
    if (ids.length) void loadCards(ids, showDismissed);
    // Only the switch matters here.
  }, [showDismissed]);

  const ready = useCallback((kind: CaptureKind) => readiness.kinds[kind].state === "ready", [readiness]);
  const readyLine = useCallback((kind: CaptureKind) => { const k = readiness.kinds[kind]; return k.state === "ready" ? "" : k.reason || notReadyLine(kind); }, [readiness]);

  // 2026-10-05: a boolean. The saved record that matches is the SAME vendor, amount and date as the card by construction, so showing
  // it again under the card (vendor, amount, date, joined by middle dots) was a second grey line repeating the card above it.
  // The card says "This May Already Be Saved" in amber, once, and asks.
  const conflictOf = useCallback((c: Candidate): boolean => {
    if (c.saved_sibling) return false;
    const p = c.payload;
    if (p.kind === "bill") return bills.some((b) => b.data.vendor.trim().toLowerCase() === p.issuer.trim().toLowerCase() && b.data.amountCents === p.amount.minor_units && (b.data.dueDate ?? null) === p.due_date);
    if (p.kind === "receipt") return receipts.some((r) => r.data.vendor.trim().toLowerCase() === p.merchant.trim().toLowerCase() && r.data.amountCents === p.amount.minor_units && r.data.transactionDate === p.purchase_date);
    return false;
  }, [bills, receipts]);

  // A stale card: read the message again with the rules and open the refreshed card.
  const reviewLatest = useCallback(async (c: Candidate, row: InboxRow) => {
    if (!client) return;
    let text = bodyText.current[row.id];
    let current = row;
    const m = await readMessage(client, row.id);
    if (m.ok) { current = rowOf(m.value); text = m.value.has_body ? textOf(m.value) : text; }
    const n = await readBody(current, text ?? current.snippet, true);
    const r = await candidatesFor(client, [row.id], showDismissed);
    if (!r.ok) return;
    setCards((prev) => ({ ...prev, [row.id]: r.value }));
    const fresh = r.value.filter((x) => x.kind === c.kind && isProvisional(x) && x.source_hash === x.message_source_hash).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
    if (fresh) setSheet({ candidate: fresh, row: current, text });
    else showToast({ message: foundLine(n) });
  }, [client, readBody, showDismissed]);

  // Manual capture: an empty card of the chosen kind, then the sheet.
  const startCapture = useCallback(async (row: InboxRow, kind: CaptureKind, text?: string) => {
    if (!client) return;
    const start = manualStart(kind, row, zone, now);
    const r = await proposeCandidate(client, {
      message_id: row.id, kind, payload: start.payload, provenance: {}, missing: start.missing,
      fingerprint: `manual:${kind}:${now.getTime().toString(36)}`, extractor_version: "manual", source_hash: row.source_hash, origin: "manual",
    });
    if (!r.ok) { showToast({ message: lineFor(r) }); return; }
    const list = await candidatesFor(client, [row.id], showDismissed);
    if (!list.ok) return;
    setCards((prev) => ({ ...prev, [row.id]: list.value }));
    const made = list.value.find((x) => x.id === r.value.candidate_id);
    if (made) setSheet({ candidate: made, row, text });
  }, [client, zone, now, showDismissed]);

  const cardsFor = (row: InboxRow, place: "finish" | "rest" | "all" = "all"): ReactNode => {
    const list = cards[row.id];
    if (!client || !list || list.length === 0) return null;
    return (
      <CandidateCards place={place} onSaved={onCardSaved} client={client} candidates={list} row={row} ctx={contextFor(row, zone, nowFn)} ready={ready} readyLine={readyLine} offline={offline}
        evidenceExcerpt={bodyText.current[row.id]?.slice(0, 2000)} showDismissed={showDismissed} conflictOf={conflictOf} now={nowFn}
        onChanged={() => loadCards([row.id])} onDetails={(c) => setSheet({ candidate: c, row, text: bodyText.current[row.id] })} onReview={(c) => void reviewLatest(c, row)}
        onReceipt={(actionId) => setScreen((s) => ({ kind: "receipt", actionId, from: s }))}
        onOpenModule={(module, destinationId) => { if (destinationId && module !== "Money" && onOpenEntity) onOpenEntity(module === "Tasks" ? "task" : module === "Schedule" ? "event" : "waiting", destinationId); else onOpenModule?.(module); }} />
    );
  };

  // ---- the inbox ------------------------------------------------------------

  // The first page from the cache, merged into what is shown. The first page is
  // the truth for what it covers; on a refresh (or a crawl round) rows the
  // person had already scrolled to, older than its last row, stay where they were.
  const showFirstPage = useCallback(async (accountsNow: EmailAccount[], keepOlder: boolean): Promise<CommandFailure | InboxRow[]> => {
    if (!client) return failure("UNAVAILABLE");
    const page = await inboxPage(client, { limit: PAGE });
    if (!page.ok) return page;
    const fresh = page.value.rows;
    setCachedTotal(page.value.cached_total);
    let merged: InboxRow[] = fresh;
    setRows((prev) => {
      const last = fresh[fresh.length - 1];
      const older = keepOlder && last && fresh.length >= PAGE ? prev.filter((r) => newestFirst(last, r) < 0) : [];
      merged = mergeRows(fresh, older);
      persist(accountsNow, merged);
      return merged;
    });
    return merged;
  }, [client, persist]);
  /** The cards for what was just shown, and the rules over it. */
  const readShown = useCallback(async (shown: InboxRow[]) => {
    await loadCards(shown.map((r) => r.id));
    void readRows(shown);
  }, [loadCards, readRows]);

  // ---- the coverage crawl (Email v1 spec 8.3) --------------------------------
  // A sync that answers coverage_complete false has more of the 90-day window
  // to list or reconcile. While this screen is open it asks again, one call
  // after the other: each call is the server's own bounded work (a few pages,
  // about ten seconds at most), so the calls pace themselves and no timer is
  // set (SUBSTRATE law 5: nothing in Email runs on a timer). At most
  // CRAWL_MAX_ROUNDS calls per open or pull; a failure stops that mailbox
  // until the next open or pull (no retrying without the person); a mailbox
  // that makes no progress twice running stops too. Closing the screen, or a
  // new load, ends the run. The server keeps the progress, so the next open
  // carries on where this one stopped.
  const crawlRun = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; crawlRun.current++; };
  }, []);
  const crawl = useCallback(async (start: string[]) => {
    const run = ++crawlRun.current;
    const live = () => crawlRun.current === run && mounted.current && !(typeof navigator !== "undefined" && navigator.onLine === false);
    const idle: Record<string, number> = {};
    let pending = start;
    for (let round = 0; round < CRAWL_MAX_ROUNDS && pending.length > 0; round++) {
      if (!client || !token || !live()) return;
      const results = await Promise.all(pending.map((address) => syncAccount(token, address)));
      if (!live()) return;
      const still: string[] = [];
      const issues: Record<string, string> = {};
      const cleared: string[] = [];
      results.forEach((r, i) => {
        const address = pending[i]!;
        if (!r.ok) { issues[address] = lineFor(r); return; }
        cleared.push(address);
        if (r.value.coverage_complete !== false) return;
        idle[address] = r.value.synced + r.value.removed > 0 ? 0 : (idle[address] ?? 0) + 1;
        if (idle[address]! < CRAWL_MAX_IDLE) still.push(address);
      });
      setSyncIssues((prev) => { const next = { ...prev, ...issues }; for (const a of cleared) delete next[a]; return next; });
      const again = await listAccounts(client);
      if (!live()) return;
      const accountsNow = again.ok ? again.value : accounts;
      if (again.ok) setAccounts(again.value);
      const shown = await showFirstPage(accountsNow, true);
      if (!live()) return;
      if (Array.isArray(shown)) void readShown(shown);
      pending = still;
    }
  }, [client, token, accounts, showFirstPage, readShown]);

  // The one load: accounts, a sync of each live mailbox (this is the pull or
  // the open), then the first page from the cache. A failure with saved rows
  // keeps them and says so; without any, it is the error state with Retry.
  // One mailbox failing to sync is a line, not a blank. A mailbox still
  // crawling its window is handed to the crawl above.
  const load = useCallback(async (mode: "first" | "refresh") => {
    if (!client) { setPending(false); setError(failure("UNAVAILABLE")); return; }
    if (offline) { setPending(false); return; }
    if (mode === "refresh") setRefreshing(true);
    setError(null);
    let acc = await listAccounts(client);
    if (acc.ok && acc.value.length === 0 && token) {
      await mirrorAccounts(token);
      acc = await listAccounts(client);
    }
    if (!acc.ok) { setError(acc); setPending(false); setRefreshing(false); return; }
    let accountsNow = acc.value;
    setAccounts(accountsNow);
    const crawling: string[] = [];
    if (token) {
      const live = accountsNow.filter((a) => a.state !== "disconnected");
      const results = await Promise.all(live.map((a) => syncAccount(token, a.address)));
      const issues: Record<string, string> = {};
      const next: Record<string, string | null> = {};
      results.forEach((r, i) => {
        const a = live[i]!;
        if (!r.ok) issues[a.address] = lineFor(r);
        else {
          next[a.address] = r.value.next_page;
          if (r.value.coverage_complete === false) crawling.push(a.address);
        }
      });
      setSyncIssues(issues);
      setProviderNext(next);
      const again = await listAccounts(client);
      if (again.ok) { accountsNow = again.value; setAccounts(accountsNow); }
    }
    const shown = await showFirstPage(accountsNow, mode === "refresh");
    if (!Array.isArray(shown)) { setError(shown); setPending(false); setRefreshing(false); return; }
    setPending(false);
    setRefreshing(false);
    await readShown(shown);
    // The person's open or pull starts a fresh allowance of crawl calls (and ends any run still going).
    if (crawling.length > 0) void crawl(crawling);
  }, [client, token, offline, showFirstPage, readShown, crawl]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void load("first");
  }, [load]);

  const hasProviderNext = Object.values(providerNext).some(Boolean);
  // While a mailbox is still listing its window the cache is not the mailbox: the floor says "what's loaded so far", never "That's everything." (8.3).
  const atEnd = rows.length >= cachedTotal && !(hasProviderNext && token && !offline) && !accounts.some(isCatchingUp);

  // Load More: the next page of the cache; when the cache is spent and Gmail
  // said there was more, the next provider page is pulled in first (a tap,
  // never a timer), then read back from the cache in the one order.
  const loadMore = useCallback(async () => {
    if (!client || moreBusy) return;
    const last = rows[rows.length - 1];
    if (!last) return;
    setMoreBusy(true);
    if (rows.length >= cachedTotal && token && !offline) {
      const next: Record<string, string | null> = { ...providerNext };
      for (const [address, pageToken] of Object.entries(providerNext)) {
        if (!pageToken) continue;
        const r = await syncAccount(token, address, pageToken);
        next[address] = r.ok ? r.value.next_page : null;
        if (!r.ok) setSyncIssues((s) => ({ ...s, [address]: lineFor(r) }));
      }
      setProviderNext(next);
    }
    const page = await inboxPage(client, { before: { internal_date: last.internal_date, provider_id: last.provider_id }, limit: PAGE });
    setMoreBusy(false);
    if (!page.ok) { showToast({ message: lineFor(page) }); return; }
    setCachedTotal(page.value.cached_total);
    setRows((prev) => { const merged = mergeRows(prev, page.value.rows); persist(accounts, merged); return merged; });
    await loadCards(page.value.rows.map((r) => r.id));
    void readRows(page.value.rows);
  }, [client, rows, cachedTotal, token, offline, providerNext, moreBusy, accounts, persist, loadCards, readRows]);

  const patchRow = useCallback((patch: Partial<InboxRow> & { id: string }) => {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === patch.id ? { ...r, ...patch } : r));
      persist(accounts, next);
      return next;
    });
  }, [accounts, persist]);

  // The Undo on the toast runs the reverse provider command; when Gmail
  // confirms, the row comes back exactly where the clock puts it.
  const restoreRow = useCallback((row: InboxRow, restored: Partial<InboxRow>) => {
    setRows((prev) => { const next = mergeRows(prev, [{ ...row, ...restored }]); persist(accounts, next); return next; });
    setCachedTotal((n) => n + 1);
  }, [accounts, persist]);

  const leftInbox = useCallback((row: InboxRow, info: LeftInbox) => {
    setRows((prev) => { const next = prev.filter((r) => r.id !== row.id); persist(accounts, next); return next; });
    setCachedTotal((n) => Math.max(0, n - 1));
    forgetMessage(userId, row.id);
    showToast({ message: info.op === "archive" ? ARCHIVED : TRASHED, actionLabel: UNDO, onAction: () => void (async () => { if (await info.undo()) restoreRow(row, info.restored); })() });
  }, [accounts, persist, userId, restoreRow]);

  const onFileUnder = useCallback(async (row: InboxRow, categoryId: string) => {
    const filed = fileUnder(userId, row, categoryId, now.toISOString());
    setTags(filed.tags);
    if (!filed.suggestion) return;
    let suggestionId: string | null = null;
    if (client && !offline) {
      const offered = await offerSuggestion(client, filed.suggestion.rule, filed.suggestion.evidence_tap_ids);
      if (offered.ok) suggestionId = offered.value.suggestion_id;
    }
    setQuestion({ ...filed.suggestion, suggestionId });
  }, [userId, now, client, offline]);

  const answer = useCallback(async (q: Question, yes: boolean) => {
    setQuestion(null);
    const at = now.toISOString();
    setRules(yes ? remember(q.rule, q.suggestionId, at) : notNow(q.rule, at));
    // S10: the receipt names the exact count the rule tags right now, on this phone; every row stays in All.
    if (yes) showToast({ message: ruleKeptLine(rowsUnderRule(rows, q.rule)) });
    if (client && q.suggestionId && !offline) await answerSuggestion(client, q.suggestionId, yes ? "accepted" : "dismissed");
  }, [client, offline, now, rows]);

  // One handler for every inbox row, so a memoised row is not redrawn by a new closure (slice 09).
  const openInboxRow = useCallback((row: InboxRow) => setScreen({ kind: "message", row, from: "inbox" }), []);

  // A message another surface asked for: found in the loaded rows, else read
  // from the cache; an id that is not the person's simply does not open.
  useEffect(() => {
    if (!openId || !openNonce || !client) return;
    let alive = true;
    (async () => {
      const found = rows.find((r) => r.id === openId);
      if (found) { setScreen({ kind: "message", row: found, from: "inbox" }); onOpenConsumed?.(); return; }
      const m = await readMessage(client, openId);
      if (!alive) return;
      if (m.ok) { setScreen({ kind: "message", row: rowOf(m.value), from: "inbox" }); void loadCards([openId]); }
      onOpenConsumed?.();
    })();
    return () => { alive = false; };
    // One open per nonce.
  }, [openId, openNonce]);

  const { armed, handlers } = usePull(() => void load("refresh"), !!client && !offline && !refreshing && screen.kind === "root");

  const catOf = useCallback((r: InboxRow) => categoryOf(r, tags, rules), [tags, rules]);
  // One account or all of them (spec 3.1: the account filter is explicit, visible and clearable).
  const accountRows = useMemo(() => (accountFilter ? rows.filter((r) => r.account === accountFilter) : rows), [rows, accountFilter]);
  const counts = useMemo(() => countsByCategory(accountRows, tags, rules), [accountRows, tags, rules]);
  const chips = useMemo(() => categories.filter((c) => (counts[c.id] ?? 0) > 0), [categories, counts]);
  // The person's areas filter All by Date; the five sections are the grouped view's organisation and no chip narrows them.
  const chipOn = view === "date" ? chip : null;
  const visible = useMemo(() => (chipOn ? accountRows.filter((r) => catOf(r) === chipOn) : accountRows), [accountRows, chipOn, catOf]);
  const groups = useMemo(() => (view === "grouped"
    ? groupSections(visible, overrides).map((g) => ({ label: SECTION_NAME[g.key], rows: g.rows, count: loadedWord(g.rows.length), slot: SECTION_SLOT[g.key] }))
    : dayGroups(visible, now)), [view, visible, overrides, now]);
  // The Grouped view says when a message belongs to a thread of two or more loaded messages; All by Date stays plain.
  const threads = useMemo(() => (view === "grouped" ? threadCounts(visible) : undefined), [view, visible]);
  // Spec 3.3: an exact Message-ID in two connected mailboxes is a label on both rows. Nothing merges and nothing hides.
  const same = useMemo(() => sameContentOf(rows), [rows]);
  const chooseView = (v: HomeView) => { setView(v); saveView(userId, v); };
  const live = accounts.filter((a) => a.state !== "disconnected");
  // A mailbox still listing its window (spec 8.1, AC39): the header says Catching Up on Mail and an empty list is still loading.
  const catchingUp = live.some(isCatchingUp);
  const labels = live.length > 1 ? accountLabels(live.map((a) => a.address)) : {};
  // THE ONE STATUS (Foundation Fix Spec 1). Whether a mailbox needs reconnecting comes from the proven status, not from the
  // cache row's own state: the two used to disagree. The row's state is only the answer until the first proof arrives.
  const conn = useConnectionStatus(token, token ? userId : null);
  // THE LOUD BANNER (Foundation Fix Spec 3). While an incident is open it replaces the quieter notes below: the banner is the one
  // statement of the failure, and it carries the reconnect and the other two ways out itself.
  const incidents = useIncidentLedger(token ? userId : null);
  const banners = conn.answer ? bannerModels(conn.answer.accounts, incidents.ledger) : [];
  // "Mail Up to Date" only when the mailbox's own sync state is current (spec 8.1), never on a finished page alone.
  const recovery = conn.answer ? recoveryNotes(conn.answer.accounts, incidents.ledger, new Date(), (email) => accounts.find((a) => a.address.toLowerCase() === email)?.sync_state) : [];
  // ONE-TAP RECONNECT (Foundation Fix Spec 4): the banner's button opens Google for the exact account, and the server proves the
  // result before anything shows green. Without a Google session in this build it goes where it always went, to Connections.
  const google = useOptionalGoogle();
  const reconnect = useReconnect({
    token, reconnect: google ? google.reconnect : null, knownEmails: accounts.map((a) => a.address),
    refreshStatus: conn.refresh, catchUp: () => load("refresh"), fallback: onOpenConnections,
  });
  // THE ONE HEADLINE (spec 2.5, 8.1; 2026-10-12): user Pause or Remove, then authorization, then a send that needs
  // checking, then catch-up or staleness, then the healthy timestamp the header already shows. While a banner is up it is
  // the statement of the authorization or sync failure, so those two tiers draw nothing more; the person's own choice and
  // an unknown send are different states (spec 2.9) and still say so.
  const headline = statusHeadline({ accounts, views: conn.views, sent: sentRows, scope: accountFilter });
  const headlineShown = headline.facts.length > 0 && !(banners.length > 0 && (headline.tier === "auth" || headline.tier === "sync"));
  const runHeadline = (a: HeadlineAction) => {
    if (a.kind === "reconnect") void reconnect.start(a.email);
    else if (a.kind === "accounts") setScreen({ kind: "accounts" });
    else if (a.kind === "connections") onOpenConnections();
    else if (a.kind === "retry_sync") void load("refresh");
    else { setCheckLine(null); setScreen({ kind: "outcome", draft: a.draft }); }
  };
  const headlineLabel = (a: HeadlineAction): string => (a.kind === "reconnect" ? RECONNECT : a.kind === "check_send" ? CHECK_SEND : a.kind === "retry_sync" ? RETRY_SYNC : a.kind === "connections" ? OPEN_CONNECTIONS : VIEW_ACCOUNTS);
  const accountOf = (row: InboxRow) => accounts.find((a) => a.id === row.account_id) ?? null;

  // ---- select mode (spec 11) --------------------------------------------------
  const pickedIds = useMemo(() => new Set(picked.map((p) => p.rowId)), [picked]);
  const isPicked = useCallback((id: string) => pickedIds.has(id), [pickedIds]);
  // Stable handlers, so a memoised row redraws only when its own circle changed.
  const onPick = useCallback((row: InboxRow) => setPicked((prev) => (prev.some((p) => p.rowId === row.id) ? prev.filter((p) => p.rowId !== row.id) : [...prev, pickOf(row)])), []);
  const onPickGroup = useCallback((list: InboxRow[], pick: boolean) => setPicked((prev) => (pick
    ? [...prev, ...list.filter((r) => !prev.some((p) => p.rowId === r.id)).map(pickOf)]
    : prev.filter((p) => !list.some((r) => r.id === p.rowId)))), []);
  const startSelect = () => { setSelecting(true); setPicked([]); setBulkNote(null); setBulkBlocked(null); };
  const endSelect = () => { setSelecting(false); setPicked([]); setBulkNote(null); setBulkBlocked(null); };

  /** What Gmail confirmed, on the screen: rows that left the inbox go, rows put back return, read flags follow. */
  const applyOutcomes = useCallback((op: BatchOp, outcomes: readonly BatchOutcome[], snapshot: ReadonlyMap<string, InboxRow>) => {
    const ok = outcomes.filter((o) => o.result.status === "accepted" || o.result.status === "conflict");
    if (ok.length === 0) return;
    const byRow = new Map(ok.map((o) => [o.picked.rowId, o.result]));
    setRows((prev) => {
      let next: InboxRow[];
      if (op === "unarchive" || op === "untrash") {
        const back = [...byRow.entries()].filter(([, r]) => r.in_inbox).map(([id, r]) => snapshot.get(id) && { ...snapshot.get(id)!, read: r.read ?? snapshot.get(id)!.read, provider_labels: r.labels ?? snapshot.get(id)!.provider_labels }).filter((x): x is InboxRow => !!x);
        next = mergeRows(prev, back);
      } else {
        next = prev.flatMap((r) => {
          const res = byRow.get(r.id);
          if (!res) return [r];
          if (res.in_inbox === false) return [];
          return [{ ...r, read: res.read ?? r.read, provider_labels: res.labels ?? r.provider_labels }];
        });
      }
      persist(accounts, next);
      return next;
    });
    const left = ok.filter((o) => o.result.in_inbox === false && snapshot.has(o.picked.rowId)).length;
    const came = op === "unarchive" || op === "untrash" ? ok.filter((o) => o.result.in_inbox && snapshot.has(o.picked.rowId)).length : 0;
    if (left || came) setCachedTotal((n) => Math.max(0, n - (op === "unarchive" || op === "untrash" ? 0 : left) + came));
    if (op === "archive" || op === "trash") for (const o of ok) if (o.result.in_inbox === false) forgetMessage(userId, o.picked.rowId);
  }, [accounts, persist, userId]);

  /** The session is alive and no selected mailbox needs reconnecting, or the line that says which. */
  const bulkBlock = (list: readonly Picked[]): string | null => {
    if (!token) return SIGN_IN_FIRST;
    const stuck = list.some((p) => {
      const v = conn.views.get(p.email.toLowerCase());
      return v ? v.offerReconnect : accounts.find((a) => a.address === p.email)?.state === "reauth";
    });
    return stuck ? RECONNECT_FIRST : null;
  };

  const undoBulk = async (op: BatchOp, done: readonly BatchOutcome[], snapshot: ReadonlyMap<string, InboxRow>) => {
    const back = REVERSE[op];
    const list = done.map((o) => o.picked);
    const block = bulkBlock(list);
    if (block) { showToast({ message: block }); return; }
    const outcomes = await runBatch(token, back, list);
    applyOutcomes(back, outcomes, snapshot);
    const t = tally(outcomes);
    showToast({ message: t.attention.length ? `${doneLine(back, t.done.length)}, ${attentionLine(t.attention.length)}` : doneLine(back, t.done.length) });
  };

  const runBulk = async (op: BatchOp, list: readonly Picked[]) => {
    if (bulkBusy) return;
    if (list.length === 0) { setBulkBlocked(NOTHING_SELECTED); return; }
    const block = bulkBlock(list);
    if (block) { setBulkBlocked(block); return; }
    setBulkBlocked(null);
    setBulkBusy(true);
    const snapshot = new Map(rows.map((r) => [r.id, r]));
    const outcomes = await runBatch(token, op, list);
    setBulkBusy(false);
    applyOutcomes(op, outcomes, snapshot);
    const t = tally(outcomes);
    // Undo reverses only what this action changed, and only when Gmail confirmed it (spec 11).
    if (t.done.length) showToast({ message: doneLine(op, t.done.length), actionLabel: UNDO, onAction: () => void undoBulk(op, t.done, snapshot) });
    if (t.attention.length) {
      // Partial: the ones that need attention stay selected, with their reasons; only proven failures are offered again.
      setBulkNote({ op, done: t.done.length, attention: t.attention, retry: t.retryable });
      setPicked(t.attention.map((o) => o.picked));
    } else endSelect();
  };
  const onVerb = (v: TrayVerb) => void runBulk(OP_OF[v], picked);

  // ---- waiting (slice 08) ---------------------------------------------------
  const loadWaiting = useCallback(async () => {
    if (!waitingSvc) return;
    try {
      const listed = await waitingSvc.list();
      // A record saved from this screen a moment ago may not be in the list's cached copy yet (the list answers
      // from the device cache and refreshes behind it): it stays shown until the list has it.
      const extra = Object.values(tracked.current).filter((t) => !listed.some((i) => i.id === t.id));
      for (const i of listed) delete tracked.current[i.id];
      const items = [...extra, ...listed];
      setWaitingItems(items);
      const threads = [...new Set(items.filter((i) => i.data.status === "open" && i.data.threadId).map((i) => i.data.threadId!))];
      if (client && threads.length) { const r = await threadsLatest(client, threads); if (r.ok) setWaitingLatest(r.value); }
    } catch { /* the list stays as it was */ }
  }, [waitingSvc, client]);
  useEffect(() => { if (segment === "waiting") void loadWaiting(); }, [segment, loadWaiting]);
  // The background refresh behind the cached list found a change (a Track This that landed on the server): read it again.
  useFreshLists(["waiting"], () => { if (segment === "waiting") { store?.invalidateAll(); void loadWaiting(); } });
  // TRACK THIS LANDS IN WAITING (ruling 8, 2026-10-12). capture_approve writes the record on the server, not through
  // the Store, so the Waiting list (which answers from the device's cached copy first) did not have it: the person
  // tapped Track This and Email > Waiting still said Nothing You're Waiting On. The saved record is read back by its
  // id at once and kept on screen until the list carries it. Only an explicit save gets here; nothing is created.
  const onCardSaved = useCallback((c: Candidate, a: ActionResult) => {
    if (c.kind !== "waiting" || !a.destination_id || !waitingSvc) return;
    const id = a.destination_id;
    store?.invalidateAll();
    void waitingSvc.get(id).then((it) => {
      if (!it) return;
      tracked.current[it.id] = it;
      setWaitingItems((list) => [it, ...list.filter((w) => w.id !== it.id)]);
    }).catch(() => { /* the list's own refresh brings it */ });
  }, [waitingSvc, store]);
  // DELETE A RESOLVED WAITING RECORD (2026-10-12). Only a resolved one: an open record keeps Resolve, the follow-up date
  // and Draft Follow-Up. It leaves the list at once (the Open and Resolved counts with it), and Undo puts back the exact
  // snapshot under the same id; an Undo sets a state, so a second tap finds it there and does nothing.
  const deleteWaiting = useCallback(async (it: WaitingItem) => {
    if (!waitingSvc || it.data.status !== "resolved") return;
    const box: { gone: WaitingItem | null } = { gone: null };
    if (!(await attemptWrite(async () => { box.gone = await waitingSvc.remove(it.id); }))) return;
    const kept = box.gone ?? it;
    delete tracked.current[it.id];
    setWaitingItems((list) => list.filter((w) => w.id !== it.id));
    setSegment("waiting");
    setScreen({ kind: "root" });
    showToast({ message: waitingDeleted(kept.data.title), actionLabel: UNDO, onAction: () => void (async () => {
      const back = await attemptWrite(async () => { if (!(await waitingSvc.get(kept.id))) await waitingSvc.create(kept.data, kept.id); });
      if (!back) return;
      setWaitingItems((list) => (list.some((w) => w.id === kept.id) ? list : [kept, ...list]));
      void loadWaiting();
    })() });
  }, [waitingSvc, loadWaiting]);
  // A focus from Today or a receipt: the inbox narrowed to its cards, or one record.
  useEffect(() => {
    if (!focus || !focusNonce) return;
    if (focus.kind === "candidates") openReview();
    else if (focus.kind === "paused") openPaused();
    else { setSegment("waiting"); setScreen({ kind: "waiting", id: focus.id }); void loadWaiting(); }
    onFocusConsumed?.();
    // The nonce is the signal; the focus value rides with it.
  }, [focusNonce]);
  const todayLocal = localDate(now.toISOString(), zone);

  // ---- the review list (every counted card) and the paused sends ----------
  function openReview() {
    setSegment("inbox"); setChip(null); setScreen({ kind: "reviewList" });
    void loadReview();
  }
  async function loadReview() {
    if (!client) return;
    setReviewLoading(true);
    const r = await reviewList(client);
    setReviewLoading(false);
    if (r.ok) {
      const list = r.value.rows ?? [];
      setReviewRows(list);
      setReviewTotal(Number(r.value.count) || 0);
      setCards((prev) => {
        const next = { ...prev };
        for (const row of list) next[row.id] = [];
        for (const c of r.value.candidates ?? []) (next[c.message_id] ??= []).push(c);
        return next;
      });
      return;
    }
    // A database without migration 0068: the loaded pages are what can be shown, and only what is shown is claimed.
    setReviewRows(rows.filter((x) => (cards[x.id] ?? []).some(isToReview)));
  }
  function openPaused() {
    setScreen({ kind: "paused" });
  }
  async function loadPaused() {
    if (!client) return;
    setPausedFailure(null);
    const r = await pausedSends(client);
    if (r.ok) setPaused(r.value);
    else { setPaused(null); setPausedFailure(r); }
  }
  // Read on every arrival, so a draft reviewed and approved (or kept) is gone when the person comes back.
  useEffect(() => { if (screen.kind === "paused") void loadPaused(); }, [screen.kind]);
  // The review count, on the Email surface: read with each load of the inbox and after a card changes.
  const cardsKey = Object.values(cards).reduce((n, l) => n + l.filter(isToReview).length, 0);
  useEffect(() => {
    if (!client || offline) return;
    let alive = true;
    void reviewCount(client).then((r) => { if (alive && r.ok) setReviewTotal(Number(r.value.count) || 0); }).catch(() => {});
    return () => { alive = false; };
  }, [client, offline, cardsKey]);
  // The sends whose outcome is unknown: read on arrival at the mail home, so a send checked elsewhere drops off when it is back.
  useEffect(() => {
    if (!client || offline || screen.kind !== "root") return;
    let alive = true;
    void listDrafts(client).then((r) => { if (alive && r.ok) setSentRows(r.value.sent ?? []); }).catch(() => {});
    return () => { alive = false; };
  }, [client, offline, screen.kind]);
  const bannerUp = banners.length > 0;
  useEffect(() => {
    if (!client || offline || !bannerUp) return;
    let alive = true;
    void pausedSends(client).then((r) => { if (alive) setPausedCount(r.ok ? Number(r.value.count) || 0 : null); }).catch(() => {});
    return () => { alive = false; };
  }, [client, offline, bannerUp]);
  // Something is paused: the paused list says so, or (before it answers, or where it cannot) the status's own counts do.
  const somethingPaused = pausedCount !== null ? pausedCount > 0 : banners.some((m) => m.pausedCount > 0);
  const openMessageById = async (id: string) => {
    if (!client) return;
    const r = await readMessage(client, id);
    if (r.ok) { setScreen({ kind: "message", row: rowOf(r.value), from: "inbox" }); void loadCards([r.value.id]); }
    else showToast({ message: lineFor(r) });
  };

  // ---- compose, review, send (slice 07) ------------------------------------
  const canCompose = accounts.some((a) => a.state === "connected");
  const defaultAccountId = () => (accounts.find((a) => a.state === "connected") ?? accounts[0])?.id ?? "";
  // Every call here starts a FRESH compose or reply, never resumes one (openDraft and openLocal bypass this
  // entirely): the one place the account's saved signature is inserted, once, as its own block (spec L3, AC17).
  // Empty signature means nothing is appended, not an empty block, and nothing here is recorded as a managed
  // insertion either, so a later account switch has nothing stale to compare against.
  const startCompose = (fields: DraftFields, accountId: string, from: Screen, extra: Partial<ComposeStart> = {}) => {
    setSendFailure(null);
    const acct = accounts.find((a) => a.id === accountId);
    const signed: DraftFields = acct && acct.signature_text
      ? { ...fields, body_text: withSignature(fields.body_text, acct.signature_text), signature_revision: acct.signature_revision }
      : fields;
    setScreen({ kind: "compose", start: { localKey: newLocalKey(nowFn), draftId: null, accountId, fields: signed, revision: null, ...extra }, from });
  };
  const startReply = (m: MessageDetail, all: boolean, from: Screen) => {
    const acct = accounts.find((a) => a.id === m.account_id);
    if (!acct) return;
    startCompose(replyFields(m, accounts.map((a) => a.address), all), acct.id, from, { replyingTo: senderOf(m) });
  };
  const openDraft = (d: DraftRow) => {
    setSendFailure(null);
    setScreen({ kind: "compose", start: { localKey: d.id, draftId: d.id, accountId: d.account_id, fields: fieldsOf(d), revision: d.revision, failedLine: d.send_state === "failed" ? d.action_verb ?? null : null }, from: { kind: "drafts" } });
  };
  // A paused send (V10): released on the server as it opens (migration 0069), so its words land in an editable composer
  // and Review Send makes a fresh review and a new hold. One that is still the send's opens its outcome instead.
  const openPausedDraft = async (d: DraftRow) => {
    if (!client) return;
    setSendFailure(null);
    const target = pausedOpenTarget(d, await reopenDraft(client, d.id));
    if (target.kind === "gone") { void loadPaused(); return; }
    if (target.kind === "outcome") { setCheckLine(null); setScreen({ kind: "outcome", draft: target.draft }); return; }
    const x = target.draft;
    setScreen({ kind: "compose", start: { localKey: x.id, draftId: x.id, accountId: x.account_id, fields: fieldsOf(x), revision: x.revision, failedLine: x.action_verb ?? null }, from: { kind: "paused" } });
  };
  const openLocal = (l: LocalDraft) => {
    setSendFailure(null);
    // A copy listed under On This Device is one the server may not hold (never sent there, or edited here since): unsynced, so the composer
    // pushes its words at the revision this phone last saw instead of taking them for the server's (issue 103).
    setScreen({ kind: "compose", start: { localKey: l.key, draftId: l.draft_id, accountId: l.account_id || defaultAccountId(), fields: l.fields, revision: l.revision, unsynced: true }, from: { kind: "drafts" } });
  };
  // A follow-up: the composer, to a real address from the thread, under the thread's newest message.
  const startFollowUp = (it: WaitingItem, start: FollowUpStart) => {
    const acct = accounts.find((a) => a.address === it.data.account) ?? accounts.find((a) => a.state === "connected") ?? accounts[0];
    if (!acct) return;
    const m = start.message;
    const refs = [...(m?.references ?? [])];
    if (m?.message_id_header && !refs.includes(m.message_id_header)) refs.push(m.message_id_header);
    const fields: DraftFields = { ...emptyFields(), to_addresses: start.to ? [start.to] : [], subject: replySubject(m?.subject || it.data.title), thread_id: it.data.threadId ?? null,
      reply_headers: { in_reply_to: m?.message_id_header || null, references: refs, thread_id: it.data.threadId ?? null } };
    startCompose(fields, acct.id, { kind: "waiting", id: it.id }, { replyingTo: it.data.counterpartyDisplay || undefined });
  };
  const discarded = (copy: { accountId: string; fields: DraftFields } | null, from: Screen) => {
    setScreen(from.kind === "compose" || from.kind === "review" ? { kind: "root" } : from);
    setDraftsReload((n) => n + 1);
    const undo = copy && client ? async () => {
      const r = await saveDraft(client, null, copy.accountId, copy.fields, null);
      if (!r.ok) { showToast({ message: lineFor(r) }); return; }
      showToast({ message: DRAFT_KEPT });
      setDraftsReload((n) => n + 1);
    } : null;
    showToast({ message: DRAFT_DISCARDED, ...(undo ? { actionLabel: UNDO, onAction: () => void undo() } : {}) });
  };
  // The tap. One request id per review: a second tap, or a retry, replays the same action.
  const send = async (s: Extract<Screen, { kind: "review" }>) => {
    if (sending || !client) return;
    setSending(true);
    setSendFailure(null);
    // Every send is held on the server for 30 seconds with Undo (Dave's locked decision 4). No flag: the hold is the send.
    const r = await sendApproved(token, { draft_id: s.draftId, review_nonce: s.review.review.review_nonce, shown_payload_hash: s.review.review.payload_hash, request_id: s.requestId, hold: true });
    setSending(false);
    if (!r.ok) { setSendFailure(r); return; }
    if (isHeld(r.value)) {
      // Approved and held on the server. Nothing has gone to Gmail; the screen counts down the server's clock and offers Undo.
      const e = s.review.exact;
      setDraftsReload((n) => n + 1);
      setCheckLine(null);
      setScreen({ kind: "held", actionId: r.value.action_id, held: { hold_until: r.value.hold_until, dispatch_deadline: r.value.dispatch_deadline, server_now: r.value.server_now }, receivedAt: Date.now(), draftId: s.draftId, subject: e.subject, from: e.from_identity, recipients: [...e.to, ...e.cc, ...e.bcc], start: s.start, origin: s.from });
      return;
    }
    let draft = r.value.draft;
    if (!draft) { const g = await getDraft(client, s.draftId); draft = g.ok ? g.value : null; }
    if (!draft) { setSendFailure(failure("UNAVAILABLE")); return; }
    setDraftsReload((n) => n + 1);
    if (outcomeOf(draft) === "sent") showToast({ message: draft.action_verb ?? s.review.verb });
    setCheckLine(null);
    setScreen({ kind: "outcome", draft });
  };
  // Check Again: only the message found in Gmail settles an unknown send.
  const checkAgain = async (d: DraftRow) => {
    if (checking || !d.sent_action_id || !client) return;
    setChecking(true);
    setCheckLine(null);
    const r = await reconcileSend(token, d.sent_action_id);
    setChecking(false);
    if (!r.ok) { setCheckLine(r); return; }
    if (r.value.found && r.value.draft) {
      setCheckLine(NOW_CONFIRMED);
      setDraftsReload((n) => n + 1);
      showToast({ message: r.value.draft.action_verb ?? NOW_CONFIRMED });
      setScreen({ kind: "outcome", draft: r.value.draft });
      return;
    }
    if (r.value.found === false) { setCheckLine(STILL_UNKNOWN); return; }
    const g = await getDraft(client, d.id);
    if (g.ok) setScreen({ kind: "outcome", draft: g.value });
  };
  const issueLines = Object.entries(syncIssues).map(([address, line]) => `Didn't Refresh · ${address} · ${line}`);

  const sheetEl = sheet && client ? (
    <CaptureSheet client={client} candidate={sheet.candidate} row={sheet.row} ctx={contextFor(sheet.row, zone, nowFn)} ready={ready} readyLine={readyLine} offline={offline}
      evidenceText={sheet.text ?? bodyText.current[sheet.row.id]} onClose={() => setSheet(null)} onChanged={() => loadCards([sheet.row.id])} onSaved={onCardSaved} />
  ) : null;
  const captureEl = capturing ? (
    <RowActionSheet title={CAPTURE_TITLE} actions={(["bill", "receipt", "task", "event", "waiting"] as CaptureKind[]).map((k) => ({ label: CAPTURE_KIND[k]!, onPick: () => void startCapture(capturing.row, k, capturing.text) }))} onCancel={() => setCapturing(null)} />
  ) : null;

  if (screen.kind === "receipt" && client) {
    const from = screen.from;
    return <div className={pushCls}>
      <ReceiptDetail client={client} actionId={screen.actionId} offline={offline} back={from.kind === "message" ? MESSAGE_TITLE : from.kind === "outcome" ? outcomeTitle(from.draft) : EMAIL_TITLE}
        onBack={() => setScreen(from)} onChanged={() => { const ids = Object.keys(cards); if (ids.length) void loadCards(ids); }} onOpenItem={onOpenEntity} />
    </div>;
  }
  // The message, as a sheet layered over whichever screen it was opened from
  // (Astra's bottom-sheet design, approved 2026-10-10, "Build it, test it,
  // and keep everything moving"): the inbox or the search results stay
  // mounted and dimmed underneath; only the message's own card floats, and
  // onCapture hands Add to JARVIS / Track This to the same manual-capture
  // door (startCapture) the More menu's own Capture entry already opens.
  const messageScreen = screen.kind === "message" ? screen : null;
  const messageCurrent = messageScreen ? (rows.find((r) => r.id === messageScreen.row.id) ?? messageScreen.row) : null;
  const messageMore: RowAction[] = messageScreen && messageCurrent ? [
    { label: FIND_DETAILS, onPick: () => void (async () => { const n = await readBody(messageCurrent, bodyText.current[messageCurrent.id] ?? messageCurrent.snippet, true); showToast({ message: foundLine(n) }); })(), disabled: offline },
    { label: CAPTURE_TITLE, onPick: () => setCapturing({ row: messageCurrent, text: bodyText.current[messageCurrent.id] }), disabled: offline },
    { label: showDismissed ? HIDE_DISMISSED : SHOW_DISMISSED, onPick: () => setShowDismissed((v) => !v) },
    // Spec 3.2 rule 1: the person's own section for this message, on this device. It moves nothing in Gmail.
    { label: MOVE_TO_SECTION, onPick: () => setMovingRow(messageCurrent) },
  ] : [];
  const moveSheet = movingRow ? (
    <RowActionSheet title={MOVE_TO_SECTION}
      actions={[
        ...SECTION_KEYS.filter((k) => k !== sectionOf(movingRow, overrides)).map((k) => ({ label: SECTION_NAME[k], onPick: () => { setOverrides(recordMove(userId, movingRow, k)); setMovingRow(null); } })),
        ...(overrides[movingRow.id] ? [{ label: PUT_BACK_SECTION, onPick: () => { setOverrides(recordMove(userId, movingRow, null)); setMovingRow(null); } }] : []),
      ]}
      onCancel={() => setMovingRow(null)} />
  ) : null;
  const messageOverlay = messageScreen && messageCurrent && client ? (
    <>
      <MessageScreen client={client} token={token} userId={userId} row={messageCurrent} account={accountOf(messageScreen.row)} offline={offline}
        categories={categories} categoryId={catOf(messageScreen.row)}
        onBack={() => setScreen(messageScreen.from === "search" ? { kind: "search" } : messageScreen.from === "review" ? { kind: "reviewList" } : { kind: "root" })}
        onRowChanged={patchRow}
        onLeftInbox={leftInbox}
        onFileUnder={(r, c) => void onFileUnder(r, c)}
        finish={cardsFor(messageCurrent, "finish")} cards={cardsFor(messageCurrent, "rest")} moreActions={messageMore} onBodyText={(text) => void readBody(messageCurrent, text)}
        onCalendarFile={(text) => void readCalendarFile(messageCurrent, text)}
        onReply={(m, all) => startReply(m, all, messageScreen)}
        onCapture={(kind) => void startCapture(messageCurrent, kind, bodyText.current[messageCurrent.id])}
        alsoIn={same[messageCurrent.id] ?? []} />
      {sheetEl}{captureEl}{moveSheet}
    </>
  ) : null;
  if ((screen.kind === "search" || (messageScreen?.from === "search")) && client) {
    return <div className={pushCls}>
      <SearchScreen client={client} token={token} accounts={accounts} labels={labels} offline={offline} state={search} onState={setSearch}
        categories={categories} categoryOf={catOf} categoryId={searchChip} onCategory={setSearchChip} now={now}
        onBack={() => setScreen({ kind: "root" })} onOpen={(row) => { setScreen({ kind: "message", row, from: "search" }); void loadCards([row.id]); }} />
      {messageOverlay}
    </div>;
  }
  if ((screen.kind === "reviewList" || messageScreen?.from === "review") && client) {
    return <div className={pushCls}>
      <ReviewListScreen rows={reviewRows} loading={reviewLoading} labels={labels} now={now} onBack={() => setScreen({ kind: "root" })}
        onOpen={(row) => setScreen({ kind: "message", row, from: "review" })}
        renderBelow={(r) => (messageCurrent && messageCurrent.id === r.id ? null : cardsFor(r))} />
      {messageOverlay}{!messageScreen && sheetEl}
    </div>;
  }
  if (screen.kind === "paused" && client) {
    return <div className={pushCls}>
      <PausedScreen paused={paused} failure={pausedFailure} onBack={() => setScreen({ kind: "root" })} onRetry={() => void loadPaused()}
        onOpen={(d) => void openPausedDraft(d)} />
    </div>;
  }
  if (screen.kind === "accounts") {
    const onSignatureSaved = (accountId: string, text: string, revision: number) => setAccounts((prev) => {
      const next = prev.map((a) => (a.id === accountId ? { ...a, signature_text: text, signature_revision: revision } : a));
      persist(next, rows);
      return next;
    });
    return <div className={pushCls}>
      <AccountsScreen accounts={accounts} views={conn.views} statuses={conn.answer?.accounts} client={client} userId={userId} onBack={() => setScreen({ kind: "root" })} onOpenConnections={onOpenConnections}
        onReconnect={(email) => void reconnect.start(email)} onRetrySync={() => void load("refresh")} onOpenDrafts={client ? () => setScreen({ kind: "drafts" }) : undefined} onSignatureSaved={onSignatureSaved} />
    </div>;
  }
  if (screen.kind === "waiting" && client) {
    const it = waitingItems.find((w) => w.id === screen.id);
    if (!it) {
      return <div className={pushCls}><div className="screen ruled"><PageHeader title={WAITING_TITLE} back={EMAIL_TITLE} onBack={() => setScreen({ kind: "root" })} /><SkeletonRows rows={2} /><div className="screen-foot" /></div></div>;
    }
    return <div className={pushCls}>
      <WaitingDetail client={client} item={it} own={accounts.map((a) => a.address)} today={todayLocal} zone={zone} offline={offline} latest={it.data.threadId ? waitingLatest[it.data.threadId] : undefined}
        onBack={() => { setSegment("waiting"); setScreen({ kind: "root" }); }}
        onChanged={(data) => setWaitingItems((list) => list.map((w) => (w.id === it.id ? { id: w.id, data } : w)))}
        onOpenMessage={(id) => void openMessageById(id)}
        onDraftFollowUp={(start) => startFollowUp(it, start)}
        {...(waitingSvc && it.data.status === "resolved" ? { onDelete: () => void deleteWaiting(it) } : {})} />
    </div>;
  }
  if (screen.kind === "compose" && client) {
    const from = screen.from;
    const start = screen.start;
    return <div className={pushCls}>
      <ComposeScreen client={client} userId={userId} accounts={accounts} offline={offline} fileStore={fileStore} start={start} now={nowFn} briefAI={briefAI}
        onBack={(saved) => {
          setDraftsReload((n) => n + 1);
          setScreen(from.kind === "review" || from.kind === "compose" ? { kind: "root" } : from);
          // Close on a composer with words in it is never silent (issue 103): Draft Saved only after the server answered.
          if (saved) showToast({ message: saved === "server" ? DRAFT_SAVED : DRAFT_SAVED_HERE });
        }}
        onReview={(draftId, revision, fields, review) => setScreen({ kind: "review", draftId, revision, fields, review, requestId: newRequestId(), start: { ...start, localKey: draftId, draftId, fields, revision, unsynced: false }, from })}
        onDiscarded={(copy) => discarded(copy, from)} />
    </div>;
  }
  if (screen.kind === "review" && client) {
    const s = screen;
    const backToCompose = () => { void cancelCommand(client, s.review.review.action_id); setSendFailure(null); setScreen({ kind: "compose", start: s.start, from: s.from }); };
    return <div className={pushCls}>
      <SendReviewScreen review={s.review} offline={offline} now={nowFn} sending={sending} failure={sendFailure} hold onEdit={backToCompose} onSend={() => void send(s)} onReviewAgain={backToCompose} />
    </div>;
  }
  if (screen.kind === "held" && client) {
    const h = screen;
    // The server decided how it ended; this just shows the screen that fits. A settled send reads the draft as it stands.
    const ended = async (phase: "settled" | "returned", status: HoldStatus) => {
      const g = await getDraft(client, h.draftId);
      setDraftsReload((n) => n + 1);
      if (!g.ok) { setScreen({ kind: "root" }); return; }
      if (phase === "returned") {
        showToast({ message: status.error_code === "HOLD_EXPIRED" ? lineFor({ code: "HOLD_EXPIRED" }) : UNDONE_LINE });
        setScreen({ kind: "compose", start: { ...h.start, draftId: g.value.id, revision: g.value.revision, fields: fieldsOf(g.value) }, from: h.origin });
        return;
      }
      if (outcomeOf(g.value) === "sent") showToast({ message: g.value.action_verb ?? SENT_TITLE });
      setCheckLine(null);
      setScreen({ kind: "outcome", draft: g.value });
    };
    return <div className={pushCls}>
      <HeldSendView client={client} actionId={h.actionId} held={h.held} receivedAt={h.receivedAt} offline={offline} subject={h.subject} from={h.from} recipients={h.recipients}
        onEnd={(phase, status) => void ended(phase, status)} onBack={() => setScreen({ kind: "root" })} />
    </div>;
  }
  if (screen.kind === "outcome" && client) {
    const d = screen.draft;
    return <div className={pushCls}>
      <SendOutcomeScreen draft={d} offline={offline} checking={checking} checkLine={checkLine}
        onBack={() => { setCheckLine(null); setScreen({ kind: "root" }); }}
        onReviewAgain={() => openDraft(d)}
        onCheckAgain={() => void checkAgain(d)}
        onReceipt={(actionId) => setScreen({ kind: "receipt", actionId, from: screen })} />
    </div>;
  }
  if (screen.kind === "drafts" && client) {
    return <div className={pushCls}>
      <DraftsScreen client={client} userId={userId} offline={offline} reloadKey={draftsReload} onBack={() => setScreen({ kind: "accounts" })}
        onCompose={() => startCompose(emptyFields(), defaultAccountId(), { kind: "drafts" })} onOpenDraft={openDraft} onOpenLocal={openLocal}
        onOpenSent={(d) => { setCheckLine(null); setScreen({ kind: "outcome", draft: d }); }} />
    </div>;
  }

  const fresh = homeFreshness(accounts, now);
  const dateWord = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", timeZone: zone });
  const homeTitle = segment === "waiting" ? WAITING_SEGMENT_TITLE : INBOX_TITLE;
  const inbox = client && segment === "inbox";
  return (
    <div className={"screen ruled " + pushCls} {...handlers} data-extractor={EXTRACTOR_VERSION}>
      <PageHeader title={homeTitle}
        hero={<div className="email-hero"><div className="eyebrow">{dateWord}</div><div className="pagehead-title">{homeTitle}</div></div>}
        actions={<>
          {/* Compose and Search live on the page beside the list (spec 3.1, the approved visual); Waiting keeps Compose in the bar. */}
          {segment === "waiting" && canCompose && client && <BarAction label={COMPOSE_LABEL} onClick={() => startCompose(emptyFields(), defaultAccountId(), { kind: "root" })}><PenLine className="ic" /></BarAction>}
          {/* Refresh needs a mailbox to ask: with no client (the not-set-up state) it did nothing when tapped, the tap sweep's
              finding (2026-10-04, Dave: no dead buttons), so it is not offered. */}
          {client && <BarAction label={REFRESH_LABEL} onClick={() => void load("refresh")}><RotateCcw className="ic" /></BarAction>}
        </>}>
        {/* Spec 3.1: the account picker (explicit, visible, clearable) and the one status, "Checked 9:12 AM", tappable to Accounts. */}
        {(live.length > 0 || fresh.length > 0) && (
          <div className="email-acct-line">
            {live.length > 0 && (
              <button className="email-acct" onClick={() => setPickingAccount(true)} aria-label={`${ACCOUNT_PICK_TITLE} ${accountFilter ?? ALL_ACCOUNTS_PICK}`}>
                <span className="email-acct-word">{accountFilter ?? (live.length > 1 ? ALL_ACCOUNTS_PICK : live[0]!.address)}</span>
                <ChevronRight className="email-caret" aria-hidden="true" />
              </button>
            )}
            {fresh.length > 0 && <button className="email-fresh" onClick={() => setScreen({ kind: "accounts" })}>{refreshing ? <EmailFacts facts={[{ text: REFRESHING }]} /> : <EmailFacts facts={fresh} />}</button>}
          </div>
        )}
        <div className="pad-x">
          <div className="segmented" role="tablist" aria-label={EMAIL_TITLE}>
            {SEGMENTS.map((sg) => (
              <button key={sg.key} role="tab" aria-selected={segment === sg.key} className={"seg" + (segment === sg.key ? " active" : "")} onClick={() => { setSegment(sg.key); if (sg.key !== "inbox") endSelect(); }}>{sg.label}</button>
            ))}
          </div>
        </div>
        {inbox && (
          <div className="pad-x">
            <button className="email-search" aria-label={SEARCH_LABEL} onClick={() => setScreen({ kind: "search" })}>
              <Search className="ic" aria-hidden="true" /><span>{SEARCH_PLACEHOLDER}</span>
            </button>
          </div>
        )}
        {inbox && !selecting && (
          <div className="email-controls">
            <div className="segmented email-view" role="tablist" aria-label={VIEW_LABEL}>
              {([["date", VIEW_DATE], ["grouped", VIEW_GROUPED]] as const).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={view === k} className={"seg" + (view === k ? " active" : "")} onClick={() => chooseView(k)}>{label}</button>
              ))}
            </div>
            {visible.length > 0 && <button className="btn btn-secondary email-select" onClick={startSelect}>{SELECT}</button>}
            {canCompose && <button className="btn-primary email-fab" aria-label={COMPOSE_LABEL} onClick={() => startCompose(emptyFields(), defaultAccountId(), { kind: "root" })}><PenLine className="ic" /></button>}
          </div>
        )}
        {inbox && selecting && (
          <div className="email-controls email-selhead">
            <button className="quiet-action email-cancel" onClick={endSelect}>{CANCEL}</button>
            <span className="email-selcount">{selectedWord(picked.length)}</span>
            <button className="quiet-action email-selall" onClick={() => setPicked(visible.map(pickOf))}>{selectAllLoaded(visible.length)}</button>
          </div>
        )}
        {inbox && view === "date" && !selecting && chips.length > 0 && (
          <div className="chip-row" role="group" aria-label={AREAS_LABEL}>
            <button className={"chip" + (chip === null ? " active" : "")} onClick={() => setChip(null)}>{ALL_CHIP} <span className="email-chip-n">{accountRows.length}</span></button>
            {chips.map((c) => (
              <button key={c.id} className={"chip" + (chip === c.id ? " active" : "")} onClick={() => setChip(c.id)}>{c.data.name} <span className="email-chip-n">{counts[c.id]}</span></button>
            ))}
          </div>
        )}
      </PageHeader>

      <div className={"email-pull" + (armed || refreshing ? " on" : "")} aria-hidden="true">{refreshing ? REFRESHING : PULL_HINT}</div>
      {offline && <div className="email-note quiet"><span>{OFFLINE_LINE}</span></div>}
      <ConnectionBanner models={banners} notes={recovery} onReconnect={(email) => void reconnect.start(email)} busyEmail={reconnect.busy} outcome={reconnect.outcome} checking={reconnect.checking} onOutcomeAction={reconnect.act} {...(client && somethingPaused ? { onViewPaused: openPaused } : {})} onAcknowledge={incidents.acknowledge} onSeen={incidents.seen} />
      {/* Reconnect is one tap, the same path as the banner's (useReconnect), never a detour through Connections. */}
      {headlineShown && headline.tier === "auth" && headline.action?.kind === "reconnect" ? (
        <div className="email-note" data-headline="auth"><span>{REAUTH_LINE}</span><button className="quiet-action" onClick={() => runHeadline(headline.action!)} disabled={reconnect.busy !== null}>{RECONNECT}</button></div>
      ) : headlineShown && (
        <div className={"email-note" + (headline.action ? "" : " quiet")} data-headline={headline.tier}>
          <EmailFacts facts={headline.facts} />
          {headline.action && <button className="quiet-action" onClick={() => runHeadline(headline.action!)}>{headlineLabel(headline.action)}</button>}
        </div>
      )}
      {issueLines.map((l) => <div className="email-note quiet" key={l}><span>{l}</span></div>)}
      {error && rows.length > 0 && <div className="email-note quiet"><span>{REFRESH_FAILED}</span><button className="quiet-action" onClick={() => void load("refresh")}>{RETRY}</button></div>}

      {!client && (
        <EmptyState copy={NO_CLIENT} onAction={onOpenConnections} />
      )}
      {/* Catching up with nothing cached yet is still loading: never "Nothing in Your Inbox" for a window not yet listed (8.3). */}
      {client && (pending || (catchingUp && segment === "inbox")) && rows.length === 0 && !error && <SkeletonRows rows={4} />}
      {client && error && rows.length === 0 && !pending && (
        <div className="pad-x"><div className="card list-card-ruled">
          <div className="row"><div className="row-grow"><div className="conn-name">{lineFor(error)}</div></div></div>
          <button className="row row-act" onClick={() => void load("first")}>{RETRY}</button>
        </div></div>
      )}

      {client && segment === "waiting" && (waitingSvc ? (
        <WaitingList items={waitingItems} latest={waitingLatest} own={accounts.map((a) => a.address)} today={todayLocal} zone={zone} view={waitingView} onView={setWaitingView}
          onOpen={(it) => setScreen({ kind: "waiting", id: it.id })} onShowInbox={() => setSegment("inbox")} />
      ) : (
        <EmptyState copy={EMPTY_WAITING} onAction={() => setSegment("inbox")} />
      ))}
      {/* The review count stays on the Email surface (spec section 7): one quiet line, the door to every card it counts. */}
      {client && segment === "inbox" && reviewTotal !== null && reviewTotal > 0 && (
        <div className="email-note quiet" data-review-count={reviewTotal}><span>{reviewItemsLine(reviewTotal)}</span><button className="quiet-action" onClick={openReview}>{REVIEW_OPEN}</button></div>
      )}

      {client && segment === "inbox" && !pending && !error && accounts.length === 0 && (
        <EmptyState copy={EMPTY_ACCOUNTS} onAction={onOpenConnections} />
      )}
      {client && segment === "inbox" && !pending && !error && accounts.length > 0 && rows.length === 0 && !catchingUp && (
        <EmptyState copy={EMPTY_INBOX} onAction={() => void load("refresh")} />
      )}
      {client && segment === "inbox" && rows.length > 0 && chipOn && visible.length === 0 && (
        <EmptyState copy={EMPTY_FILTER} onAction={() => setChip(null)} />
      )}
      {inbox && bulkBlocked && <div className="email-note"><span>{bulkBlocked}</span></div>}
      {inbox && bulkNote && (
        <div className="email-note email-bulk-note">
          <div className="email-bulk-lines">
            <EmailFacts facts={[...(bulkNote.done ? [{ text: doneLine(bulkNote.op, bulkNote.done), tone: "good" as const }] : []), { text: attentionLine(bulkNote.attention.length), tone: "warn" as const }]} />
            {reasonsOf(bulkNote.attention).map(([why, n]) => <EmailFacts key={why} facts={[{ text: String(n), strong: true }, { text: why }]} />)}
          </div>
          {bulkNote.retry.length > 0 && <button className="quiet-action" disabled={bulkBusy} onClick={() => void runBulk(bulkNote.op, bulkNote.retry)}>{RETRY_FAILED}</button>}
        </div>
      )}
      {client && segment === "inbox" && visible.length > 0 && (
        <InboxList groups={groups} labels={labels} now={now} atEnd={atEnd} moreBusy={moreBusy} onLoadMore={() => void loadMore()}
          selecting={selecting} isPicked={isPicked} onPick={onPick} onPickGroup={onPickGroup} sameContent={same} threads={threads}
          onOpen={openInboxRow}
          // The open message owns its own cards inside the sheet; the dimmed
          // row behind it does not draw them a second time.
          renderBelow={(r) => (messageCurrent && messageCurrent.id === r.id ? null : cardsFor(r))} />
      )}
      <div className="screen-foot" />

      {question && (
        <RowActionSheet title={`${SUGGEST_TITLE} · ${categories.find((c) => c.id === question.rule.category_id)?.data.name ?? ""} · ${question.rule.sender_exact}`}
          actions={[{ label: REMEMBER, onPick: () => void answer(question, true) }, { label: NOT_NOW, onPick: () => void answer(question, false) }]}
          onCancel={() => void answer(question, false)} />
      )}
      {inbox && selecting && <MailSelectTray count={picked.length} busy={bulkBusy} onVerb={onVerb} />}
      {pickingAccount && (
        <RowActionSheet title={ACCOUNT_PICK_TITLE}
          actions={[{ label: ALL_ACCOUNTS_PICK, onPick: () => { setAccountFilter(null); setPickingAccount(false); } },
            ...live.map((a) => ({ label: a.address, onPick: () => { setAccountFilter(a.address); setPickingAccount(false); } }))]}
          onCancel={() => setPickingAccount(false)} />
      )}
      {!messageScreen && sheetEl}{!messageScreen && captureEl}
      {messageOverlay}
    </div>
  );
}
