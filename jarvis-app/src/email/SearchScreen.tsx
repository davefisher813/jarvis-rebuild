// SEARCH (docs/jarvis-unified, slice 05; IMPLEMENTATION-SPEC.md 08 E03, 09
// M8, 11, 13). The person's words, literally: saved mail answers at once and
// is labelled as saved mail; Gmail is asked through the server with the same
// words quoted, in one account or all, and its answer replaces the saved hits
// with the coverage said out loud (which accounts answered, which did not).
// A transport failure keeps the saved hits and says Gmail was not reached;
// it never renders "No matching mail". Results are chronological. No
// natural language, no inference, no ranking.

import { useCallback, useEffect, useRef, useState } from "react";
import PageHeader from "../shared/PageHeader";
import ListFloor from "../shared/ListFloor";
import { lineFor } from "../substrate/commands/errors";
import type { Category } from "../categories/types";
import MailRow from "./MailRow";
import {
  ALL_ACCOUNTS, ALL_CHIP, AREAS_LABEL, COVER_CACHED, COVER_GMAIL, EMAIL_TITLE, EMPTY_SEARCH, LOADING_MORE, MORE_FROM_GMAIL, SAVED_MAIL_ONLY, SEARCHING_GMAIL, SEARCH_FAILED,
  SEARCH_LABEL, SEARCH_PLACEHOLDER, SEARCH_RESULTS_FLOOR, DIDNT_ANSWER, accountsWord, messagesWord,
} from "./copy";
import { mergeRows, searchCached, searchGmail, type EmailAccount, type InboxRow, type RpcClient } from "./emailClient";
import EmptyState from "./EmptyState";
import EmailFacts from "./EmailFacts";
import type { EmailFact } from "./format";

export interface SearchState {
  q: string;
  scope: string | null;
  rows: InboxRow[];
  /** What the rows came from, and how far it reached. */
  coverage: "none" | "cached" | "provider";
  covered: string[];
  failed: { email: string; code: string }[];
  window: number;
  next: { email: string; page: string } | null;
  searching: boolean;
  transportFailed: string | null;
}

export const EMPTY_SEARCH_STATE: SearchState = { q: "", scope: null, rows: [], coverage: "none", covered: [], failed: [], window: 0, next: null, searching: false, transportFailed: null };

export default function SearchScreen({ client, token, accounts, labels, offline, state, onState, categories, categoryOf, categoryId, onCategory, now, onBack, onOpen }: {
  client: RpcClient;
  token: string | null | undefined;
  accounts: EmailAccount[];
  /** The label each mailbox wears, from the flow; empty when there is one. */
  labels: Record<string, string>;
  offline: boolean;
  /** Held by the flow, so coming back from a result restores the query and its answer. */
  state: SearchState;
  onState: (s: SearchState | ((prev: SearchState) => SearchState)) => void;
  categories: Category[];
  categoryOf: (row: InboxRow) => string | null;
  categoryId: string | null;
  onCategory: (id: string | null) => void;
  now: Date;
  onBack: () => void;
  onOpen: (row: InboxRow) => void;
}) {
  const [draft, setDraft] = useState(state.q);
  const seq = useRef(0);
  const live = accounts.filter((a) => a.state !== "disconnected");

  const run = useCallback(async (q: string, scope: string | null) => {
    const text = q.trim();
    const my = ++seq.current;
    if (!text) { onState({ ...EMPTY_SEARCH_STATE, scope }); return; }
    const scopeIds = scope ? live.filter((a) => a.address === scope).map((a) => a.id) : null;
    onState((s) => ({ ...s, q: text, scope, searching: true, transportFailed: null, next: null }));
    const cached = await searchCached(client, text, scopeIds);
    if (seq.current !== my) return;
    const cachedRows = cached.ok ? cached.value.rows : [];
    onState((s) => ({ ...s, rows: cachedRows, coverage: "cached", window: cached.ok ? cached.value.window : 0, covered: [], failed: [] }));
    if (!token || offline) { onState((s) => ({ ...s, searching: false })); return; }
    const provider = await searchGmail(token, text, scope);
    if (seq.current !== my) return;
    if (!provider.ok) {
      onState((s) => ({ ...s, searching: false, transportFailed: lineFor(provider) }));
      return;
    }
    const p = provider.value;
    const union = p.covered.length === live.length || scope ? p.rows : mergeRows(cachedRows, p.rows);
    onState((s) => ({ ...s, rows: union, coverage: "provider", covered: p.covered, failed: p.failed, next: p.next_page, searching: false }));
  }, [client, token, offline, live, onState]);

  const more = async () => {
    if (!state.next || !token || offline) return;
    onState((s) => ({ ...s, searching: true }));
    const page = await searchGmail(token, state.q, null, state.next);
    if (!page.ok) { onState((s) => ({ ...s, searching: false, transportFailed: lineFor(page) })); return; }
    onState((s) => ({ ...s, rows: mergeRows(s.rows, page.value.rows), next: page.value.next_page, searching: false }));
  };

  // Typing searches saved mail and Gmail after a short pause; Enter searches now.
  useEffect(() => {
    if (draft.trim() === state.q) return;
    const t = setTimeout(() => void run(draft, state.scope), 400);
    return () => clearTimeout(t);
  }, [draft]);

  const shown = categoryId ? state.rows.filter((r) => categoryOf(r) === categoryId) : state.rows;
  // 2026-10-05: the coverage line is FACTS, never one string joined by middle dots ("Gmail · All Accounts · Didn't
  // Answer · work@... · 1 Message"). The source and the account are small caps (a label, the way the inbox row
  // draws its account), what was reached or not is the one grey or amber, and the count is a white number. A line
  // whose job is to show every fact, so it wraps rather than ellipsizing (see EmailFacts `wrap`).
  const coverFacts: EmailFact[] = (() => {
    if (!state.q) return [];
    if (state.coverage === "provider") {
      const who = state.scope ? state.scope : state.failed.length ? `${accountsWord(state.covered.length)} Covered` : ALL_ACCOUNTS;
      return [
        { text: COVER_GMAIL, tone: "date" },
        { text: who },
        ...(state.failed.length ? [{ text: `${DIDNT_ANSWER} ${state.failed.map((f) => f.email).join(", ")}`, tone: "warn" as const }] : []),
        { text: messagesWord(state.rows.length), strong: true },
      ];
    }
    if (state.coverage === "cached") {
      // Gmail not reached is an error (red), saved mail only is a limit (amber), searching is the one grey.
      const why: EmailFact | null = state.transportFailed ? { text: state.transportFailed, tone: "red" } : offline || !token ? { text: SAVED_MAIL_ONLY, tone: "warn" } : state.searching ? { text: SEARCHING_GMAIL } : null;
      return [
        { text: COVER_CACHED, tone: "date" },
        { text: `${messagesWord(state.window)} Searched`, strong: true },
        ...(why ? [why] : []),
      ];
    }
    return [];
  })();

  return (
    <div className="screen ruled">
      <PageHeader title={SEARCH_LABEL} back={EMAIL_TITLE} onBack={onBack}>
        <div className="pad-x">
          <input className="msg-input msg-search" placeholder={SEARCH_PLACEHOLDER} value={draft} autoFocus enterKeyHint="search"
            aria-label={SEARCH_PLACEHOLDER}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void run(draft, state.scope); }} />
        </div>
        {live.length > 1 && (
          <div className="chip-row" role="group" aria-label="Accounts">
            <button className={"chip" + (state.scope === null ? " active" : "")} onClick={() => void run(draft, null)}>{ALL_ACCOUNTS}</button>
            {live.map((a) => (
              <button key={a.id} className={"chip" + (state.scope === a.address ? " active" : "")} onClick={() => void run(draft, a.address)}>{labels[a.address] ?? a.address}</button>
            ))}
          </div>
        )}
        {categories.length > 0 && state.rows.length > 0 && (
          <div className="chip-row" role="group" aria-label={AREAS_LABEL}>
            <button className={"chip" + (categoryId === null ? " active" : "")} onClick={() => onCategory(null)}>{ALL_CHIP}</button>
            {categories.map((c) => (
              <button key={c.id} className={"chip" + (categoryId === c.id ? " active" : "")} onClick={() => onCategory(c.id)}>{c.data.name}</button>
            ))}
          </div>
        )}
      </PageHeader>

      {coverFacts.length > 0 && <div className="email-cover" aria-live="polite"><EmailFacts wrap facts={coverFacts} /></div>}

      {state.q && !state.searching && state.transportFailed && state.rows.length === 0 && (
        <EmptyState copy={SEARCH_FAILED} onAction={() => void run(draft, state.scope)} />
      )}
      {state.q && !state.searching && !state.transportFailed && shown.length === 0 && state.coverage !== "none" && (
        <EmptyState copy={EMPTY_SEARCH} onAction={() => { setDraft(""); onCategory(null); onState({ ...EMPTY_SEARCH_STATE, scope: state.scope }); }} />
      )}

      {shown.length > 0 && (
        <div className="pad-x">
          <div className="list-flat">
            {shown.map((r) => <MailRow key={r.id} row={r} accountLabel={labels[r.account] ?? ""} now={now} onOpen={onOpen} />)}
          </div>
          {state.next ? (
            <ListFloor>
              <>
                <div>{SEARCH_RESULTS_FLOOR}</div>
                <button className="quiet-action" disabled={state.searching} onClick={() => void more()}>{state.searching ? LOADING_MORE : MORE_FROM_GMAIL}</button>
              </>
            </ListFloor>
          ) : <ListFloor>{SEARCH_RESULTS_FLOOR}</ListFloor>}
        </div>
      )}
      <div className="screen-foot" />
    </div>
  );
}
