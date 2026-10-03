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
//     did; one failing mailbox never blanks the other;
//   - search that says what it searched (saved mail, then Gmail, by account);
//   - chips that filter what is loaded, counted, with All as the whole list;
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
// Nothing runs on a timer: open, pull, tap. No card is ever an item until
// the person's tap makes it one.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import SkeletonRows from "../shared/SkeletonRows";
import RowActionSheet, { type RowAction } from "../shared/RowActionSheet";
import { PenLine, RotateCcw, Search } from "../shared/icons";
import { usePushDepth } from "../shared/pushNav";
import { showToast } from "../shared/toast";
import { supabase } from "../auth/supabaseClient";
import { useOptionalSession } from "../auth/AuthProvider";
import { useOptionalCategories, useOptionalLedger, useFileStore, useStore, useUserId } from "../data/NotesProvider";
import { failure, lineFor, newRequestId, type CommandFailure } from "../substrate/commands/errors";
import { cancelCommand } from "../substrate/commands/sends";
import { fetchReadiness, notReadyLine, readinessFrom, type Readiness } from "../substrate/destinations/registry";
import type { CaptureKind, CapturePayload } from "../substrate/contracts";
import type { Category } from "../categories/types";
import type { Bill, Receipt } from "../money/ledger/types";
import { moneyWords } from "../money/ledger/emailBill";
import { monthDay } from "../money/bills";
import ReceiptDetail from "../hub/ReceiptDetail";
import {
  ALL_CHIP, ARCHIVED, AREAS_LABEL, CAPTURE_KIND, CAPTURE_TITLE, EMAIL_TITLE, EMPTY_ACCOUNTS, EMPTY_FILTER, EMPTY_INBOX, EMPTY_WAITING, FIND_DETAILS, HIDE_DISMISSED, MESSAGE_TITLE, NOT_NOW,
  NO_CLIENT, OFFLINE_LINE, PULL_HINT, REAUTH_LINE, RECONNECT, REFRESHING, REFRESH_FAILED, REFRESH_LABEL, REMEMBER, RETRY, SEARCH_LABEL, SEGMENTS, SHOW_DISMISSED, SUGGEST_TITLE,
  TRASHED, UNDO, foundLine, type Segment,
  COMPOSE_LABEL, DRAFT_DISCARDED, DRAFT_KEPT, NOT_SENT_TITLE, NOW_CONFIRMED, SENT_TITLE, STILL_UNKNOWN, UNKNOWN_TITLE, SENDING_LINE,
  REVIEW_FILTER, moreInOlderMail, SHOW_ALL_ROWS, WAITING_TITLE,
} from "./copy";
import {
  answerSuggestion, inboxPage, listAccounts, mergeRows, mirrorAccounts, newestFirst, offerSuggestion, readMessage, syncAccount, PAGE,
  type EmailAccount, type InboxRow, type MessageDetail, type RpcClient,
} from "./emailClient";
import { forgetMessage, loadSnapshot, saveSnapshot } from "./deviceCache";
import { categoryOf, countsByCategory, fileUnder, loadRules, loadTags, notNow, remember, rowsUnderRule, ruleKeptLine, type RulesStore, type SuggestionDue, type Tags } from "./categories";
import { accountLabels, dayGroups, freshnessLine, senderOf } from "./format";
import { usePull } from "./usePull";
import InboxList from "./InboxList";
import MessageScreen, { type LeftInbox } from "./MessageScreen";
import SearchScreen, { EMPTY_SEARCH_STATE, type SearchState } from "./SearchScreen";
import AccountsScreen from "./AccountsScreen";
import ComposeScreen, { type ComposeStart } from "./ComposeScreen";
import SendReviewScreen from "./SendReviewScreen";
import SendOutcomeScreen from "./SendOutcomeScreen";
import DraftsScreen from "./DraftsScreen";
import { emptyFields, fieldsOf, getDraft, newLocalKey, outcomeOf, reconcileSend, replyFields, saveDraft, sendApproved, type DraftFields, type DraftRow, type LocalDraft, type Review } from "./drafts";
import WaitingList, { type WaitingView } from "./WaitingList";
import WaitingDetail, { type FollowUpStart } from "./WaitingDetail";
import { localDate, reviewCount, threadsLatest, type EmailFocus, type LatestInThread } from "./waiting";
import { WaitingService } from "../substrate/waiting/WaitingService";
import type { WaitingItem } from "../substrate/waiting/types";
import { replySubject } from "../connections/google/map";
import EmptyState from "./EmptyState";
import CandidateCards, { type Conflict } from "./CandidateCards";
import CaptureSheet from "./CaptureSheet";
import {
  candidatesFor, contextFor, isProvisional, isToReview, proposeCandidate, proposeExtracted, readWithRules, readerZone, readingKey, readingsOf, rememberReading, textOf,
  type Candidate,
} from "./candidates";
import { EXTRACTOR_VERSION } from "../substrate/extract";

type Screen =
  | { kind: "root" }
  | { kind: "message"; row: InboxRow; from: "inbox" | "search" }
  | { kind: "search" }
  | { kind: "accounts" }
  | { kind: "receipt"; actionId: string; from: Screen }
  // Slice 07: the composer, the exact review, the outcome, the drafts.
  | { kind: "compose"; start: ComposeStart; from: Screen }
  | { kind: "review"; draftId: string; revision: number; fields: DraftFields; review: Review; requestId: string; start: ComposeStart; from: Screen }
  | { kind: "outcome"; draft: DraftRow }
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

export default function EmailFlow({ onOpenConnections, onOpenEntity, onOpenModule, openId, openNonce, onOpenConsumed, focus, focusNonce, onFocusConsumed, client: given, token: givenToken, userId: givenUser, categories: givenCategories, now: nowFn = () => new Date(), zone: givenZone, initialScreen, waiting: givenWaiting }: {
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

  const snapshot = useMemo(() => loadSnapshot(userId), [userId]);
  const [accounts, setAccounts] = useState<EmailAccount[]>(snapshot?.accounts ?? []);
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
  const [reviewOnly, setReviewOnly] = useState(false);
  /** Today's count, read once when the review focus opens: the loaded pages may not hold all of it. */
  const [reviewTotal, setReviewTotal] = useState<number | null>(null);
  const depth = screen.kind === "root" ? 0
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

  useEffect(() => {
    // Dismissed cards shown or hidden: the page reads again.
    const ids = Object.keys(cards);
    if (ids.length) void loadCards(ids, showDismissed);
    // Only the switch matters here.
  }, [showDismissed]);

  const ready = useCallback((kind: CaptureKind) => readiness.kinds[kind].state === "ready", [readiness]);
  const readyLine = useCallback((kind: CaptureKind) => { const k = readiness.kinds[kind]; return k.state === "ready" ? "" : k.reason || notReadyLine(kind); }, [readiness]);

  const conflictOf = useCallback((c: Candidate): Conflict | null => {
    if (c.saved_sibling) return null;
    const p = c.payload;
    if (p.kind === "bill") {
      const hit = bills.find((b) => b.data.vendor.trim().toLowerCase() === p.issuer.trim().toLowerCase() && b.data.amountCents === p.amount.minor_units && (b.data.dueDate ?? null) === p.due_date);
      return hit ? { line: `${hit.data.vendor} · ${moneyWords(hit.data.amountCents, hit.data.currency)}${hit.data.dueDate ? " · Due " + monthDay(hit.data.dueDate) : ""}` } : null;
    }
    if (p.kind === "receipt") {
      const hit = receipts.find((r) => r.data.vendor.trim().toLowerCase() === p.merchant.trim().toLowerCase() && r.data.amountCents === p.amount.minor_units && r.data.transactionDate === p.purchase_date);
      return hit ? { line: `${hit.data.vendor} · ${moneyWords(hit.data.amountCents, hit.data.currency)} · ${monthDay(hit.data.transactionDate)}` } : null;
    }
    return null;
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

  const cardsFor = (row: InboxRow): ReactNode => {
    const list = cards[row.id];
    if (!client || !list || list.length === 0) return null;
    return (
      <CandidateCards client={client} candidates={list} row={row} ctx={contextFor(row, zone, nowFn)} ready={ready} readyLine={readyLine} offline={offline}
        evidenceExcerpt={bodyText.current[row.id]?.slice(0, 2000)} showDismissed={showDismissed} conflictOf={conflictOf} now={nowFn}
        onChanged={() => loadCards([row.id])} onDetails={(c) => setSheet({ candidate: c, row, text: bodyText.current[row.id] })} onReview={(c) => void reviewLatest(c, row)}
        onReceipt={(actionId) => setScreen((s) => ({ kind: "receipt", actionId, from: s }))}
        onOpenModule={(module, destinationId) => { if (destinationId && module !== "Money" && onOpenEntity) onOpenEntity(module === "Tasks" ? "task" : module === "Schedule" ? "event" : "waiting", destinationId); else onOpenModule?.(module); }} />
    );
  };

  // ---- the inbox ------------------------------------------------------------

  // The one load: accounts, a sync of each live mailbox (this is the pull or
  // the open, never a timer), then the first page from the cache. A failure
  // with saved rows keeps them and says so; without any, it is the error
  // state with Retry. One mailbox failing to sync is a line, not a blank.
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
    if (token) {
      const live = accountsNow.filter((a) => a.state !== "disconnected");
      const results = await Promise.all(live.map((a) => syncAccount(token, a.address)));
      const issues: Record<string, string> = {};
      const next: Record<string, string | null> = {};
      results.forEach((r, i) => {
        const a = live[i]!;
        if (!r.ok) issues[a.address] = lineFor(r);
        else next[a.address] = r.value.next_page;
      });
      setSyncIssues(issues);
      setProviderNext(next);
      const again = await listAccounts(client);
      if (again.ok) { accountsNow = again.value; setAccounts(accountsNow); }
    }
    const page = await inboxPage(client, { limit: PAGE });
    if (!page.ok) { setError(page); setPending(false); setRefreshing(false); return; }
    const fresh = page.value.rows;
    setCachedTotal(page.value.cached_total);
    let merged: InboxRow[] = fresh;
    setRows((prev) => {
      // The first page is the truth for what it covers; rows the person had
      // already scrolled to, older than its last row, stay where they were.
      const last = fresh[fresh.length - 1];
      const older = mode === "refresh" && last && fresh.length >= PAGE ? prev.filter((r) => newestFirst(last, r) < 0) : [];
      merged = mergeRows(fresh, older);
      persist(accountsNow, merged);
      return merged;
    });
    setPending(false);
    setRefreshing(false);
    await loadCards(merged.map((r) => r.id));
    void readRows(merged);
  }, [client, token, offline, persist, loadCards, readRows]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void load("first");
  }, [load]);

  const hasProviderNext = Object.values(providerNext).some(Boolean);
  const atEnd = rows.length >= cachedTotal && !(hasProviderNext && token && !offline);

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
  const counts = useMemo(() => countsByCategory(rows, tags, rules), [rows, tags, rules]);
  const chips = useMemo(() => categories.filter((c) => (counts[c.id] ?? 0) > 0), [categories, counts]);
  const visible = useMemo(() => {
    const base = chip ? rows.filter((r) => catOf(r) === chip) : rows;
    return reviewOnly ? base.filter((r) => (cards[r.id] ?? []).some(isToReview)) : base;
  }, [rows, chip, catOf, reviewOnly, cards]);
  // The review focus counts cards, as Today does, never rows: the two numbers are the same number.
  const loadedToReview = useMemo(() => (reviewOnly ? visible.reduce((n, r) => n + (cards[r.id] ?? []).filter(isToReview).length, 0) : 0), [reviewOnly, visible, cards]);
  const groups = useMemo(() => dayGroups(visible, now), [visible, now]);
  const live = accounts.filter((a) => a.state !== "disconnected");
  const labels = live.length > 1 ? accountLabels(live.map((a) => a.address)) : {};
  const reauth = accounts.some((a) => a.state === "reauth");
  const accountOf = (row: InboxRow) => accounts.find((a) => a.id === row.account_id) ?? null;

  // ---- waiting (slice 08) ---------------------------------------------------
  const loadWaiting = useCallback(async () => {
    if (!waitingSvc) return;
    try {
      const items = await waitingSvc.list();
      setWaitingItems(items);
      const threads = [...new Set(items.filter((i) => i.data.status === "open" && i.data.threadId).map((i) => i.data.threadId!))];
      if (client && threads.length) { const r = await threadsLatest(client, threads); if (r.ok) setWaitingLatest(r.value); }
    } catch { /* the list stays as it was */ }
  }, [waitingSvc, client]);
  useEffect(() => { if (segment === "waiting") void loadWaiting(); }, [segment, loadWaiting]);
  // A focus from Today or a receipt: the inbox narrowed to its cards, or one record.
  useEffect(() => {
    if (!focus || !focusNonce) return;
    if (focus.kind === "candidates") {
      setSegment("inbox"); setChip(null); setReviewOnly(true); setScreen({ kind: "root" });
      // Today's number, so the line can say how much of it is past the loaded pages (one read, on the tap).
      setReviewTotal(null);
      if (client && !offline) void reviewCount(client).then((r) => setReviewTotal(r.ok ? r.value.count : null));
    }
    else { setSegment("waiting"); setScreen({ kind: "waiting", id: focus.id }); void loadWaiting(); }
    onFocusConsumed?.();
    // The nonce is the signal; the focus value rides with it.
  }, [focusNonce]);
  const todayLocal = localDate(now.toISOString(), zone);
  const openMessageById = async (id: string) => {
    if (!client) return;
    const r = await readMessage(client, id);
    if (r.ok) { setScreen({ kind: "message", row: rowOf(r.value), from: "inbox" }); void loadCards([r.value.id]); }
    else showToast({ message: lineFor(r) });
  };

  // ---- compose, review, send (slice 07) ------------------------------------
  const canCompose = accounts.some((a) => a.state === "connected");
  const defaultAccountId = () => (accounts.find((a) => a.state === "connected") ?? accounts[0])?.id ?? "";
  const startCompose = (fields: DraftFields, accountId: string, from: Screen, extra: Partial<ComposeStart> = {}) => {
    setSendFailure(null);
    setScreen({ kind: "compose", start: { localKey: newLocalKey(nowFn), draftId: null, accountId, fields, revision: null, ...extra }, from });
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
  const openLocal = (l: LocalDraft) => {
    setSendFailure(null);
    setScreen({ kind: "compose", start: { localKey: l.key, draftId: l.draft_id, accountId: l.account_id || defaultAccountId(), fields: l.fields, revision: l.revision }, from: { kind: "drafts" } });
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
    const r = await sendApproved(token, { draft_id: s.draftId, review_nonce: s.review.review.review_nonce, shown_payload_hash: s.review.review.payload_hash, request_id: s.requestId });
    setSending(false);
    if (!r.ok) { setSendFailure(r); return; }
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
      evidenceText={sheet.text ?? bodyText.current[sheet.row.id]} onClose={() => setSheet(null)} onChanged={() => loadCards([sheet.row.id])} />
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
  if (screen.kind === "message" && client) {
    const row = screen.row;
    const current = rows.find((r) => r.id === row.id) ?? row;
    const more: RowAction[] = [
      { label: FIND_DETAILS, onPick: () => void (async () => { const n = await readBody(current, bodyText.current[row.id] ?? current.snippet, true); showToast({ message: foundLine(n) }); })(), disabled: offline },
      { label: CAPTURE_TITLE, onPick: () => setCapturing({ row: current, text: bodyText.current[row.id] }), disabled: offline },
      { label: showDismissed ? HIDE_DISMISSED : SHOW_DISMISSED, onPick: () => setShowDismissed((v) => !v) },
    ];
    return <div className={pushCls}>
      <MessageScreen client={client} token={token} userId={userId} row={current} account={accountOf(row)} offline={offline}
        categories={categories} categoryId={catOf(row)}
        onBack={() => setScreen(screen.from === "search" ? { kind: "search" } : { kind: "root" })}
        onRowChanged={patchRow}
        onLeftInbox={leftInbox}
        onFileUnder={(r, c) => void onFileUnder(r, c)}
        cards={cardsFor(current)} moreActions={more} onBodyText={(text) => void readBody(current, text)}
        onReply={(m, all) => startReply(m, all, screen)} />
      {sheetEl}{captureEl}
    </div>;
  }
  if (screen.kind === "search" && client) {
    return <div className={pushCls}>
      <SearchScreen client={client} token={token} accounts={accounts} labels={labels} offline={offline} state={search} onState={setSearch}
        categories={categories} categoryOf={catOf} categoryId={searchChip} onCategory={setSearchChip} now={now}
        onBack={() => setScreen({ kind: "root" })} onOpen={(row) => { setScreen({ kind: "message", row, from: "search" }); void loadCards([row.id]); }} />
    </div>;
  }
  if (screen.kind === "accounts") {
    return <div className={pushCls}>
      <AccountsScreen accounts={accounts} onBack={() => setScreen({ kind: "root" })} onOpenConnections={onOpenConnections} onOpenDrafts={client ? () => setScreen({ kind: "drafts" }) : undefined} />
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
        onDraftFollowUp={(start) => startFollowUp(it, start)} />
    </div>;
  }
  if (screen.kind === "compose" && client) {
    const from = screen.from;
    const start = screen.start;
    return <div className={pushCls}>
      <ComposeScreen client={client} userId={userId} accounts={accounts} offline={offline} fileStore={fileStore} start={start} now={nowFn}
        onBack={() => { setDraftsReload((n) => n + 1); setScreen(from.kind === "review" || from.kind === "compose" ? { kind: "root" } : from); }}
        onReview={(draftId, revision, fields, review) => setScreen({ kind: "review", draftId, revision, fields, review, requestId: newRequestId(), start: { ...start, localKey: draftId, draftId, fields, revision }, from })}
        onDiscarded={(copy) => discarded(copy, from)} />
    </div>;
  }
  if (screen.kind === "review" && client) {
    const s = screen;
    const backToCompose = () => { void cancelCommand(client, s.review.review.action_id); setSendFailure(null); setScreen({ kind: "compose", start: s.start, from: s.from }); };
    return <div className={pushCls}>
      <SendReviewScreen review={s.review} offline={offline} now={nowFn} sending={sending} failure={sendFailure} onEdit={backToCompose} onSend={() => void send(s)} onReviewAgain={backToCompose} />
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

  const fresh = freshnessLine(accounts, now);
  return (
    <div className={"screen ruled " + pushCls} {...handlers} data-extractor={EXTRACTOR_VERSION}>
      <PageHeader title={EMAIL_TITLE} actions={<>
        {canCompose && client && <BarAction label={COMPOSE_LABEL} onClick={() => startCompose(emptyFields(), defaultAccountId(), { kind: "root" })}><PenLine className="ic" /></BarAction>}
        <BarAction label={SEARCH_LABEL} onClick={() => setScreen({ kind: "search" })}><Search className="ic" /></BarAction>
        <BarAction label={REFRESH_LABEL} onClick={() => void load("refresh")}><RotateCcw className="ic" /></BarAction>
      </>}>
        {fresh && <button className="email-fresh" onClick={() => setScreen({ kind: "accounts" })}>{refreshing ? REFRESHING : fresh}</button>}
        <div className="pad-x">
          <div className="segmented" role="tablist" aria-label={EMAIL_TITLE}>
            {SEGMENTS.map((s) => (
              <button key={s.key} role="tab" aria-selected={segment === s.key} className={"seg" + (segment === s.key ? " active" : "")} onClick={() => setSegment(s.key)}>{s.label}</button>
            ))}
          </div>
        </div>
        {segment === "inbox" && chips.length > 0 && (
          <div className="chip-row" role="group" aria-label={AREAS_LABEL}>
            <button className={"chip" + (chip === null ? " active" : "")} onClick={() => setChip(null)}>{ALL_CHIP} <span className="email-chip-n">{rows.length}</span></button>
            {chips.map((c) => (
              <button key={c.id} className={"chip" + (chip === c.id ? " active" : "")} onClick={() => setChip(c.id)}>{c.data.name} <span className="email-chip-n">{counts[c.id]}</span></button>
            ))}
          </div>
        )}
      </PageHeader>

      <div className={"email-pull" + (armed || refreshing ? " on" : "")} aria-hidden="true">{refreshing ? REFRESHING : PULL_HINT}</div>
      {offline && <div className="email-note quiet"><span>{OFFLINE_LINE}</span></div>}
      {reauth && <div className="email-note"><span>{REAUTH_LINE}</span><button className="quiet-action" onClick={onOpenConnections}>{RECONNECT}</button></div>}
      {issueLines.map((l) => <div className="email-note quiet" key={l}><span>{l}</span></div>)}
      {error && rows.length > 0 && <div className="email-note quiet"><span>{REFRESH_FAILED}</span><button className="quiet-action" onClick={() => void load("refresh")}>{RETRY}</button></div>}

      {!client && (
        <EmptyState copy={NO_CLIENT} onAction={onOpenConnections} />
      )}
      {client && pending && rows.length === 0 && !error && <SkeletonRows rows={4} />}
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
      {client && segment === "inbox" && reviewOnly && (
        <div className="email-note"><span>{REVIEW_FILTER} · {loadedToReview}{reviewTotal !== null && reviewTotal > loadedToReview ? ` · ${moreInOlderMail(reviewTotal - loadedToReview)}` : ""}</span><button className="quiet-action" onClick={() => setReviewOnly(false)}>{SHOW_ALL_ROWS}</button></div>
      )}

      {client && segment === "inbox" && !pending && !error && accounts.length === 0 && (
        <EmptyState copy={EMPTY_ACCOUNTS} onAction={onOpenConnections} />
      )}
      {client && segment === "inbox" && !pending && !error && accounts.length > 0 && rows.length === 0 && (
        <EmptyState copy={EMPTY_INBOX} onAction={() => void load("refresh")} />
      )}
      {client && segment === "inbox" && rows.length > 0 && chip && visible.length === 0 && (
        <EmptyState copy={EMPTY_FILTER} onAction={() => setChip(null)} />
      )}
      {client && segment === "inbox" && visible.length > 0 && (
        <InboxList groups={groups} labels={labels} now={now} atEnd={atEnd} moreBusy={moreBusy} onLoadMore={() => void loadMore()}
          onOpen={openInboxRow} renderBelow={cardsFor} />
      )}
      <div className="screen-foot" />

      {question && (
        <RowActionSheet title={`${SUGGEST_TITLE} · ${categories.find((c) => c.id === question.rule.category_id)?.data.name ?? ""} · ${question.rule.sender_exact}`}
          actions={[{ label: REMEMBER, onPick: () => void answer(question, true) }, { label: NOT_NOW, onPick: () => void answer(question, false) }]}
          onCancel={() => void answer(question, false)} />
      )}
      {sheetEl}{captureEl}
    </div>
  );
}
