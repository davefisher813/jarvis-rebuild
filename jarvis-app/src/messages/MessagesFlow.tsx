import { useCallback, useEffect, useState } from "react";
import { Mail, Plus, Archive, CornerUpLeft, Forward } from "lucide-react";
import type { AIService } from "../ai/AIService";
import { useGoogle } from "../connections/google/GoogleSession";
import { googleConfigured } from "../connections/google/config";
import {
  mapInboxMessage, mapGmailFull, buildReply, encodeEmail,
  type InboxRow, type MailFull,
} from "../connections/google/map";

type Draft = { to: string; subject: string; body: string; inReplyTo?: string; threadId?: string };
type View = "list" | "detail" | "compose";

// The Messages tab: real email (read, reply, forward, compose, send, archive)
// through the shared Google session. Texts are not included: no app can read a
// phone's iMessage or SMS, so there is nothing honest to show.
export default function MessagesFlow({ ai, configured = googleConfigured() }: { ai: AIService; configured?: boolean }) {
  const g = useGoogle();
  const [view, setView] = useState<View>("list");
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<MailFull | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ to: "", subject: "", body: "" });
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

  useEffect(() => {
    if (g.hasToken) void loadInbox();
  }, [g.hasToken, loadInbox]);

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
        } catch {
          setSummary(null);
        }
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
    setDraft({ to: r.to, subject: r.subject, body: r.body, inReplyTo: r.inReplyTo, threadId: r.threadId });
    setView("compose");
  };
  const startForward = (m: MailFull) => {
    setDraft({ to: "", subject: /^fwd:/i.test(m.subject) ? m.subject : "Fwd: " + m.subject, body: "\n\n---------- Forwarded ----------\n" + m.body });
    setView("compose");
  };
  const startCompose = () => {
    setDraft({ to: "", subject: "", body: "" });
    setView("compose");
  };
  const quickReply = (m: MailFull, text: string) => {
    const r = buildReply(m, text);
    setDraft({ to: r.to, subject: r.subject, body: text, inReplyTo: r.inReplyTo, threadId: r.threadId });
    setView("compose");
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
          <button className="nav-back" onClick={() => setView(current ? "detail" : "list")}>Cancel</button>
          <span className="nav-title">New message</span>
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
            {["Thanks", "Got it", "Will do"].map((q) => (
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

  const shown = filter === "unread" ? rows.filter((r) => r.unread) : rows;
  return (
    <div className="screen">
      <div className="nav-bar">
        <div className="nav-large">Messages</div>
        <button className="nav-act" onClick={startCompose} aria-label="New message"><Plus className="ic" /></button>
      </div>
      <div className="pad-x msg-chips">
        <button className={"chip" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")}>All</button>
        <button className={"chip" + (filter === "unread" ? " on" : "")} onClick={() => setFilter("unread")}>
          Unread {rows.filter((r) => r.unread).length > 0 ? "(" + rows.filter((r) => r.unread).length + ")" : ""}
        </button>
      </div>
      {error && <div className="pad-x conn-error">{error}</div>}
      {loading && rows.length === 0 ? (
        <div className="pad-x"><div className="card"><div className="empty-state"><div className="empty-title">Loading...</div></div></div></div>
      ) : shown.length === 0 ? (
        <div className="pad-x"><div className="card"><div className="empty-state">
          <div className="empty-icon"><Mail className="ic" /></div>
          <div className="empty-title">{filter === "unread" ? "No unread mail" : "Inbox empty"}</div>
        </div></div></div>
      ) : (
        <div className="pad-x"><div className="card">
          {shown.map((r) => (
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
