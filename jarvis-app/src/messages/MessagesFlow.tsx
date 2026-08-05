import { useCallback, useEffect, useRef, useState } from "react";
import { Mail, Plus, Archive, Trash2, CornerUpLeft, Forward } from "lucide-react";
import type { AIService } from "../ai/AIService";
import { useGoogle } from "../connections/google/GoogleSession";
import { googleConfigured } from "../connections/google/config";
import {
  mapThread, mapThreadFull, mapGmailFull, buildReply, encodeEmail,
  type ThreadRow, type ThreadFull, type MailFull,
} from "../connections/google/map";
import {
  loadTriageCache, saveTriageCache, triageDelta, buildTriageInput, parseTriage,
  fillSkipped, splitByBucket, headline, noiseLine, sortByDeadline, byRank, type TriageMap, type Bucket,
} from "./triage";
import { loadRules, saveRule, clearRule, applyRules, type SenderRules } from "./rules";
import DeckFlow from "./DeckFlow";
import MailSwipe from "./MailSwipe";
import { loadMuted, mute, unmute, dropMuted } from "./mute";
import { parseUnsub, unsubLabel, unsubLine, UNSUB_SUBJECT, UNSUB_BODY } from "./unsubscribe";
import { BRIEF_SYSTEM, briefPrompt, parseBrief, briefFor, saveBrief } from "./brief";
import { emit } from "../events";
import { usePushDepth } from "../shared/pushNav";
import { Burst } from "../shared/Burst";
import { useOptionalSession } from "../auth/AuthProvider";
import { findWaiting, waitingLine, nudgePrompt, type WaitingRow } from "./waiting";
import { loadTracks, saveTrack, trackForThread, newTrackId, pixelUrlFor, registerTrack, checkOpens } from "./tracking";
import { loadNetted, saveNetted, netCandidates, guardLine, seedFirstRun } from "./safetyNet";
import { cleanBody, isLong, leadIn, wordCount } from "./bodyText";
import { recordToss, markAsked, tossOffer, tossLine } from "./selfClean";
import { PRESETS, loadMinutes, saveMinutes, clampMinutes, drainReceipt } from "./drain";
import { handoffTargets, defaultNote, handoffPrompt, forwardSubject, handoffLine, type HandoffTarget } from "./handoff";
import { COMMITMENT_SYSTEM, commitmentPrompt, parseCommitment, alreadyPromised, markPromised, commitmentLine } from "./commitments";
import { laterTaskTitle } from "./deck";
import { noDashes } from "../ai/suggestions";
import { useOptionalTasks, useOptionalPeople } from "../data/NotesProvider";
import { b64urlDecodeBytes } from "../connections/google/map";

type Draft = { to: string; subject: string; body: string; inReplyTo?: string; threadId?: string; fromDeck?: boolean; account?: string; handoffTo?: string };
type DraftRow = { id: string; to: string; subject: string; snippet: string };
type View = "list" | "detail" | "compose" | "deck" | "dead" | "rules";
type Filter = "triage" | "all" | "drafts";
type TriageState = "idle" | "pending" | "ready" | "failed";

const AUTONOISE_KEY = "jarvis.mail.autonoise.v1";
// Small enough that one request is fast and well under the proxy's input cap.
const TRIAGE_BATCH = 12;
const TRIAGE_TIMEOUT_MS = 20000;

// A promise that cannot hang forever. Without this the calm pending screen has
// no exit, which is the exact failure it was built to prevent.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Sorting took too long.")), ms)),
  ]);
}
const BUCKET_LABEL: Record<Bucket, string> = { needs_you: "Needs You", worth_knowing: "Worth Knowing", noise: "Noise" };

function fmtDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? s + "s" : Math.floor(s / 60) + "m " + (s % 60) + "s";
}

// "bffsa.org" for work-style domains, "gmail" for the big ones: the shortest
// string that still tells the accounts apart.
function acctLabel(email: string): string {
  const domain = email.split("@")[1] || email;
  return /gmail|googlemail/.test(domain) ? "gmail" : domain;
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

// Email (rebuild, session Email 1): not an inbox, a status report. One AI
// pass buckets every thread (needs you / worth knowing / noise) with a gist,
// so junk is never opened. The headline counts what needs Dave, never unread.
// Threads are the unit throughout; search is server-side over the whole
// mailbox. Without AI the tab is an honest threaded list, no fake triage.
export default function MessagesFlow({ ai, configured = googleConfigured(), token }: { ai: AIService; configured?: boolean; token?: string }) {
  const g = useGoogle();
  const tasks = useOptionalTasks();
  const people = useOptionalPeople();
  const session = useOptionalSession();
  const authToken = token ?? session?.access_token;
  const [view, setView] = useState<View>("list");
  const [rows, setRows] = useState<ThreadRow[]>([]);
  const [triage, setTriage] = useState<TriageMap>({});
  const [triaged, setTriaged] = useState(false);
  // Never show the wall: For You has three honest states besides "ready".
  // The fallback for a failed sort is a calm screen with one way out, never
  // the raw list dumped back in Dave's face.
  const [triageState, setTriageState] = useState<TriageState>("idle");
  const [triageWhy, setTriageWhy] = useState<string>("");
  const [openBodies, setOpenBodies] = useState<Record<string, boolean>>({});
  const [restOpen, setRestOpen] = useState(false);
  const [toss, setToss] = useState<{ sender: string; n: number } | null>(null);
  // The drain. minutes is the user's number, remembered between runs.
  const [minutes, setMinutes] = useState<number>(() => loadMinutes());
  const [drainOpen, setDrainOpen] = useState(false);
  const [drainMs, setDrainMs] = useState<number | undefined>(undefined);
  // Hand off: null = closed, [] = open and loading the people list.
  const [handTargets, setHandTargets] = useState<HandoffTarget[] | null>(null);
  const [handing, setHanding] = useState(false);
  const [muted, setMuted] = useState<string[]>(() => loadMuted());
  // Undo: the last destructive action, and how to put it back. One deep, which
  // is all anyone ever uses, and it expires with the toast.
  const [undo, setUndo] = useState<{ label: string; run: () => void } | null>(null);
  const [netted, setNetted] = useState(0);
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
  const [waiting, setWaiting] = useState<(WaitingRow & { account?: string })[]>([]);
  const [opens, setOpens] = useState<Record<string, string>>({}); // threadId -> first-open ISO
  const [nudging, setNudging] = useState<string | null>(null);
  const [acctFilter, setAcctFilter] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  // No AI build: there is no For You chip at all, so the tab opens on All.
  const [filter, setFilter] = useState<Filter>(ai.available ? "triage" : "all");
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

  // Triage in SMALL BATCHES, each with a hard timeout, rendering as they land.
  //
  // The first version sent every thread in one request with no timeout. With a
  // real inbox that request is huge and slow, and if it never came back the
  // calm "Reading your inbox" screen sat there forever, a nicer looking wall
  // is still a wall. Now: 12 threads per request, 20s ceiling each, one silent
  // retry per batch, and the sorted view appears as soon as the FIRST batch
  // lands instead of waiting for the whole inbox.
  const runTriage = useCallback(async (threads: ThreadRow[]) => {
    if (!ai.available || triageBusy.current) return;
    const cache = loadTriageCache();
    const delta = triageDelta(threads, cache);
    if (delta.length === 0) {
      setTriage(cache);
      setTriaged(true);
      setTriageState("ready");
      return;
    }
    triageBusy.current = true;
    setTriageState((s) => (s === "ready" ? s : "pending"));
    let merged: TriageMap = { ...cache };
    let anyOk = false;
    let lastErr = "";
    try {
      for (let i = 0; i < delta.length; i += TRIAGE_BATCH) {
        const batch = delta.slice(i, i + TRIAGE_BATCH);
        let parsed = null;
        for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
          try {
            const raw = await withTimeout(
              ai.complete(
                [{ role: "user", content: buildTriageInput(batch) }],
                "You output only a JSON array, nothing else.",
              ),
              TRIAGE_TIMEOUT_MS,
            );
            parsed = parseTriage(raw, batch);
            if (!parsed) lastErr = "The sort came back unreadable.";
          } catch (e) {
            lastErr = ((e as Error)?.message || "").slice(0, 140);
          }
        }
        if (!parsed) continue; // this batch stays unsorted; the rest still sorts
        merged = fillSkipped({ ...merged, ...parsed }, batch);
        anyOk = true;
        // Render progress immediately: partial sorted beats a spinner.
        saveTriageCache(merged);
        setTriage(merged);
        setTriaged(true);
        setTriageState("ready");
      }
      if (!anyOk) {
        setTriageWhy(lastErr);
        setTriageState((s) => (s === "ready" ? s : "failed"));
        return;
      }
      // Anything a failed batch left behind is surfaced, never hidden.
      merged = fillSkipped(merged, delta);
      saveTriageCache(merged);
      setTriage(merged);
    } finally {
      triageBusy.current = false;
    }
  }, [ai]);

  const loadThreads = useCallback(async () => {
    const list = g.apis("mail");
    if (list.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      // One inbox across every account: each thread remembers which account
      // it lives in, and that account is where its reply will leave from.
      const perAccount = await Promise.all(list.map(async ({ email, api }) => {
        const metas = await api.listThreads(30).catch(() => []);
        return metas.map(mapThread)
          .filter((t): t is ThreadRow => t !== null && t.inInbox)
          .map((t) => ({ ...t, account: email }));
      }));
      const mapped = perAccount.flat().sort((a, b) => b.dateMs - a.dateMs);
      setRows(mapped);
      setTriage(loadTriageCache());
      void runTriage(mapped);
      void loadWaiting();
    } catch (e) {
      setError((e as Error).message || "Could not load mail");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, runTriage]);

  // Waiting On is a bonus layer: it loads after the inbox and fails to
  // nothing. Opens are looked up only for threads we actually tracked.
  const loadWaiting = async () => {
    try {
      const per = await Promise.all(g.apis("mail").map(async ({ email, api }) => {
        const rows = await findWaiting(api, Date.now()).catch(() => []);
        return rows.map((r) => ({ ...r, account: email }));
      }));
      const w = per.flat().sort((a, b) => b.waitingDays - a.waitingDays).slice(0, 5);
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
  const startNudge = async (row: WaitingRow & { account?: string }) => {
    const api = apiFor(row.account);
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
          body = noDashes((await ai.complete([{ role: "user", content: p.user }], p.system, { tier: "write" })).trim());
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
        account: (row as { account?: string }).account,
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

  // Nothing-slips net: anything that has needed Dave for 3+ days becomes a
  // task, exactly once. This is what earns the right to fold the rest away.
  useEffect(() => {
    if (!tasks || !triaged || rows.length === 0) return;
    const { needsYou: nagging } = splitByBucket(rows, applyRules(triage, rows, rules));
    // First ever pass on this inbox: absorb the backlog silently.
    if (seedFirstRun(nagging)) return;
    const already = loadNetted();
    const due = netCandidates(nagging, already, Date.now());
    if (due.length === 0) return;
    // Mark BEFORE the awaits: a failed createTask must not queue the same
    // thread up to be netted again on every render.
    saveNetted([...already, ...due.map((r) => r.id)]);
    setNetted((n) => n + due.length);
    void (async () => {
      for (const r of due) {
        await tasks
          .createTask(laterTaskTitle(r.from, r.subject), { due: new Date().toISOString().slice(0, 10) })
          .catch(() => {});
      }
      emit({ type: "action", props: { name: "email.net.caught", n: due.length } });
    })();
  }, [tasks, triaged, rows, triage, rules]);

  const connect = async () => {
    setError(null);
    try {
      await g.connect();
      await loadThreads();
    } catch (e) {
      setError((e as Error).message || "Could not connect");
    }
  };

  // The api for a specific account, falling back to any live one so legacy
  // single-account data (no account tag) keeps working.
  const apiFor = (account?: string) => (account ? g.api(account) : null) ?? g.api();
  const accountOfThread = (id: string) => rows.find((r) => r.id === id)?.account;

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
    const api = apiFor(accountOfThread(id));
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
      // ONE call for the summary and the replies, cached against the latest
      // message id. Reopening a thread costs nothing until someone writes.
      const lastId = full.messages[full.messages.length - 1]?.id || id;
      const cached = briefFor(lastId);
      if (cached) {
        setSummary(cached.summary || null);
        if (cached.replies.length) setReplies(cached.replies);
      } else if (ai.available) {
        const convo = full.messages.slice(-4).map((m) => m.from + ": " + cleanBody(m.body).slice(0, 1200)).join("\n---\n");
        if (convo.trim()) {
          try {
            const brief = parseBrief(await ai.complete([{ role: "user", content: briefPrompt(convo) }], BRIEF_SYSTEM));
            if (brief) {
              saveBrief(lastId, brief);
              setSummary(brief.summary || null);
              if (brief.replies.length) setReplies(brief.replies);
            }
          } catch { /* the thread still reads fine without either */ }
        }
      }
    } catch (e) {
      setError((e as Error).message || "Could not open conversation");
    }
  };

  // Attachments open in a new tab (or download when the browser can't render
  // the type). Bytes travel Gmail -> this device only, nothing is uploaded.
  const openAttachment = async (messageId: string, attachmentId: string, filename: string, mime: string) => {
    const api = apiFor(thread ? accountOfThread(thread.id) : undefined);
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
    const api = apiFor(accountOfThread(id));
    if (!api) return;
    // Self-cleaning: throwing a sender away UNREAD, repeatedly, is a decision.
    const row = rows.find((r) => r.id === id);
    if (row) setToss(tossOffer(recordToss(row.fromEmail, row.unread)));
    setRows((rs) => rs.filter((r) => r.id !== id));
    setResults((rs) => (rs ? rs.filter((r) => r.id !== id) : rs));
    setView("list");
    api.modifyThread(id, [], ["INBOX"]).catch(() => {});
  };

  // How many loaded threads share this sender. Only offered when it is more
  // than the one you are looking at, otherwise it is just Archive with extra
  // words.
  const sweepCount = (fromEmail: string) =>
    rows.filter((r) => r.fromEmail.toLowerCase() === fromEmail.toLowerCase()).length;

  const sweepSender = (fromEmail: string) => {
    const hit = rows.filter((r) => r.fromEmail.toLowerCase() === fromEmail.toLowerCase());
    if (hit.length === 0) return;
    setRows((rs) => rs.filter((r) => r.fromEmail.toLowerCase() !== fromEmail.toLowerCase()));
    setView("list");
    for (const r of hit) apiFor(r.account)?.modifyThread(r.id, [], ["INBOX"]).catch(() => {});
    say(hit.length + (hit.length === 1 ? " conversation archived" : " conversations archived"), {
      label: "Undo",
      run: () => {
        setRows((rs) => [...hit, ...rs].sort((a, b) => b.dateMs - a.dateMs));
        for (const r of hit) apiFor(r.account)?.modifyThread(r.id, ["INBOX"], []).catch(() => {});
      },
    });
  };

  // Unsubscribe using the sender's own header. mailto is sent (on this tap);
  // an http endpoint is opened, because only the sender's page can finish it.
  // The receipt never claims success: some senders ignore it.
  const doUnsub = async (t: ThreadFull) => {
    const m = lastMsg(t);
    const u = parseUnsub(m.listUnsubscribe, m.listUnsubscribePost);
    if (!u) return;
    if (u.kind === "mailto") {
      const api = apiFor(accountOfThread(t.id));
      if (!api) return;
      const raw = encodeEmail({ to: u.target, subject: u.subject || UNSUB_SUBJECT, body: UNSUB_BODY });
      await api.sendMessage(raw).catch(() => {});
    } else {
      window.open(u.target, "_blank", "noopener,noreferrer");
    }
    emit({ type: "action", props: { name: "email.unsubscribe", kind: u.kind } });
    setView("list");
    say(unsubLine(m.from));
  };

  // Archive from the list. Same effect as the detail-view archive, without
  // making him open something he already knows he is done with.
  // Every reversible action goes through here so the offer to undo is never
  // forgotten on one path and present on another.
  const say = (msg: string, undoable?: { label: string; run: () => void }, ms = 6000) => {
    setToast(msg);
    setUndo(undoable ?? null);
    setTimeout(() => { setToast(null); setUndo(null); }, ms);
  };

  const archiveRow = (r: ThreadRow) => {
    setToss(tossOffer(recordToss(r.fromEmail, r.unread)));
    setRows((rs) => rs.filter((x) => x.id !== r.id));
    setResults((rs) => (rs ? rs.filter((x) => x.id !== r.id) : rs));
    apiFor(r.account)?.modifyThread(r.id, [], ["INBOX"]).catch(() => {});
    say("Archived", { label: "Undo", run: () => {
      setRows((rs) => [r, ...rs.filter((x) => x.id !== r.id)].sort((a, b) => b.dateMs - a.dateMs));
      apiFor(r.account)?.modifyThread(r.id, ["INBOX"], []).catch(() => {});
    } });
  };

  // Delete goes to Gmail's Trash, recoverable for 30 days. The permanent
  // delete endpoint is never called from this app.
  const trashThread = (id: string, account?: string) => {
    const api = apiFor(account ?? accountOfThread(id));
    if (!api) return;
    setRows((rs) => rs.filter((r) => r.id !== id));
    setResults((rs) => (rs ? rs.filter((r) => r.id !== id) : rs));
    // Deleting the thread you are reading must not leave you reading it.
    setView("list");
    const gone = rows.find((r) => r.id === id);
    api.trashThread(id).catch(() => {});
    say("Deleted. It’s in Gmail’s trash for 30 days.", { label: "Undo", run: () => {
      if (gone) setRows((rs) => [gone, ...rs.filter((x) => x.id !== id)].sort((a, b) => b.dateMs - a.dateMs));
      api.untrashThread(id).catch(() => {});
    } });
  };

  const archiveAllNoise = (noise: ThreadRow[], manual = true) => {
    if (noise.length === 0) return;
    const ids = new Set(noise.map((r) => r.id));
    setRows((rs) => rs.filter((r) => !ids.has(r.id)));
    setNoiseOpen(false);
    let counts;
    for (const r of noise) {
      counts = recordToss(r.fromEmail, r.unread);
      apiFor(r.account)?.modifyThread(r.id, [], ["INBOX"]).catch(() => {});
    }
    if (counts) setToss(tossOffer(counts));
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
    setDraft({ to: r.to, subject: r.subject, body: r.body, inReplyTo: r.inReplyTo, threadId: r.threadId, account: accountOfThread(t.id) });
    setView("compose");
  };
  const startForward = (t: ThreadFull) => {
    const m = lastMsg(t);
    setEditingDraftId(null);
    setDraft({ to: "", subject: /^fwd:/i.test(m.subject) ? m.subject : "Fwd: " + m.subject, body: "\n\n---------- Forwarded ----------\n" + m.body, account: accountOfThread(t.id) });
    setView("compose");
  };
  // Hand off. Opens the people list; picking a person drafts the note and puts
  // it in compose, where he still has to tap Send. Delegation, one gesture,
  // zero surprises.
  const openHandoff = async () => {
    if (!people) return;
    setHandTargets([]);
    try {
      setHandTargets(handoffTargets(await people.list()));
    } catch {
      setHandTargets([]);
    }
  };

  const handOffTo = async (t: ThreadFull, target: HandoffTarget) => {
    if (handing) return;
    setHanding(true);
    try {
      const m = lastMsg(t);
      let note = defaultNote(target, t.subject);
      if (ai.available) {
        try {
          const p = handoffPrompt(target, t.subject, effTriage[t.id]?.gist || "");
          const written = noDashes((await ai.complete([{ role: "user", content: p.user }], p.system, { tier: "write" })).trim());
          if (written) note = written;
        } catch { /* the plain note is a fine note */ }
      }
      setEditingDraftId(null);
      setDraft({
        to: target.email,
        subject: forwardSubject(t.subject),
        body: note + "\n\n---------- Forwarded ----------\n" + cleanBody(m.body),
        account: accountOfThread(t.id),
        handoffTo: target.name,
      });
      setHandTargets(null);
      setView("compose");
    } finally {
      setHanding(false);
    }
  };

  const startCompose = () => {
    setEditingDraftId(null);
    setDraft({ to: "", subject: "", body: "" });
    setView("compose");
  };
  const quickReply = (t: ThreadFull, text: string) => {
    const r = buildReply(lastMsg(t), text);
    setEditingDraftId(null);
    setDraft({ to: r.to, subject: r.subject, body: text, inReplyTo: r.inReplyTo, threadId: r.threadId, account: accountOfThread(t.id) });
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
    const api = apiFor(draft.account);
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
      // Commitment catcher: if he just promised something, it becomes a task
      // with the date HE named. Once per thread, and never for a hand-off note
      // (the promise there is the other person's).
      const threadForPromise = draft.threadId || sent.threadId;
      if (tasks && ai.available && !draft.handoffTo && threadForPromise && !alreadyPromised(threadForPromise)) {
        const today = new Date().toISOString().slice(0, 10);
        void (async () => {
          try {
            const raw = await ai.complete(
              [{ role: "user", content: commitmentPrompt(draft.body, today) }],
              COMMITMENT_SYSTEM,
            );
            const c = parseCommitment(raw, today);
            if (!c) return;
            markPromised(threadForPromise);
            await tasks.createTask(c.text, { due: c.due ?? null });
            emit({ type: "action", props: { name: "email.commitment.caught" } });
            setToast(commitmentLine(c));
            setTimeout(() => setToast(null), 4000);
          } catch { /* a missed catch is silent; a wrong task is not */ }
        })();
      }
      if (draft.handoffTo) {
        // It is theirs now: out of the inbox, into Waiting On.
        const tid = draft.threadId || sent.threadId;
        if (tid) {
          setRows((rs) => rs.filter((r) => r.id !== tid));
          apiFor(draft.account)?.modifyThread(tid, [], ["INBOX"]).catch(() => {});
        }
        void loadWaiting();
        emit({ type: "action", props: { name: "email.handoff" } });
        setToast(handoffLine(draft.handoffTo));
      } else {
        setToast("Sent");
      }
      setView("list");
      setTimeout(() => setToast(null), draft.handoffTo ? 3000 : 2000);
    } catch (e) {
      setError((e as Error).message || "Could not send");
    } finally {
      setSending(false);
    }
  };

  const pushCls = usePushDepth(view === "compose" ? 2 : view === "detail" || view === "deck" ? 1 : 0);

  // Muted threads never surface, however many replies land. The mail itself is
  // untouched in Gmail.
  const unmutedRows = dropMuted(rows, muted);
  const visibleRows = acctFilter ? unmutedRows.filter((r) => r.account === acctFilter) : unmutedRows;
  const effTriage = applyRules(triage, rows, rules);

  if (view === "deck") {
    if (!g.hasToken || !deckRows || deckRows.length === 0) { setView("list"); return null; }
    return (
      <div className={"screen " + pushCls} key="deck">
        <DeckFlow
          ai={ai}
          apiFor={apiFor}
          threads={deckRows}
          limitMs={drainMs}
          token={authToken}
          onExit={() => { setDeckRows(null); setDrainMs(undefined); setView("list"); }}
          onDone={(n, ms) => { setDeckRows(null); setDrainMs(undefined); setDeadStats({ n, ms }); setView("dead"); }}
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
          <div className="empty-sub">
            {deadStats.ms % 60000 === 0 && deadStats.ms >= 60000
              ? drainReceipt(deadStats.n, deadStats.ms / 60000)
              : deadStats.n + " handled in " + fmtDuration(deadStats.ms)}
          </div>
        </div></div></div>
        <div className="pad-x conn-action">
          <button className="btn btn-secondary btn-block" onClick={() => { setDeadStats(null); setView("list"); }}>Back to Email</button>
        </div>
      </div>
    );
  }

  // Every standing decision, in one place, each one undoable. A rule that is
  // permanent and invisible is not a rule, it is a haunting.
  if (view === "rules") {
    const filed = Object.entries(rules);
    return (
      <div className={"screen " + pushCls} key="rules">
        <div className="nav-bar"><button className="nav-back" onClick={() => setView("list")}>Email</button>
          <span className="nav-title">Standing Rules</span><span className="nav-action"></span></div>
        <div className="grp"><div className="eyebrow">Senders You Filed</div></div>
        <div className="pad-x"><div className="card">
          {filed.length === 0 ? (
            <div className="row"><div className="row-grow"><div className="conn-meta">Nothing filed yet.</div></div></div>
          ) : filed.map(([sender, bucket]) => (
            <div className="row" key={sender}>
              <div className="row-grow">
                <div className="line-between">
                  <span className="conn-name truncate">{sender}</span>
                  <span className="conn-meta">{BUCKET_LABEL[bucket]}</span>
                </div>
              </div>
              <button className="quiet-action" onClick={() => setRules(clearRule(sender))}>Undo</button>
            </div>
          ))}
        </div></div>
        <div className="grp"><div className="eyebrow">Muted Threads</div></div>
        <div className="pad-x"><div className="card">
          {muted.length === 0 ? (
            <div className="row"><div className="row-grow"><div className="conn-meta">Nothing muted.</div></div></div>
          ) : muted.map((id) => {
            const r = rows.find((x) => x.id === id);
            return (
              <div className="row" key={id}>
                <div className="row-grow"><div className="conn-name truncate">{r ? r.subject : "A thread"}</div></div>
                <button className="quiet-action" onClick={() => setMuted(unmute(id))}>Unmute</button>
              </div>
            );
          })}
        </div></div>
        {autoNoise && (
          <div className="pad-x conn-action">
            <button className="btn btn-secondary btn-block" onClick={() => {
              try { localStorage.removeItem(AUTONOISE_KEY); } catch { /* ignore */ }
              setAutoNoise(false);
              say("Noise stays until you clear it.");
            }}>Stop clearing noise automatically</button>
          </div>
        )}
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
          <button className="nav-action" onClick={send} disabled={sending}>{sending ? "..." : "Send"}</button>
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
          <div className="nav-actions">
            <button onClick={() => trashThread(thread.id)} aria-label="Delete"><Trash2 className="ic" /></button>
            <button onClick={() => archiveThread(thread.id)} aria-label="Archive"><Archive className="ic" /></button>
          </div>
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
          {thread.messages.map((m) => {
            // No text walls: strip the plumbing, and fold anything long behind
            // one tap. The words are never altered, only what is shown first.
            const clean = cleanBody(m.body);
            const long = isLong(clean);
            const open = openBodies[m.id] === true;
            return (
            <div className="msg-turn" key={m.id}>
              <div className="msg-turn-head">
                <span className="msg-turn-from">{m.from}</span>
                <span className="conn-meta">{m.date}</span>
              </div>
              <div className="msg-body">{long && !open ? leadIn(clean) : clean}</div>
              {long && (
                <button
                  className="quiet-action msg-more"
                  onClick={() => setOpenBodies((o) => ({ ...o, [m.id]: !open }))}
                >
                  {open ? "Fold it back" : "Read the whole thing · " + wordCount(clean) + " words"}
                </button>
              )}
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
            );
          })}
          <div className="msg-quick">
            {replies.map((q) => (
              <button key={q} className="chip" onClick={() => quickReply(thread, q)}>{q}</button>
            ))}
          </div>
          <div className="msg-actions">
            <button className="btn btn-secondary" onClick={() => startReply(thread)}><CornerUpLeft className="ic" /> Reply</button>
            <button className="btn btn-secondary" onClick={() => startForward(thread)}><Forward className="ic" /> Forward</button>
          </div>
          {/* Mute, sweep, unsubscribe: the three ways to make a sender stop
              costing you attention, strongest last. */}
          <div className="msg-quiet-acts">
            <button className="quiet-action" onClick={() => {
              setMuted(mute(thread.id));
              setView("list");
              say("Muted. It won’t come back here.", { label: "Undo", run: () => setMuted(unmute(thread.id)) });
            }}>Mute this thread</button>
            {sweepCount(lastMsg(thread).fromEmail) > 1 && (
              <button className="quiet-action" onClick={() => sweepSender(lastMsg(thread).fromEmail)}>
                Archive all {sweepCount(lastMsg(thread).fromEmail)} from {lastMsg(thread).from}
              </button>
            )}
            {parseUnsub(lastMsg(thread).listUnsubscribe, lastMsg(thread).listUnsubscribePost) && (
              <button className="quiet-action" onClick={() => void doUnsub(thread)}>
                {unsubLabel(lastMsg(thread).from)}
              </button>
            )}
          </div>

          {/* Hand off: one gesture for "this is not mine". */}
          {people && handTargets === null && (
            <button className="btn btn-secondary btn-block msg-hand" onClick={() => void openHandoff()}>
              <Forward className="ic" /> Hand this to someone
            </button>
          )}
          {handTargets !== null && (
            <div className="msg-hand-pick">
              <div className="eyebrow">Hand This To</div>
              <div className="card">
                {handTargets.length === 0 ? (
                  <div className="row"><div className="row-grow">
                    <div className="conn-meta">Nobody in People has an email address yet.</div>
                  </div></div>
                ) : handTargets.map((t) => (
                  <div className="row" role="button" tabIndex={0} key={t.email}
                    onClick={() => void handOffTo(thread, t)}>
                    <div className="row-grow">
                      <div className="line-between">
                        <span className="conn-name">{t.name}</span>
                        {t.relationship && <span className="conn-meta">{t.relationship}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button className="quiet-action" onClick={() => setHandTargets(null)}>
                {handing ? "Writing the note..." : "Never mind"}
              </button>
            </div>
          )}
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
  const split = splitByBucket(visibleRows, effTriage);
  // Real deadlines: Needs You is ordered by when the sender said they need it.
  const needsYou = sortByDeadline(split.needsYou, effTriage);
  const { worthKnowing, noise } = split;
  // For You is a promise: it either shows sorted mail or it shows a calm
  // state. It never falls through to the wall.
  const forYou = filter === "triage" && results === null && ai.available;
  const showTriage = forYou && triaged;
  const restCount = worthKnowing.length + noise.length;
  const listRows = results !== null ? results : visibleRows;

  // A triaged row shows the gist and NOTHING else: the thread count is inbox
  // bookkeeping, and bookkeeping is exactly what the fold is removing.
  const threadRow = (r: ThreadRow, gist?: string) => (
    <MailSwipe
      key={r.id}
      onArchive={() => archiveRow(r)}
      onDelete={() => trashThread(r.id, r.account)}
    >
    <div className="row" role="button" tabIndex={0} onClick={() => void openThread(r.id)}>
      {r.unread && <span className="msg-dot" aria-label="unread"></span>}
      <div className="row-grow">
        <div className="msg-line">
          <span className={"conn-name truncate" + (r.unread ? " msg-strong" : "")}>{r.from}</span>
          {effTriage[r.id]?.by
            ? <span className={"msg-due" + (byRank(effTriage[r.id]!.by) >= 900 ? " soft" : "")}>{effTriage[r.id]!.by}</span>
            : <span className="msg-when">{fmtWhen(r.dateMs)}</span>}
        </div>
        <div className="conn-meta msg-gist">
          {gist ?? r.subject}{!gist && r.count > 1 ? " · " + r.count : ""}
          {g.accounts.length > 1 && r.account && <span className="msg-acct">{acctLabel(r.account)}</span>}
        </div>
      </div>
    </div>
    </MailSwipe>
  );

  return (
    <div className={"screen " + pushCls} key="list">
      <div className="nav-bar">
        <div className="nav-large">Email</div>
        <button className="nav-action" onClick={startCompose} aria-label="New message"><Plus className="ic" /></button>
      </div>
      {showTriage && <div className="pad-x msg-headline">{headline(needsYou.length, visibleRows.length)}</div>}
      {showTriage && needsYou.length > 0 && (
        <div className="pad-x deck-cta">
          <button className="btn btn-primary btn-block" onClick={() => { setDeckRows(needsYou); setView("deck"); }}>
            Deal With It · {needsYou.length}
          </button>
          {/* The drain: he picks the number, always. */}
          {!drainOpen ? (
            <button className="quiet-action" onClick={() => setDrainOpen(true)}>Only have a few minutes?</button>
          ) : (
            <div className="drain-pick">
              <div className="eyebrow">Give Me</div>
              <div className="msg-chips">
                {PRESETS.map((m) => (
                  <button key={m} className={"chip" + (minutes === m ? " on" : "")}
                    onClick={() => setMinutes(saveMinutes(m))}>{m} min</button>
                ))}
                <input
                  className="msg-input drain-input" type="number" min={1} max={60} value={minutes}
                  aria-label="Minutes"
                  onChange={(e) => setMinutes(clampMinutes(parseInt(e.target.value, 10)))}
                  onBlur={() => setMinutes(saveMinutes(minutes))}
                />
              </div>
              <button className="btn btn-secondary btn-block" onClick={() => {
                saveMinutes(minutes);
                setDrainMs(minutes * 60000);
                setDeckRows(needsYou);
                setDrainOpen(false);
                setView("deck");
              }}>Start the drain</button>
            </div>
          )}
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
      {g.accounts.length > 1 && (
        <div className="pad-x msg-chips">
          <button className={"chip" + (acctFilter === null ? " on" : "")} onClick={() => setAcctFilter(null)}>All Accounts</button>
          {g.accounts.filter((a) => a.mail).map((a) => (
            <button key={a.email} className={"chip" + (acctFilter === a.email ? " on" : "")} onClick={() => setAcctFilter(a.email)}>
              {acctLabel(a.email)}
            </button>
          ))}
        </div>
      )}
      <div className="pad-x msg-chips">
        {ai.available && (
          <button className={"chip" + (filter === "triage" ? " on" : "")} onClick={() => setFilter("triage")}>For You</button>
        )}
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
      ) : forYou && !triaged ? (
        // The two calm states. Neither one ever shows unsorted mail.
        triageState === "failed" ? (
          <div className="pad-x"><div className="card"><div className="empty-state">
            <div className="empty-icon"><Mail className="ic" /></div>
            <div className="empty-title">Couldn’t sort your mail</div>
            <div className="empty-sub">It’s all still here, nothing was lost.</div>
            {triageWhy && <div className="msg-guard">{triageWhy}</div>}
            <div className="conn-action">
              <button className="btn btn-secondary btn-block" onClick={() => setFilter("all")}>Show All Mail</button>
            </div>
          </div></div></div>
        ) : (
          <div className="pad-x"><div className="card"><div className="empty-state">
            <div className="empty-icon"><Mail className="ic" /></div>
            <div className="empty-title">Reading your inbox</div>
            <div className="empty-sub">Sorting out what actually needs you.</div>
            {/* Never trapped: the way out is on screen the whole time. */}
            <button className="quiet-action" onClick={() => setFilter("all")}>Show all mail instead</button>
          </div></div></div>
        )
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
                      <div className="conn-meta msg-gist">
                        {w.subject} · {waitingLine(w, opens[w.threadId] ?? null)}
                        {g.accounts.length > 1 && w.account && <span className="msg-acct">{acctLabel(w.account)}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div></div>
            </>
          )}
          {/* THE FOLD. Everything that does not need Dave collapses to one
              line. Worth Knowing and Noise live behind it and expand in
              place, so the tab is never a scroll of mail he did not ask for. */}
          {restCount > 0 && (
            <div className="pad-x msg-fold">
              <div className="card">
                <div className="row" role="button" tabIndex={0} onClick={() => setRestOpen(!restOpen)}>
                  <div className="row-grow">
                    <div className="conn-name">The rest · {restCount}</div>
                    <div className="conn-meta msg-gist">
                      {restOpen ? "Tap to fold away" : "Nothing here is waiting on you"}
                    </div>
                  </div>
                </div>
                {restOpen && (
                  <>
                    {worthKnowing.length > 0 && (
                      <>
                        <div className="msg-fold-head">Worth Knowing</div>
                        {worthKnowing.map((r) => threadRow(r, effTriage[r.id]?.gist))}
                      </>
                    )}
                    {noise.length > 0 && (
                      <>
                        <div className="msg-fold-head">
                          Noise
                          <button className="see-all" onClick={() => archiveAllNoise(noise)}>Archive All</button>
                        </div>
                        <div className="row" role="button" tabIndex={0} onClick={() => setNoiseOpen(!noiseOpen)}>
                          <div className="row-grow">
                            <div className="conn-name">{noise.length === 1 ? "1 automated email" : noise.length + " automated emails"}</div>
                            <div className="conn-meta msg-gist">{noiseLine(noise)}</div>
                          </div>
                        </div>
                        {noiseOpen && noise.map((r) => threadRow(r, effTriage[r.id]?.gist))}
                      </>
                    )}
                  </>
                )}
              </div>
              {/* The guard line: proof that folding is safe, derived or absent. */}
              {netted > 0 && <div className="msg-guard">{guardLine(netted)}</div>}
            </div>
          )}
          {restCount === 0 && netted > 0 && <div className="pad-x msg-guard">{guardLine(netted)}</div>}
          {/* ONE offer at a time. Three stacked offers is a form, and the law
              is one line, one action, one quiet dismiss. Self-cleaning wins
              because it ends a sender for good. */}
          {toss ? (
            <div className="pad-x offer-row">
              <div className="card"><div className="row"><div className="row-grow">
                <div className="conn-meta msg-offer-line">{tossLine(toss.sender, toss.n)}</div>
              </div></div></div>
              <button
                className="btn btn-primary btn-block"
                onClick={() => {
                  setRules(saveRule(toss.sender, "noise"));
                  markAsked(toss.sender);
                  setToss(null);
                  setToast("Done. They go straight to Noise from now on.");
                  setTimeout(() => setToast(null), 2500);
                }}
              >Yes, file them</button>
              <button className="quiet-action" onClick={() => { markAsked(toss.sender); setToss(null); }}>No thanks</button>
            </div>
          ) : autoOffer ? (
            <div className="pad-x offer-row">
              <button className="btn btn-secondary btn-block" onClick={enableAutoNoise}>Clear Noise Automatically From Now On</button>
              <button className="quiet-action" onClick={() => setAutoOffer(false)}>Keep it manual</button>
            </div>
          ) : null}
        </>
      )}
      {toast && (
        <div className="pad-x conn-status msg-toast">
          <span>{toast}</span>
          {undo && (
            <button className="quiet-action msg-undo" onClick={() => { undo.run(); setUndo(null); setToast(null); }}>
              {undo.label}
            </button>
          )}
        </div>
      )}
      {/* The standing rules live one tap from the tab that creates them. */}
      {(Object.keys(rules).length > 0 || muted.length > 0) && (
        <div className="pad-x"><button className="quiet-action" onClick={() => setView("rules")}>Standing Rules</button></div>
      )}
    </div>
  );
}
