import { useCallback, useEffect, useState } from "react";
import { Mail, Plus, Archive, CornerUpLeft, Forward } from "lucide-react";
import type { AIService } from "../ai/AIService";
import type { GmailMeta } from "../connections/google/map";
import { useGoogle } from "../connections/google/GoogleSession";
import { googleConfigured } from "../connections/google/config";
import {
  mapInboxMessage, mapGmailFull, buildReply, encodeEmail,
  type InboxRow, type MailFull,
} from "../connections/google/map";

type Draft = { to: string; subject: string; body: string; inReplyTo?: string; threadId?: string };
type DraftRow = { id: string; to: string; subject: string; snippet: string };
type View = "list" | "detail" | "compose";
type Filter = "all" | "unread" | "drafts";

const DEFAULT_REPLIES = ["Thanks", "Got it", "Will do"];

function header(msg: GmailMeta, name: string): string {
  const h = (msg.payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

// The Messages tab: real email (read, reply, forward, compose, send, archive,
// drafts, search, AI summaries and AI-suggested replies) through the shared
// Google session. Texts are not included: no app can read a phone's iMessage or
// SMS, so there is nothing honest to show.
export default function MessagesFlow({ ai, configured = googleConfigured() }: { ai: AIService; configured?: boolean }) {
  const g = useGoogle();
  const [view, setView] = useState<View>("list");
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<MailFull | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [replies, setReplies] = useState<string[]>(DEFAULT_REPLIES);
  const [draft, setDraft] = useState<Draft>({ to: "", subject: "", body: "" });
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadInbox = useCallback(async () => {
    const api = g.api();
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const metas = await api.listInbox(25);
      setRows(metas.map(mapInboxMessage).sort((a, b) => b.dateMs - a.dateMs));
    } catch (e) {
      setError((e as Error).message || "Could not load mail");
    } finally {
      setLoading(false);
    }
  }, [g]);

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
    if (g.hasToken) void loadInbox();
  }, [g.hasToken, loadInbox]);

  useEffect(() => {
    if (g.hasToken && filter === "drafts" && !draftsLoaded) void loadDrafts();
  }, [g.hasToken, filter, draftsLoaded, loadDrafts]);

  const connect = async () => {
    setError(null);
    try {
      await g.connect();
      await loadInbox();
    } catch (e) {
      setError((e as Error).message || "Could not connect");
    }
  };

  const open = async (id: string) => {
    const api = g.api();
    if (!api) return;
    setSummary(null);
    setReplies(DEFAULT_REPLIES);
    try {
      const full = mapGmailFull(await api.getMessage(id));
      setCurrent(full);
      setView("detail");
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, unread: false } : r)));
      api.modifyMessage(id, [], ["UNREAD"]).catch(() => {});
      if (ai.available && full.body) {
        try {
          const s = await ai.complete(
            [{ role: "user", content: "Summarize this email in one or two sentences:\n\n" + full.body.slice(0, 4000) }],
            "You are a concise assistant. Reply with only the summary.",
          );
          setSummary(s.trim());
        } catch { setSummary(null); }
        try {
          const raw = await ai.complete(
            [{ role: "user", content: "Suggest 3 short reply options to this email, each under 6 words. Return ONLY a JSON array of 3 strings.\n\n" + full.body.slice(0, 4000) }],
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
      setError((e as Error).message || "Could not open message");
    }
  };

  const archive = async (id: string) => {
    const api = g.api();
    if (!api) return;
    setRows((rs) => rs.filter((r) => r.id !== id));
    setView("list");
    api.modifyMessage(id, [], ["INBOX"]).catch(() => {});
  };

  const startReply = (m: MailFull) => {
    const r = buildReply(m, "");
    setEditingDraftId(null);
    setDraft({ to: r.to, subject: r.subject, body: r.body, inReplyTo: r.inReplyTo, threadId: r.threadId });
    setView("compose");
  };
  const startForward = (m: MailFull) => {
    setEditingDraftId(null);
    setDraft({ to: "", subject: /^fwd:/i.test(m.subject) ? m.subject : "Fwd: " + m.subject, body: "\n\n---------- Forwarded ----------\n" + m.body });
    setView("compose");
  };
  const startCompose = () => {
    setEditingDraftId(null);
    setDraft({ to: "", subject: "", body: "" });
    setView("compose");
  };
  const quickReply = (m: MailFull, text: string) => {
    const r = buildReply(m, text);
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
      const raw = encodeEmail({ to: draft.to.trim(), subject: draft.subject, body: draft.body, inReplyTo: draft.inReplyTo });
      await api.sendMessage(raw, draft.threadId);
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

  if (view === "list" && (!configured || !g.hasToken)) {
    return (
      <div className="screen">
        <div className="nav-bar"><div className="nav-large">Messages</div></div>
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
      <div className="screen">
        <div className="nav-bar">
          <button className="nav-back" onClick={() => setView(current && !editingDraftId ? "detail" : "list")}>Cancel</button>
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

  if (view === "detail" && current) {
    return (
      <div className="screen">
        <div className="nav-bar">
          <button className="nav-back" onClick={() => setView("list")}>Messages</button>
          <span className="nav-title"></span>
          <button className="nav-act" onClick={() => archive(current.id)} aria-label="Archive"><Archive className="ic" /></button>
        </div>
        <div className="pad-x">
          <div className="msg-detail-head">
            <div className="msg-detail-subj">{current.subject}</div>
            <div className="conn-meta">{current.from} &middot; {current.date}</div>
          </div>
          {summary && (
            <div className="card msg-summary">
              <div className="eyebrow">JARVIS summary</div>
              <div className="msg-summary-text">{summary}</div>
            </div>
          )}
          <div className="msg-body">{current.body}</div>
          <div className="msg-quick">
            {replies.map((q) => (
              <button key={q} className="chip" onClick={() => quickReply(current, q)}>{q}</button>
            ))}
          </div>
          <div className="msg-actions">
            <button className="btn btn-secondary" onClick={() => startReply(current)}><CornerUpLeft className="ic" /> Reply</button>
            <button className="btn btn-secondary" onClick={() => startForward(current)}><Forward className="ic" /> Forward</button>
          </div>
        </div>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const unreadCount = rows.filter((r) => r.unread).length;
  const inbox = (filter === "unread" ? rows.filter((r) => r.unread) : rows)
    .filter((r) => !q || r.from.toLowerCase().includes(q) || r.subject.toLowerCase().includes(q));
  const draftList = drafts.filter((d) => !q || d.to.toLowerCase().includes(q) || d.subject.toLowerCase().includes(q));

  return (
    <div className="screen">
      <div className="nav-bar">
        <div className="nav-large">Messages</div>
        <button className="nav-act" onClick={startCompose} aria-label="New message"><Plus className="ic" /></button>
      </div>
      <div className="pad-x">
        <input className="msg-input msg-search" placeholder="Search mail" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="pad-x msg-chips">
        <button className={"chip" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")}>All</button>
        <button className={"chip" + (filter === "unread" ? " on" : "")} onClick={() => setFilter("unread")}>
          Unread {unreadCount > 0 ? "(" + unreadCount + ")" : ""}
        </button>
        <button className={"chip" + (filter === "drafts" ? " on" : "")} onClick={() => setFilter("drafts")}>
          Drafts {draftsLoaded && drafts.length > 0 ? "(" + drafts.length + ")" : ""}
        </button>
      </div>
      {error && <div className="pad-x conn-error">{error}</div>}

      {filter === "drafts" ? (
        loading && !draftsLoaded ? (
          <div className="pad-x"><div className="card"><div className="empty-state"><div className="empty-title">Loading...</div></div></div></div>
        ) : draftList.length === 0 ? (
          <div className="pad-x"><div className="card"><div className="empty-state">
            <div className="empty-icon"><Mail className="ic" /></div>
            <div className="empty-title">No drafts</div>
          </div></div></div>
        ) : (
          <div className="pad-x"><div className="card">
            {draftList.map((d) => (
              <div className="row" role="button" tabIndex={0} key={d.id} onClick={() => openDraft(d.id)}>
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
      ) : inbox.length === 0 ? (
        <div className="pad-x"><div className="card"><div className="empty-state">
          <div className="empty-icon"><Mail className="ic" /></div>
          <div className="empty-title">{q ? "No matches" : filter === "unread" ? "No unread mail" : "Inbox empty"}</div>
        </div></div></div>
      ) : (
        <div className="pad-x"><div className="card">
          {inbox.map((r) => (
            <div className="row" role="button" tabIndex={0} key={r.id} onClick={() => open(r.id)}>
              {r.unread && <span className="msg-dot" aria-label="unread"></span>}
              <div className="row-grow">
                <div className={"conn-name" + (r.unread ? " msg-strong" : "")}>{r.from}</div>
                <div className="conn-meta">{r.subject}</div>
              </div>
            </div>
          ))}
        </div></div>
      )}
      {toast && <div className="pad-x conn-status">{toast}</div>}
    </div>
  );
}
