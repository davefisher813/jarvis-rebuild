import { useCallback, useEffect, useRef, useState } from "react";
import { Mail, Plus, Archive, CornerUpLeft, Forward } from "lucide-react";
import type { AIService } from "../ai/AIService";
import { useGoogle } from "../connections/google/GoogleSession";
import { googleConfigured } from "../connections/google/config";
import {
  mapThread, mapThreadFull, mapGmailFull, buildReply, encodeEmail,
  type ThreadRow, type ThreadFull, type MailFull,
} from "../connections/google/map";
import {
  loadTriageCache, saveTriageCache, triageDelta, buildTriageInput, parseTriage,
  fillSkipped, splitByBucket, headline, noiseLine, type TriageMap, type Bucket,
} from "./triage";
import { loadRules, saveRule, applyRules, type SenderRules } from "./rules";
import DeckFlow from "./DeckFlow";
import { emit } from "../events";
import { usePushDepth } from "../shared/pushNav";
import { Burst } from "../shared/Burst";
import { useOptionalSession } from "../auth/AuthProvider";
import { findWaiting, waitingLine, nudgePrompt, type WaitingRow } from "./waiting";
import { loadTracks, saveTrack, trackForThread, newTrackId, pixelUrlFor, registerTrack, checkOpens } from "./tracking";
import { b64urlDecodeBytes } from "../connections/google/map";

type Draft = { to: string; subject: string; body: string; inReplyTo?: string; threadId?: string; fromDeck?: boolean };
type DraftRow = { id: string; to: string; subject: string; snippet: string };
type View = "list" | "detail" | "compose" | "deck" | "dead";
type Filter = "triage" | "all" | "drafts";

const AUTONOISE_KEY = "jarvis.mail.autonoise.v1";
const BUCKET_LABEL: Record<Bucket, string> = { needs_you: "Needs You", worth_knowing: "Worth Knowing", noise: "Noise" };

function fmtDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? s + "s" : Math.floor(s / 60) + "m " + (s % 60) + "s";
}

const DEFAULT_REPLIES = ["Thanks", "Got it", "Will do"];

function header(msg: { payload?: { headers?: { name: string; value: string }[] } }, name: string): string {
  const h = (msg.payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

// "7:41 AM" today, "Aug 4" otherwise. Cosmetic, so the wall clock is fine.
function fmtWhen(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Email (rebuild, session Email 1): not an inbox — a status report. One AI
// pass buckets every thread (needs you / worth knowing / noise) with a gist,
// so junk is never opened. The headline counts what needs Dave, never unread.
// Threads are the unit throughout; search is server-side over the whole
// mailbox. Without AI the tab is an honest threaded list — no fake triage.
export default function MessagesFlow({ ai, configured = googleConfigured(), token }: { ai: AIService; configured?: boolean; token?: string }) {
  const g = useGoogle();
  const session = useOptionalSession();
  const authToken = token ?? session?.access_token;
  const [view, setView] = useState<View>("list");
  const [rows, setRows] = useState<ThreadRow[]>([]);
  const [triage, setTriage] = useState<TriageMap>({});
  const [triaged, setTriaged] = useState(false);
  const [rules, setRules] = useState<SenderRules>(() => loadRules());
  const [noiseOpen, setNoiseOpen] = useState(false);
  const [autoNoise, setAutoNoise] = useState<boolean>(() => {
    try { return localStorage.getItem(AUTONOISE_KEY) === "1"; } catch { return false; }
  });
  const [autoOffer, setAutoOffer] = useState(false);
  const [deadStats, setDeadStats] = useState<{ n: number; ms: number } | null>(null);
  // The deck runs on a SNAPSHOT of needs-you taken when it opens. Passing the
  // live-filtered list while the deck advances its own index double-advanced
  // and silently skipped an email (caught by the email 2 walk). A skipped
  // email nobody decided on is this feature's worst failure.
  const [deckRows, setDeckRows] = useState<ThreadRow[] | null>(null);
  const [waiting, setWaiting] = useState<WaitingRow[]>([]);
  const [opens, setOpens] = useState<Record<string, string>>({}); // threadId -> first-open ISO
  const [nudging, setNudging] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("triage");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ThreadRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadFull | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [replies, setReplies] = useState<string[]>(DEFAULT_REPLIES);
  const [draft, setDraft] = useState<Draft>({ to: "", subject: "", body: "" });
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const triageBusy = useRef(false);

  const runTriage = useCallback(async (threads: ThreadRow[]) => {
    if (!ai.available || triageBusy.current) return;
    const cache = loadTriageCache();
    const delta = triageDelta(threads, cache);
    if (delta.length === 0) {
      setTriage(cache);
      setTriaged(true);
      return;
    }
    triageBusy.current = true;
    try {
      const raw = await ai.complete(
        [{ role: "user", content: buildTriageInput(delta) }],
        "You output only a JSON array, nothing else.",
      );
      const parsed = parseTriage(raw, delta);
      if (!parsed) return; // honest fallback: plain list, not invented buckets
      const merged = fillSkipped({ ...cache, ...parsed }, delta);
      saveTriageCache(merged);
      setTriage(merged);
      setTriaged(true);
    } catch { /* triage is a layer, not a gate: the list still works */ } finally {
      triageBusy.current = false;
    }
  }, [ai]);

  const loadThreads = useCallback(async () => {
    const api = g.api();
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const metas = await api.listThreads(40);
      const mapped = metas.map(mapThread).filter((t): t is ThreadRow => t !== null && t.inInbox)
        .sort((a, b) => b.dateMs - a.dateMs);
      setRows(mapped);
      setTriage(loadTriageCache());
      void runTriage(mapped);
      void loadWaiting(api);
    } catch (e) {
      setError((e as Error).message || "Could not load mail");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, runTriage]);

  // Waiting On is a bonus layer: it loads after the inbox and fails to
  // nothing. Opens are looked up only for threads we actually tracked.
  const loadWaiting = async (api: NonNullable<ReturnType<typeof g.api>>) => {
    try {
      const w = await findWaiting(api, Date.now());
      setWaiting(w);
      const tracks = loadTracks();
      const pairs = w
        .map((row) => ({ threadId: row.threadId, trackId: trackForThread(row.threadId, tracks) }))
        .filter((p): p is { threadId: string; trackId: string } => !!p.trackId);
      if (pairs.length) {
        const found = await checkOpens(pairs.map((p) => p.trackId), authToken);
        const byThread: Record<string, string> = {};
        for (const p of pairs) if (found[p.trackId]) byThread[p.threadId] = found[p.trackId]!;
        setOpens(byThread);
      }
    } catch { setWaiting([]); }
  };

  // Tap a Waiting On row: JARVIS drafts the nudge, the user gets it in
  // compose. It never auto-sends: a nudge is a relationship move.
  const startNudge = async (row: WaitingRow) => {
    const api = g.api();
    if (!api || nudging) return;
    setNudging(row.threadId);
    try {
      const full = mapThreadFull(await api.getThread(row.threadId));
      const last = full.messages[full.messages.length - 1];
      if (!last) return;
      let body = "";
      if (ai.available) {
        try {
          const p = nudgePrompt(row);
          body = (await ai.complete([{ role: "user", content: p.user }], p.system, { tier: "write" })).trim();
        } catch { body = ""; }
      }
      setEditingDraftId(null);
      // No thread state: a nudge starts from HOME, so compose's Cancel must
      // land back on the list, not on a detail view the user never visited.
      setThread(null);
      setDraft({
        to: row.toEmail,
        subject: /^re:/i.test(last.subject) ? last.subject : "Re: " + last.subject,
        body,
        inReplyTo: last.messageId,
        threadId: full.id,
      });
      setView("compose");
    } catch {
      setError("Couldn't open that conversation.");
    } finally {
      setNudging(null);
    }
  };

  const loadDrafts = useCallback(async () => {
    const api = g.api();
    if (!api) return;
    setLoading(true);
    try {
      const ds = await api.listDrafts(25);
      setDrafts(ds.map((d) => ({ id: d.id, to: header(d.message, "To"), subject: header(d.message, "Subject"), snippet: d.message.snippet || "" })));
      setDraftsLoaded(true);
    } catch (e) {
      setError((e as Error).message || "Could not load drafts");
    } finally {
      setLoading(false);
    }
  }, [g]);

  useEffect(() => {
    if (g.hasToken) void loadThreads();
  }, [g.hasToken, loadThreads]);

  useEffect(() => {
    if (g.hasToken && filter === "drafts" && !draftsLoaded) void loadDrafts();
  }, [g.hasToken, filter, draftsLoaded, loadDrafts]);

  const connect = async () => {
    setError(null);
    try {
      await g.connect();
      await loadThreads();
    } catch (e) {
      setError((e as Error).message || "Could not connect");
    }
  };

  const runSearch = async () => {
    const api = g.api();
    const q = search.trim();
    if (!api || !q) return;
    setSearching(true);
    setError(null);
    try {
      const metas = await api.searchThreads(q, 20);
      setResults(metas.map(mapThread).filter((t): t is ThreadRow => t !== null).sort((a, b) => b.dateMs - a.dateMs));
    } catch (e) {
      setError((e as Error).message || "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const openThread = async (id: string) => {
    const api = g.api();
    if (!api) return;
    setSummary(null);
    setReplies(DEFAULT_REPLIES);
    try {
      const full = mapThreadFull(await api.getThread(id));
      if (full.messages.length === 0) return;
      setThread(full);
      setView("detail");
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, unread: false } : r)));
      api.modifyThread(id, [], ["UNREAD"]).catch(() => {});
      const convo = full.messages.slice(-4).map((m) => m.from + ": " + m.body.slice(0, 1500)).join("\n---\n");
      if (ai.available && convo.trim()) {
        try {
          const s = await ai.complete(
            [{ role: "user", content: "Summarize this email conversation in one or two sentences. If something is being asked of the reader, lead with that.\n\n" + convo }],
            "You are a concise assistant. Reply with only the summary.",
          );
          setSummary(s.trim());
        } catch { setSummary(null); }
        try {
          const raw = await ai.complete(
            [{ role: "user", content: "Suggest 3 short reply options to the last message in this conversation, each under 6 words. Return ONLY a JSON array of 3 strings.\n\n" + convo }],
            "You output only a JSON array of strings, nothing else.",
          );
          const parsed = JSON.parse(raw.trim()) as unknown;
          if (Array.isArray(parsed)) {
            const clean = parsed.filter((x): x is string => typeof x === "string").slice(0, 3);
            if (clean.length) setReplies(clean);
          }
        } catch { /* keep default replies */ }
      }
    } catch (e) {
      setError((e as Error).message || "Could not open conversation");
    }
  };

  // Attachments open in a new tab (or download when the browser can't render
  // the type). Bytes travel Gmail -> this device only, nothing is uploaded.
  const openAttachment = async (messageId: string, attachmentId: string, filename: string, mime: string) => {
    const api = g.api();
    if (!api) return;
    try {
      const { data } = await api.getAttachment(messageId, attachmentId);
      const bytes = b64urlDecodeBytes(data);
      if (bytes.length === 0) throw new Error("empty");
      const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: mime }));
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError("Couldn't fetch " + filename);
    }
  };

  const archiveThread = (id: string) => {
    const api = g.api();
    if (!api) return;
    setRows((rs) => rs.filter((r) => r.id !== id));
    setResults((rs) => (rs ? rs.filter((r) => r.id !== id) : rs));
    setView("list");
    api.modifyThread(id, [], ["INBOX"]).catch(() => {});
  };

  const archiveAllNoise = (noise: ThreadRow[], manual = true) => {
    const api = g.api();
    if (!api || noise.length === 0) return;
    const ids = new Set(noise.map((r) => r.id));
    setRows((rs) => rs.filter((r) => !ids.has(r.id)));
    setNoiseOpen(false);
    for (const r of noise) api.modifyThread(r.id, [], ["INBOX"]).catch(() => {});
    const what = noise.length === 1 ? "1 conversation archived" : noise.length + " conversations archived";
    setToast(manual ? what : "Handled for you: " + what.toLowerCase() + " (" + noiseLine(noise) + ")");
    setTimeout(() => setToast(null), manual ? 2500 : 5000);
    if (manual && !autoNoise) setAutoOffer(true);
  };

  const enableAutoNoise = () => {
    try { localStorage.setItem(AUTONOISE_KEY, "1"); } catch { /* stays manual */ }
    setAutoNoise(true);
    setAutoOffer(false);
  };

  // Auto-clear noise (opt-in): runs once per triage result. The receipt names
  // what was archived, so nothing is ever silently hidden.
  const autoRan = useRef(false);
  useEffect(() => {
    if (!triaged || !autoNoise || autoRan.current) return;
    const { noise } = splitByBucket(rows, applyRules(triage, rows, rules));
    if (noise.length === 0) return;
    autoRan.current = true;
    archiveAllNoise(noise, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triaged, autoNoise, rows, triage, rules]);

  const lastMsg = (t: ThreadFull): MailFull => t.messages[t.messages.length - 1]!;

  const startReply = (t: ThreadFull) => {
    const r = buildReply(lastMsg(t), "");
    setEditingDraftId(null);
    setDraft({ to: r.to, subject: r.subject, body: r.body, inReplyTo: r.inReplyTo, threadId: r.threadId });
    setView("compose");
  };
  const startForward = (t: ThreadFull) => {
    const m = lastMsg(t);
    setEditingDraftId(null);
    setDraft({ to: "", subject: /^fwd:/i.test(m.subject) ? m.subject : "Fwd: " + m.subject, body: "\n\n---------- Forwarded ----------\n" + m.body });
    setView("compose");
  };
  const startCompose = () => {
    setEditingDraftId(null);
    setDraft({ to: "", subject: "", body: "" });
    setView("compose");
  };
  const quickReply = (t: ThreadFull, text: string) => {
    const r = buildReply(lastMsg(t), text);
    setEditingDraftId(null);
    setDraft({ to: r.to, subject: r.subject, body: text, inReplyTo: r.inReplyTo, threadId: r.threadId });
    setView("compose");
  };
  const openDraft = async (draftId: string) => {
    const api = g.api();
    if (!api) return;
    try {
      const res = await api.getDraft(draftId);
      const full = mapGmailFull(res.message);
      setEditingDraftId(draftId);
      setDraft({ to: full.to || "", subject: full.subject, body: full.body });
      setView("compose");
    } catch (e) {
      setError((e as Error).message || "Could not open draft");
    }
  };

  const send = async () => {
    const api = g.api();
    if (!api || !draft.to.trim()) {
      setError(!draft.to.trim() ? "Add a recipient" : "Not connected");
      return;
    }
    setSending(true);
    setError(null);
    try {
      // Every send carries the pixel: that is what powers "Opened" on Waiting
      // On. The id-to-thread mapping stays on this device; the server knows
      // only an anonymous id and a timestamp.
      const trackId = newTrackId();
      const raw = encodeEmail({ to: draft.to.trim(), subject: draft.subject, body: draft.body, inReplyTo: draft.inReplyTo, pixelUrl: pixelUrlFor(trackId) });
      const sent = await api.sendMessage(raw, draft.threadId);
      saveTrack(trackId, { threadId: sent.threadId || draft.threadId || sent.id, sentAt: Date.now() });
      void registerTrack(trackId, authToken);
      // The voice metric: a deck draft that needed editing before it could be
      // sent. Unedited sends are logged from the deck's Send & Next.
      if (draft.fromDeck) emit({ type: "action", props: { name: "email.deck.sent", edited: true } });
      if (editingDraftId) {
        const id = editingDraftId;
        api.deleteDraft(id).catch(() => {});
        setDrafts((ds) => ds.filter((d) => d.id !== id));
        setEditingDraftId(null);
      }
      setToast("Sent");
      setView("list");
      setTimeout(() => setToast(null), 2000);
    } catch (e) {
      setError((e as Error).message || "Could not send");
    } finally {
      setSending(false);
    }
  };

  const pushCls = usePushDepth(view === "compose" ? 2 : view === "detail" || view === "deck" ? 1 : 0);

  const effTriage = applyRules(triage, rows, rules);

  if (view === "deck") {
    const api = g.api();
    if (!api || !deckRows || deckRows.length === 0) { setView("list"); return null; }
    return (
      <div className={"screen " + pushCls} key="deck">
        <DeckFlow
          ai={ai}
          api={api}
          threads={deckRows}
          token={authToken}
          onExit={() => { setDeckRows(null); setView("list"); }}
          onDone={(n, ms) => { setDeckRows(null); setDeadStats({ n, ms }); setView("dead"); }}
          onOpenThread={(id) => void openThread(id)}
          onEditReply={(t, body) => {
            const r = buildReply(t.messages[t.messages.length - 1]!, body);
            setThread(t);
            setEditingDraftId(null);
            setDraft({ to: r.to, subject: r.subject, body, inReplyTo: r.inReplyTo, threadId: r.threadId, fromDeck: true });
            setView("compose");
          }}
          onHandled={(threadId, archived) => {
            if (archived) setRows((rs) => rs.filter((r) => r.id !== threadId));
          }}
        />
      </div>
    );
  }

  if (view === "dead" && deadStats) {
    return (
      <div className={"screen " + pushCls} key="dead">
        <div className="nav-bar"><div className="nav-large">Email</div></div>
        <div className="pad-x"><div className="card"><div className="empty-state">
          <div className="deck-dead-burst"><Burst show /></div>
          <div className="empty-title">Inbox: dead</div>
          <div className="empty-sub">{deadStats.n} handled in {fmtDuration(deadStats.ms)}</div>
        </div></div></div>
        <div className="pad-x conn-action">
          <button className="btn btn-secondary btn-block" onClick={() => { setDeadStats(null); setView("list"); }}>Back to Email</button>
        </div>
      </div>
    );
  }

  if (view === "list" && (!configured || !g.hasToken)) {
    return (
      <div className={"screen " + pushCls} key="connect">
        <div className="nav-bar"><div className="nav-large">Email</div></div>
        <div className="pad-x"><div className="card"><div className="empty-state">
          <div className="empty-icon"><Mail className="ic" /></div>
          <div className="empty-title">{configured ? "Connect your email" : "Email setup required"}</div>
          <div className="empty-sub">
            {configured
              ? "Connect Google to read and send email here."
              : "A Google sign-in client must be set up before email can connect (Settings, Connections)."}
          </div>
        </div></div></div>
        {configured && (
          <div className="pad-x conn-action">
            <button className="btn btn-primary btn-block" onClick={connect}>Connect Google</button>
          </div>
        )}
        {error && <div className="pad-x conn-error">{error}</div>}
      </div>
    );
  }

  if (view === "compose") {
    return (
      <div className={"screen " + pushCls} key="compose">
        <div className="nav-bar">
          <button className="nav-back" onClick={() => setView(thread && !editingDraftId ? "detail" : "list")}>Cancel</button>
          <span className="nav-title">{editingDraftId ? "Draft" : "New message"}</span>
          <button className="nav-act" onClick={send} disabled={sending}>{sending ? "..." : "Send"}</button>
        </div>
        <div className="pad-x msg-compose">
          <input className="msg-input" placeholder="To" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <input className="msg-input" placeholder="Subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          <textarea className="msg-textarea" placeholder="Message" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          {error && <div className="conn-error">{error}</div>}
        </div>
      </div>
    );
  }

  if (view === "detail" && thread) {
    return (
      <div className={"screen " + pushCls} key="detail">
        <div className="nav-bar">
          <button className="nav-back" onClick={() => setView("list")}>Email</button>
          <span className="nav-title"></span>
          <button className="nav-act" onClick={() => archiveThread(thread.id)} aria-label="Archive"><Archive className="ic" /></button>
        </div>
        <div className="pad-x">
          <div className="msg-detail-head">
            <div className="msg-detail-subj">{thread.subject}</div>
            <div className="conn-meta">{thread.messages.length === 1 ? lastMsg(thread).from : thread.messages.length + " messages"}</div>
          </div>
          {summary && (
            <div className="card msg-summary">
              <div className="eyebrow">JARVIS Summary</div>
              <div className="msg-summary-text">{summary}</div>
            </div>
          )}
          {thread.messages.map((m) => (
            <div className="msg-turn" key={m.id}>
              <div className="msg-turn-head">
                <span className="msg-turn-from">{m.from}</span>
                <span className="conn-meta">{m.date}</span>
              </div>
              <div className="msg-body">{m.body}</div>
              {m.attachments.length > 0 && (
                <div className="msg-quick">
                  {m.attachments.map((a) => (
                    <button key={a.attachmentId} className="chip" onClick={() => void openAttachment(m.id, a.attachmentId, a.filename, a.mime)}>
                      {a.filename}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="msg-quick">
            {replies.map((q) => (
              <button key={q} className="chip" onClick={() => quickReply(thread, q)}>{q}</button>
            ))}
          </div>
          <div className="msg-actions">
            <button className="btn btn-secondary" onClick={() => startReply(thread)}><CornerUpLeft className="ic" /> Reply</button>
            <button className="btn btn-secondary" onClick={() => startForward(thread)}><Forward className="ic" /> Forward</button>
          </div>
          {/* Sender rule: filing a sender is a RULE, not a hint. Deterministic,
              wins over triage, forever. Only shown when triage is live. */}
          {triaged && (
            <div className="msg-filed">
              <span className="conn-meta">This sender goes to</span>
              <div className="msg-chips">
                {(["needs_you", "worth_knowing", "noise"] as Bucket[]).map((b) => {
                  const senderEmail = lastMsg(thread).fromEmail;
                  const current = rules[senderEmail.toLowerCase()]
                    ?? applyRules(triage, rows, rules)[thread.id]?.bucket;
                  return (
                    <button
                      key={b}
                      className={"chip" + (current === b ? " on" : "")}
                      onClick={() => {
                        setRules(saveRule(senderEmail, b));
                        setToast("Noted. " + lastMsg(thread).from + " goes to " + BUCKET_LABEL[b] + " from now on.");
                        setTimeout(() => setToast(null), 2500);
                      }}
                    >{BUCKET_LABEL[b]}</button>
                  );
                })}
              </div>
            </div>
          )}
          {toast && <div className="conn-status">{toast}</div>}
        </div>
      </div>
    );
  }

  // ---- list ----
  const { needsYou, worthKnowing, noise } = splitByBucket(rows, effTriage);
  const showTriage = filter === "triage" && triaged && results === null;
  const listRows = results !== null ? results : rows;

  const threadRow = (r: ThreadRow, gist?: string) => (
    <div className="row" role="button" tabIndex={0} key={r.id} onClick={() => void openThread(r.id)}>
      {r.unread && <span className="msg-dot" aria-label="unread"></span>}
      <div className="row-grow">
        <div className="msg-line">
          <span className={"conn-name truncate" + (r.unread ? " msg-strong" : "")}>{r.from}</span>
          <span className="msg-when">{fmtWhen(r.dateMs)}</span>
        </div>
        <div className="conn-meta msg-gist">{gist ?? r.subject}{r.count > 1 ? " · " + r.count : ""}</div>
      </div>
    </div>
  );

  return (
    <div className={"screen " + pushCls} key="list">
      <div className="nav-bar">
        <div className="nav-large">Email</div>
        <button className="nav-act" onClick={startCompose} aria-label="New message"><Plus className="ic" /></button>
      </div>
      {showTriage && <div className="pad-x msg-headline">{headline(needsYou.length, rows.length)}</div>}
      {showTriage && needsYou.length > 0 && (
        <div className="pad-x deck-cta">
          <button className="btn btn-primary btn-block" onClick={() => { setDeckRows(needsYou); setView("deck"); }}>
            Deal With It · {needsYou.length}
          </button>
        </div>
      )}
      <div className="pad-x">
        <input
          className="msg-input msg-search" placeholder="Search all mail" value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!e.target.value.trim()) setResults(null);
          }}
          onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
        />
      </div>
      <div className="pad-x msg-chips">
        <button className={"chip" + (filter === "triage" ? " on" : "")} onClick={() => setFilter("triage")}>For You</button>
        <button className={"chip" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")}>All</button>
        <button className={"chip" + (filter === "drafts" ? " on" : "")} onClick={() => setFilter("drafts")}>
          Drafts {draftsLoaded && drafts.length > 0 ? "(" + drafts.length + ")" : ""}
        </button>
      </div>
      {error && <div className="pad-x conn-error">{error}</div>}
      {searching && <div className="pad-x conn-status">Searching everything...</div>}

      {filter === "drafts" ? (
        loading && !draftsLoaded ? (
          <div className="pad-x"><div className="card"><div className="empty-state"><div className="empty-title">Loading...</div></div></div></div>
        ) : drafts.length === 0 ? (
          <div className="pad-x"><div className="card"><div className="empty-state">
            <div className="empty-icon"><Mail className="ic" /></div>
            <div className="empty-title">No drafts</div>
          </div></div></div>
        ) : (
          <div className="pad-x"><div className="card">
            {drafts.map((d) => (
              <div className="row" role="button" tabIndex={0} key={d.id} onClick={() => void openDraft(d.id)}>
                <div className="row-grow">
                  <div className="conn-name">{d.to || "(no recipient)"}</div>
                  <div className="conn-meta">{d.subject || "(no subject)"}</div>
                </div>
              </div>
            ))}
          </div></div>
        )
      ) : loading && rows.length === 0 ? (
        <div className="pad-x"><div className="card"><div className="empty-state"><div className="empty-title">Loading...</div></div></div></div>
      ) : results !== null || !showTriage ? (
        // Search results, the All chip, or triage unavailable: honest threaded list.
        listRows.length === 0 ? (
          <div className="pad-x"><div className="card"><div className="empty-state">
            <div className="empty-icon"><Mail className="ic" /></div>
            <div className="empty-title">{results !== null ? "No matches" : "Inbox empty"}</div>
          </div></div></div>
        ) : (
          <div className="pad-x"><div className="card">{listRows.map((r) => threadRow(r))}</div></div>
        )
      ) : (
        <>
          {rows.length === 0 && (
            <div className="pad-x"><div className="card"><div className="empty-state">
              <div className="empty-icon"><Mail className="ic" /></div>
              <div className="empty-title">Inbox is quiet</div>
            </div></div></div>
          )}
          {needsYou.length > 0 && (
            <>
              <div className="sec-head"><div className="sec-left"><div className="sec-title">Needs You</div></div></div>
              <div className="pad-x"><div className="card">
                {needsYou.map((r) => threadRow(r, effTriage[r.id]?.gist))}
              </div></div>
            </>
          )}
          {waiting.length > 0 && (
            <>
              <div className="sec-head"><div className="sec-left"><div className="sec-title">Waiting On</div></div></div>
              <div className="pad-x"><div className="card">
                {waiting.map((w) => (
                  <div className="row" role="button" tabIndex={0} key={w.threadId} onClick={() => void startNudge(w)}>
                    <div className="row-grow">
                      <div className="msg-line">
                        <span className="conn-name truncate">{w.to}</span>
                        <span className="msg-when">{nudging === w.threadId ? "Drafting..." : "Nudge"}</span>
                      </div>
                      <div className="conn-meta msg-gist">{w.subject} · {waitingLine(w, opens[w.threadId] ?? null)}</div>
                    </div>
                  </div>
                ))}
              </div></div>
            </>
          )}
          {worthKnowing.length > 0 && (
            <>
              <div className="sec-head"><div className="sec-left"><div className="sec-title">Worth Knowing</div></div></div>
              <div className="pad-x"><div className="card">
                {worthKnowing.map((r) => threadRow(r, effTriage[r.id]?.gist))}
              </div></div>
            </>
          )}
          {noise.length > 0 && (
            <>
              <div className="sec-head">
                <div className="sec-left"><div className="sec-title">Noise</div></div>
                <button className="see-all" onClick={() => archiveAllNoise(noise)}>Archive All</button>
              </div>
              <div className="pad-x"><div className="card">
                <div className="row" role="button" tabIndex={0} onClick={() => setNoiseOpen(!noiseOpen)}>
                  <div className="row-grow">
                    <div className="conn-name">{noise.length === 1 ? "1 automated email" : noise.length + " automated emails"}</div>
                    <div className="conn-meta msg-gist">{noiseLine(noise)}</div>
                  </div>
                </div>
                {noiseOpen && noise.map((r) => threadRow(r, effTriage[r.id]?.gist))}
              </div></div>
            </>
          )}
          {autoOffer && (
            <div className="pad-x offer-row">
              <button className="btn btn-secondary btn-block" onClick={enableAutoNoise}>Clear Noise Automatically From Now On</button>
              <button className="quiet-action" onClick={() => setAutoOffer(false)}>Keep it manual</button>
            </div>
          )}
        </>
      )}
      {toast && <div className="pad-x conn-status">{toast}</div>}
    </div>
  );
}
