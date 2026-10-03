// THE EMAIL TAB, REDESIGNED IN PLACE (docs/jarvis-unified, slice 05;
// IMPLEMENTATION-SPEC.md 08 E01 to E06, E20 to E23, E28, E29; 09 M1, M2,
// M8, M9; 11; 13). Behind the email_intake_v1 flag the Email tab mounts this
// instead of the old MessagesFlow. What it is:
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
//     queued; reauth: the mail stays, the banner asks for the one fix.
//
// The Gmail token is never here. Reads go to the cache with the session;
// commands go to api/email/* with the session; the server holds the grant.
// Nothing runs on a timer: open, pull, tap. No candidate is created here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import SkeletonRows from "../shared/SkeletonRows";
import RowActionSheet from "../shared/RowActionSheet";
import { RotateCcw, Search } from "../shared/icons";
import { usePushDepth } from "../shared/pushNav";
import { showToast } from "../shared/toast";
import { supabase } from "../auth/supabaseClient";
import { useOptionalSession } from "../auth/AuthProvider";
import { useOptionalCategories, useUserId } from "../data/NotesProvider";
import { failure, lineFor, type CommandFailure } from "../substrate/commands/errors";
import type { Category } from "../categories/types";
import {
  ALL_CHIP, ARCHIVED, AREAS_LABEL, EMAIL_TITLE, EMPTY_ACCOUNTS, EMPTY_FILTER, EMPTY_INBOX, EMPTY_WAITING, NOT_NOW, NO_CLIENT, OFFLINE_LINE, PULL_HINT, REAUTH_LINE, RECONNECT,
  REFRESHING, REFRESH_FAILED, REFRESH_LABEL, REMEMBER, RETRY, RULE_KEPT, SEARCH_LABEL, SEGMENTS, SUGGEST_TITLE, TRASHED, UNDO, type Segment,
} from "./copy";
import {
  answerSuggestion, inboxPage, listAccounts, mergeRows, mirrorAccounts, newestFirst, offerSuggestion, readMessage, syncAccount, PAGE,
  type EmailAccount, type InboxRow, type MessageDetail, type RpcClient,
} from "./emailClient";
import { forgetMessage, loadSnapshot, saveSnapshot } from "./deviceCache";
import { categoryOf, countsByCategory, fileUnder, loadRules, loadTags, notNow, remember, type RulesStore, type SuggestionDue, type Tags } from "./categories";
import { accountLabels, dayGroups, freshnessLine } from "./format";
import { usePull } from "./usePull";
import InboxList from "./InboxList";
import MessageScreen, { type LeftInbox } from "./MessageScreen";
import SearchScreen, { EMPTY_SEARCH_STATE, type SearchState } from "./SearchScreen";
import AccountsScreen from "./AccountsScreen";
import EmptyState from "./EmptyState";

type Screen =
  | { kind: "root" }
  | { kind: "message"; row: InboxRow; from: "inbox" | "search" }
  | { kind: "search" }
  | { kind: "accounts" };

interface Question extends SuggestionDue { suggestionId: string | null }

const rowOf = (m: MessageDetail): InboxRow => ({
  id: m.id, account_id: m.account_id, account: m.account, provider_id: m.provider_id, thread_id: m.thread_id, internal_date: m.internal_date,
  from_address: m.from_address, from_name: m.from_name, subject: m.subject, snippet: m.snippet, has_body: m.has_body,
  attachment_metadata: m.attachments ?? [], provider_labels: m.provider_labels, source_hash: m.source_hash, read: m.read,
});

export default function EmailFlow({ onOpenConnections, openId, openNonce, onOpenConsumed, client: given, token: givenToken, userId: givenUser, categories: givenCategories, now: nowFn = () => new Date(), initialScreen }: {
  onOpenConnections: () => void;
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
  /** Where a bench or a test starts; the app always starts at the root. */
  initialScreen?: "search" | "accounts";
}) {
  const client: RpcClient | null = given === undefined ? supabase : given;
  const session = useOptionalSession();
  const token = givenToken === undefined ? session?.access_token ?? null : givenToken;
  const ctxUser = useUserId();
  const userId = givenUser ?? ctxUser ?? "local";
  const catsSvc = useOptionalCategories();

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
  const loaded = useRef(false);
  const pushCls = usePushDepth(screen.kind === "root" ? 0 : 1);
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

  const persist = useCallback((a: EmailAccount[], r: InboxRow[]) => saveSnapshot(userId, { accounts: a, rows: r }), [userId]);

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
    setRows((prev) => {
      // The first page is the truth for what it covers; rows the person had
      // already scrolled to, older than its last row, stay where they were.
      const last = fresh[fresh.length - 1];
      const older = mode === "refresh" && last && fresh.length >= PAGE ? prev.filter((r) => newestFirst(last, r) < 0) : [];
      const merged = mergeRows(fresh, older);
      persist(accountsNow, merged);
      return merged;
    });
    setPending(false);
    setRefreshing(false);
  }, [client, token, offline, persist]);

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
  }, [client, rows, cachedTotal, token, offline, providerNext, moreBusy, accounts, persist]);

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
    if (yes) showToast({ message: RULE_KEPT });
    if (client && q.suggestionId && !offline) await answerSuggestion(client, q.suggestionId, yes ? "accepted" : "dismissed");
  }, [client, offline, now]);

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
      if (m.ok) setScreen({ kind: "message", row: rowOf(m.value), from: "inbox" });
      onOpenConsumed?.();
    })();
    return () => { alive = false; };
    // One open per nonce.
  }, [openId, openNonce]);

  const { armed, handlers } = usePull(() => void load("refresh"), !!client && !offline && !refreshing && screen.kind === "root");

  const catOf = useCallback((r: InboxRow) => categoryOf(r, tags, rules), [tags, rules]);
  const counts = useMemo(() => countsByCategory(rows, tags, rules), [rows, tags, rules]);
  const chips = useMemo(() => categories.filter((c) => (counts[c.id] ?? 0) > 0), [categories, counts]);
  const visible = useMemo(() => (chip ? rows.filter((r) => catOf(r) === chip) : rows), [rows, chip, catOf]);
  const groups = useMemo(() => dayGroups(visible, now), [visible, now]);
  const live = accounts.filter((a) => a.state !== "disconnected");
  const labels = live.length > 1 ? accountLabels(live.map((a) => a.address)) : {};
  const reauth = accounts.some((a) => a.state === "reauth");
  const accountOf = (row: InboxRow) => accounts.find((a) => a.id === row.account_id) ?? null;
  const issueLines = Object.entries(syncIssues).map(([address, line]) => `Didn't Refresh · ${address} · ${line}`);

  if (screen.kind === "message" && client) {
    const row = screen.row;
    return <div className={pushCls}>
      <MessageScreen client={client} token={token} userId={userId} row={rows.find((r) => r.id === row.id) ?? row} account={accountOf(row)} offline={offline}
        categories={categories} categoryId={catOf(row)}
        onBack={() => setScreen(screen.from === "search" ? { kind: "search" } : { kind: "root" })}
        onRowChanged={patchRow}
        onLeftInbox={leftInbox}
        onFileUnder={(r, c) => void onFileUnder(r, c)} />
    </div>;
  }
  if (screen.kind === "search" && client) {
    return <div className={pushCls}>
      <SearchScreen client={client} token={token} accounts={accounts} labels={labels} offline={offline} state={search} onState={setSearch}
        categories={categories} categoryOf={catOf} categoryId={searchChip} onCategory={setSearchChip} now={now}
        onBack={() => setScreen({ kind: "root" })} onOpen={(row) => setScreen({ kind: "message", row, from: "search" })} />
    </div>;
  }
  if (screen.kind === "accounts") {
    return <div className={pushCls}>
      <AccountsScreen accounts={accounts} onBack={() => setScreen({ kind: "root" })} onOpenConnections={onOpenConnections} />
    </div>;
  }

  const fresh = freshnessLine(accounts, now);
  return (
    <div className={"screen ruled " + pushCls} {...handlers}>
      <PageHeader title={EMAIL_TITLE} actions={<>
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

      {client && segment === "waiting" && (
        <EmptyState copy={EMPTY_WAITING} onAction={() => setSegment("inbox")} />
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
          onOpen={(row) => setScreen({ kind: "message", row, from: "inbox" })} />
      )}
      <div className="screen-foot" />

      {question && (
        <RowActionSheet title={`${SUGGEST_TITLE} · ${categories.find((c) => c.id === question.rule.category_id)?.data.name ?? ""} · ${question.rule.sender_exact}`}
          actions={[{ label: REMEMBER, onPick: () => void answer(question, true) }, { label: NOT_NOW, onPick: () => void answer(question, false) }]}
          onCancel={() => void answer(question, false)} />
      )}
    </div>
  );
}
