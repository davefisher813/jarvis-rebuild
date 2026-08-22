import { useCallback, useEffect, useRef, useState, lazy, Suspense } from "react";
import PageHeader, { BarAction } from "../shared/PageHeader";
import { Mail, Plus, Archive, Trash2, CornerUpLeft, Forward, Send } from "lucide-react";
import type { AIService } from "../ai/AIService";
import { useGoogle } from "../connections/google/GoogleSession";

import { googleConfigured } from "../connections/google/config";
import {
  mapThread, mapThreadFull, mapGmailFull, buildReply, encodeEmail,
  type ThreadRow, type ThreadFull, type MailFull,
} from "../connections/google/map";
import { selfBlankGuard,
  loadTriageCache, saveTriageCache, triageDelta, buildTriageInput, parseTriage, TRIAGE_SCHEMA,
  fillSkipped, splitByBucket, noiseLine, sortByDeadline, byRank, type TriageMap, type Bucket,
} from "./triage";
import { loadRules, saveRule, clearRule, applyRules, type SenderRules } from "./rules";
import DeckFlow from "./DeckFlow";
import MailSwipe from "./MailSwipe";
import LetGoSwipe from "./LetGoSwipe";
import { loadMuted, mute, unmute, dropMuted } from "./mute";
import { parseUnsub, unsubLabel, unsubLine, UNSUB_SUBJECT, UNSUB_BODY, type Unsub } from "./unsubscribe";
import { BRIEF_SYSTEM, briefPrompt, parseBrief, briefFor, saveBrief } from "./brief";
import { emit } from "../events";
import { usePushDepth } from "../shared/pushNav";
import { Burst } from "../shared/Burst";
import { useOptionalSession } from "../auth/AuthProvider";
import { findWaiting, waitingLine, nudgePrompt, type WaitingRow } from "./waiting";
import { loadTracks, saveTrack, trackForThread, newTrackId, pixelUrlFor, registerTrack, checkOpens } from "./tracking";
import { loadNetted, saveNetted, netCandidates, guardLine, seedFirstRun } from "./safetyNet";
import { madeBy } from "../shared/provenance";
import { effectiveLevel } from "../ai/aiGate";
import { getAIControl } from "../ai/levelStore";
import { cleanBody, isLong, leadIn, wordCount } from "./bodyText";
import { recordToss, markAsked, tossOffer, tossLine, loadTossed, loadAsked } from "./selfClean";
import { sweepCandidates, sweepTitle, sweepSub, sweepReceipt, type SweepCandidate } from "./unsubSweep";
import { PRESETS, loadMinutes, saveMinutes, clampMinutes, drainReceipt } from "./drain";
import { handoffTargets, defaultNote, handoffPrompt, forwardSubject, handoffLine, type HandoffTarget } from "./handoff";
import { COMMITMENT_SYSTEM, commitmentPrompt, parseCommitment, alreadyPromised, markPromised, commitmentLine, loadPromised } from "./commitments";
import { saveMailSnapshot, mailNotices, loadMailSnapshot, type MailMeeting } from "./home";
import { inboxSentence } from "./inboxBrief";
import { dueChases, loadChases, clearChase, setChase, CHASE_DAYS, CHASE_DEFAULT } from "./followUp";
import { loadVips, toggleVip, isVip, applyVips } from "./vip";
import { collapseNoise, collapseLine } from "./collapse";
import { loadNudgeCounts, countNudge } from "./escalate";
import { decide, type Decision, type MailAction } from "./mailAction";
import MailMoreSheet from "./MailMoreSheet";
import { phoneBook, phoneFor, telLink, smsLink, colleagueBook, altFor, firstName,
  type PhoneBook, type Colleague } from "./reachBy";
import { loadLetGo, letGo, undoLetGo } from "./letGo";
import { closeCandidates, closeLine, closeReceipt, closeDue, markClosed, lastClose } from "./weeklyClose";
import { speakable, canSpeak, speak, stopSpeaking } from "./readAloud";
import { attachOffer, amountIn } from "./attachmentKind";
import { HOLD_SECONDS } from "./outbox";
import { loadWindows, saveWindows, isOpenNow, closedLine, type WindowSettings } from "./batching";
import WindowsSheet from "./WindowsSheet";
import { loadLinks, linkThread, type LinkMap } from "./threadLink";
import { saidQuery, saidPrompt, parseSaid, saidEmpty, SAID_SYSTEM } from "./saidWhat";
import { shouldAutoReply, autoReplyBody, loadAutoState, markAutoReplied, AUTO_REPLY_EXPLAINER } from "./autoReply";
import { protectedRangesFor, isFocusRange } from "../routine/types";
import { fmtTime, todayISO, addDays, eventsForDate } from "../schedule/calendar";
import { nextOpening, BOOK_MIN } from "./bookTime";

const AUTOREPLY_KEY = "jarvis.mail.autoreply.on.v1";
import { suggestAttachment, suggestLine, type AttachSuggestion, type Candidate } from "./attachSuggest";
import { staleDrafts, staleLine, loadOffered } from "./staleDrafts";
import { mightProposeTimes, meetingPrompt, parseMeetingTimes, optionsAgainst, firstFree, meetingLine, MEETING_SYSTEM } from "./meetingTimes";
import { sweepPrompt, parseSweep, needsSweep, liveSweep, loadSweep, saveSweep, SWEEP_SYSTEM, type SentItem } from "./sentSweep";
import { laterTaskTitle } from "./deck";

// Demo fixtures never reach a real build (see vite.config.ts). The constant
// has to guard the IMPORT, not just the render: a lazy import that is always
// constructed still emits a fetchable chunk, so the fixtures would sit on the
// server for anyone who knew the filename.
const DemoMail = __DEMO_SEED__ ? lazy(() => import("./DemoMail")) : null;
import { noDashes } from "../ai/suggestions";
import { useOptionalAIContext } from "../ai/useAIContext";
import { voiceToText } from "../ai/context";
import { useOptionalTasks, useOptionalSchedule, useOptionalPeople, useOptionalProfile, useOptionalNotes, useOptionalProjects, useOptionalRoutine } from "../data/NotesProvider";
import { b64urlDecodeBytes } from "../connections/google/map";
import { capAfterNumber } from "../shared/casing";

type Draft = { to: string; subject: string; body: string; inReplyTo?: string; threadId?: string; fromDeck?: boolean; account?: string; handoffTo?: string };
type DraftRow = { id: string; to: string; subject: string; snippet: string; dateMs?: number; threadId?: string };
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
// Transport quotes around display names ("Marcus Delaney") are wire
// format, not UI. Strip them everywhere a sender renders (V4 email pass).
const displayName = (n: string) => n.replace(/^"+|"+$/g, "").trim();

const BUCKET_LABEL: Record<Bucket, string> = { needs_you: "Needs You", worth_knowing: "Worth Knowing", noise: "Noise" };

function fmtDuration(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? s + "s" : Math.floor(s / 60) + "m " + (s % 60) + "s";
}

// "northlake.org" for work-style domains, "gmail" for the big ones: the shortest
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
export default function MessagesFlow({ ai, configured = googleConfigured(), token, onOpenConnections , demoMail = false, openThreadId }: { demoMail?: boolean; ai: AIService; configured?: boolean; token?: string; onOpenConnections?: () => void; openThreadId?: string }) {
  const g = useGoogle();
  const tasks = useOptionalTasks();
  const scheduleSvc = useOptionalSchedule();
  const notesSvc = useOptionalNotes();
  const projectsSvc = useOptionalProjects();
  const routineSvc = useOptionalRoutine();
  const people = useOptionalPeople();
  const session = useOptionalSession();
  // Phase 3: anything drafted here goes out over the user's name, so it gets
  // their voice and the people guardrail. Optional on purpose, matching the
  // Optional task and people services above: this tab renders without
  // NotesProvider, and a missing context means a plain prompt, never a crash.
  const gatherContext = useOptionalAIContext();
  const voiceText = useCallback(
    () => gatherContext().then((c) => (c ? voiceToText(c) : "")).catch(() => ""),
    [gatherContext],
  );
  const authToken = token ?? session?.access_token;
  // Open tracking is a setting now (2026-08-09), not a constant. Loaded once;
  // missing provider or profile means the default (on), matching history.
  const profileSvc = useOptionalProfile();
  const [trackOpens, setTrackOpens] = useState(true);
  useEffect(() => {
    let on = true;
    profileSvc?.get().then((p) => { if (on) setTrackOpens(p?.trackOpens !== false); }).catch(() => {});
    return () => { on = false; };
  }, [profileSvc]);
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
  // Bumps when the promise sweep finishes, so the home snapshot picks it up.
  const [sweepTick, setSweepTick] = useState(0);
  // N1: meetings with at least one open slot, found by one gated AI pass.
  const [meetings, setMeetings] = useState<MailMeeting[]>([]);
  const [vips, setVips] = useState<string[]>(() => loadVips());
  const [noiseGroups, setNoiseGroups] = useState<Record<string, boolean>>({});
  const [closeDone, setCloseDone] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [attachDone, setAttachDone] = useState(false);
  const [nudgeCounts, setNudgeCounts] = useState<Record<string, number>>(() => loadNudgeCounts());
  const [chaseDays, setChaseDays] = useState<number>(CHASE_DEFAULT);
  // N15: what he actually owns, by name. Loaded once when compose opens, so
  // the suggestion can only ever point at a real file.
  const [myFiles, setMyFiles] = useState<Candidate[]>([]);
  // N9: senders he has repeatedly binned unread, with whether they published
  // a machine-readable way to stop. Computed when the inbox loads.
  const [sweep, setSweep] = useState<SweepCandidate[]>([]);
  const [unsubbable, setUnsubbable] = useState<Record<string, Unsub>>({});
  const [links, setLinks] = useState<LinkMap>(() => loadLinks());
  const [projects, setProjects] = useState<{ id: string; title: string; category?: string }[]>([]);
  const [said, setSaid] = useState<{ quote: string; dateISO: string; subject: string; threadId: string }[] | null>(null);
  const [saidBusy, setSaidBusy] = useState(false);
  // N8: the ONLY thing in this app that sends without a tap, so it is opt-in,
  // per-device, and off until he says otherwise.
  const [autoReplyOn, setAutoReplyOn] = useState<boolean>(() => {
    try { return localStorage.getItem(AUTOREPLY_KEY) === "on"; } catch { return false; }
  });
  const [opens, setOpens] = useState<Record<string, string>>({}); // threadId -> first-open ISO
  // Phones for the people who owe replies, so the top rung can actually dial
  // instead of promising a call and opening a compose window.
  const [book, setBook] = useState<PhoneBook>({ byEmail: {}, byName: {} });
  // Who ELSE we know at the same organisation. Fifty-three days of silence
  // from one address is not fifty-three days of silence from the company,
  // and routing around a quiet person is the move no other mail app can
  // offer because no other mail app knows your people.
  const [colleagues, setColleagues] = useState<Record<string, Colleague[]>>({});
  // The rest of the moves for one Waiting On row, opened from its swipe.
  const [more, setMore] = useState<{ row: WaitingRow & { account?: string }; d: Decision } | null>(null);
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
  // calm "Reading Your Inbox" screen sat there forever, a nicer looking wall
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
                { kind: "triage", schema: TRIAGE_SCHEMA },
              ),
              TRIAGE_TIMEOUT_MS,
            );
            parsed = parseTriage(raw, batch);
            if (!parsed) lastErr = "Sort came back unreadable";
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
      void runSweep();
      void findMeetings(splitByBucket(mapped, loadTriageCache()).needsYou);
    } catch (e) {
      setError((e as Error).message || "Could not load mail");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, runTriage]);

  // PICK A TIME, FROM THE REAL CALENDAR (N1, 2026-08-20).
  //
  // An email proposing times is three decisions wearing a hat: read the
  // options, remember your week, pick one, write back, remember to put it in.
  // JARVIS owns the calendar, so it can do all four.
  //
  // Gated hard on cost: only threads that NEED him, only ones whose words
  // look like a proposal at all, and at most two calls per load. Almost no
  // mail proposes a time, and the mail that does always says so.
  const findMeetings = async (needsYou: ThreadRow[]) => {
    if (!ai.available || !scheduleSvc) { setMeetings([]); return; }
    const candidates = needsYou
      .filter((r) => mightProposeTimes((r.subject || "") + " " + (r.snippet || "")))
      .slice(0, 2);
    if (candidates.length === 0) { setMeetings([]); return; }
    const todayIso = new Date().toISOString().slice(0, 10);
    const out: MailMeeting[] = [];
    for (const r of candidates) {
      try {
        const api = apiFor(accountOfThread(r.id));
        if (!api) continue;
        const full = mapThreadFull(await api.getThread(r.id));
        const last = full.messages[full.messages.length - 1];
        if (!last) continue;
        const raw = await ai.complete(
          [{ role: "user", content: meetingPrompt(displayName(r.from), full.subject, cleanBody(last.body), todayIso) }],
          MEETING_SYSTEM,
        );
        const times = parseMeetingTimes(raw, todayIso);
        if (times.length === 0) continue;
        // Every day the sender named, checked against what is actually there.
        const days = [...new Set(times.map((t) => t.date))];
        const events = (await Promise.all(days.map((d) => scheduleSvc.eventsOn(d)))).flat();
        const options = optionsAgainst(times, events);
        const free = firstFree(options);
        // No open slot means no home-page card. It is a real answer, but it
        // is not a ONE-TAP answer, so it stays in the tab.
        if (!free) continue;
        out.push({
          threadId: r.id, from: displayName(r.from), label: free.label,
          date: free.date, start: free.start, end: free.end, line: meetingLine(options),
        });
      } catch { /* one unreadable thread never stops the rest */ }
    }
    setMeetings(out);
  };

  // THE PROMISE SWEEP (E5). The commitment catcher already handles anything
  // sent FROM this app. This is the rest: promises he made in the Gmail web
  // client, on his phone, or before JARVIS existed. One capped AI pass, and
  // only when new mail has actually gone out since the last one.
  const runSweep = async () => {
    if (!ai.available) return;
    try {
      const list = g.apis("mail");
      if (list.length === 0) return;
      const items: SentItem[] = [];
      let head = "";
      for (const { api } of list) {
        const metas = await api.searchThreads("in:sent -in:chats", 8).catch(() => []);
        for (const meta of metas) {
          const full = mapThreadFull(meta as unknown as Parameters<typeof mapThreadFull>[0]);
          const last = full.messages[full.messages.length - 1];
          if (!last) continue;
          if (!head) head = last.id;
          if (alreadyPromised(full.id)) continue;
          items.push({
            threadId: full.id,
            to: displayName(header(last as never, "to")),
            subject: full.subject,
            body: cleanBody(last.body),
            msgId: last.id,
          });
        }
      }
      if (!needsSweep(head)) return;
      if (items.length === 0) { saveSweep({ head, promises: [] }); setSweepTick((n) => n + 1); return; }
      const raw = await ai.complete(
        [{ role: "user", content: sweepPrompt(items.slice(0, 8), new Date().toISOString().slice(0, 10)) }],
        SWEEP_SYSTEM,
      );
      saveSweep({ head, promises: parseSweep(raw, items) });
      setSweepTick((n) => n + 1);
    } catch { /* a missed promise is silent; a wrong task is not */ }
  };

  // Waiting On is a bonus layer: it loads after the inbox and fails to
  // nothing. Opens are looked up only for threads we actually tracked.
  const loadWaiting = async () => {
    try {
      const per = await Promise.all(g.apis("mail").map(async ({ email, api }) => {
        const rows = await findWaiting(api, Date.now()).catch(() => []);
        return rows.map((r) => ({ ...r, account: email }));
      }));
      // A thread he let go stops counting days. Filter BEFORE the slice, or
      // letting one go just promotes the next dead one into its seat.
      const dropped = loadLetGo();
      const w = per.flat()
        .filter((r) => !dropped.includes(r.threadId))
        .sort((a, b) => b.waitingDays - a.waitingDays)
        .slice(0, 5);
      setWaiting(w);
      // Best effort: no phones just means no Call buttons, never an error.
      if (people) {
        try {
          const list = await people.list();
          setBook(phoneBook(list));
          setColleagues(colleagueBook(list));
        } catch { /* no phones, no Call */ }
      }
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

  // ONE PLACE DECIDES (2026-08-21).
  //
  // The row's button, the tone of the draft behind it, and the sheet's list
  // of alternates all have to agree, and they only agree if they are the same
  // call with the same options. Three separate decide() calls with three
  // different opts is how a button ends up saying Call Them while the handler
  // opens a compose window.
  const decideFor = useCallback((row: WaitingRow): Decision => {
    const alt = altFor(colleagues, row.toEmail);
    return decide(row.subject ?? "", "", row.waitingDays, nudgeCounts[row.threadId] ?? 0, {
      hasPhone: !!phoneFor(book, row.toEmail, row.to),
      altContact: alt ? firstName(alt.name) : null,
      // Money only from the sender's own words, never from an order number
      // (attachmentKind's rule, and the reason a bill for $2,565 never
      // appears out of a subject line reading "Order #D2565").
      billable: amountIn(row.subject ?? "") != null,
      canTask: !!tasks,
      canSchedule: !!scheduleSvc,
    });
  }, [book, colleagues, nudgeCounts, tasks, scheduleSvc]);

  // A thread he let go stops counting days. Hoisted out of the Waiting On
  // render (2026-08-21) because the swipe sheet closes rows too, and two
  // copies of this would drift.
  const dropRow = (threadId: string, said = "Stopped tracking") => {
    setWaiting((ws) => ws.filter((x) => x.threadId !== threadId));
    letGo(threadId);
    say(said, { label: "Undo", run: () => {
      undoLetGo(threadId);
      void loadWaiting();
    } });
  };

  // Tap a Waiting On row: JARVIS drafts the nudge, the user gets it in
  // compose. It never auto-sends: a nudge is a relationship move.
  //
  // `act` is the action the user actually chose. The row's own button passes
  // nothing and gets the primary; the More sheet passes whichever alternate
  // was tapped, and its instruction is what the drafter is told.
  const startNudge = async (row: WaitingRow & { account?: string }, act?: MailAction, toOverride?: string) => {
    // The label promised a phone call; honour it. Dialing is the whole point
    // of the top rung, and drafting a sixth email is what made these buttons
    // useless in the first place.
    const phone = phoneFor(book, row.toEmail, row.to);
    const chosen = act ?? decideFor(row).primary;
    // A label may only promise what the handler performs: if the button said
    // Call, this dials, and if it said anything else it drafts.
    if (chosen.channel === "call") {
      if (phone) window.location.href = telLink(phone);
      return;
    }
    if (chosen.channel === "text") {
      if (phone) window.location.href = smsLink(phone);
      return;
    }
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
          // N13 (2026-08-20): 55 days deserves a different tone than 3, and
          // the last rung changes CHANNEL rather than raising its voice.
          // The tone escalates; the blame never does.
          // The WAIT sets the tone, the ASK sets what the draft is for.
          const p = nudgePrompt(row, await voiceText());
          body = noDashes((await ai.complete([{ role: "user", content: p.user }], p.system + "\n" + (chosen.instruction ?? ""), { tier: "write" })).trim());
        } catch { body = ""; }
      }
      setEditingDraftId(null);
      // No thread state: a nudge starts from HOME, so compose's Cancel must
      // land back on the list, not on a detail view the user never visited.
      setThread(null);
      // Routing around a quiet person starts a NEW conversation with somebody
      // else, so it must not reply into the old thread: threading it would
      // put the colleague inside a chain they were never part of, and Gmail
      // would show the silent person the whole history.
      const routed = !!toOverride && toOverride !== row.toEmail;
      setDraft({
        to: toOverride ?? row.toEmail,
        subject: routed
          ? last.subject.replace(/^(re|fwd):\s*/i, "")
          : (/^re:/i.test(last.subject) ? last.subject : "Re: " + last.subject),
        body,
        ...(routed ? {} : { inReplyTo: last.messageId, threadId: full.id }),
        account: (row as { account?: string }).account,
      });
      setView("compose");
    } catch {
      setError("Couldn't open that conversation.");
    } finally {
      setNudging(null);
    }
  };

  // THE REST OF THE MOVES, actually performed.
  //
  // decide() has always returned a list of alternates and nothing could
  // reach them. This is the other half: every key it can emit has a handler
  // here, and every handler does the thing its label promises. The two lists
  // are kept honest by a law test (mailAction.test.ts) that walks every ask
  // and every tone and asserts no key escapes without a case here.
  const runAction = async (row: WaitingRow & { account?: string }, a: MailAction) => {
    setMore(null);
    switch (a.key) {
      case "stop":
        dropRow(row.threadId);
        return;
      case "handled":
        dropRow(row.threadId, "Marked handled");
        return;
      case "quiet":
        // Future mail from this address sorts to Noise. The thread itself is
        // untouched, same as every other exit in this section.
        setRules(saveRule(row.toEmail, "noise"));
        dropRow(row.threadId, "Quieted " + displayName(row.to));
        return;
      case "someone_else": {
        const alt = altFor(colleagues, row.toEmail);
        if (alt) await startNudge(row, a, alt.email);
        return;
      }
      case "forward":
        setEditingDraftId(null);
        setThread(null);
        setDraft({
          to: "",
          subject: "Fwd: " + (row.subject ?? "").replace(/^(re|fwd):\s*/i, ""),
          body: "",
          account: row.account,
        });
        setView("compose");
        return;
      case "add_bill": {
        const amount = amountIn(row.subject ?? "");
        if (!tasks || amount == null) return;
        await tasks.createTask(laterTaskTitle(displayName(row.to), row.subject ?? ""), {
          bill: { amount },
          source: madeBy("email", row.threadId),
        });
        say("Added to Money · $" + amount.toLocaleString());
        return;
      }
      case "add_task":
        if (!tasks) return;
        await tasks.createTask(laterTaskTitle(displayName(row.to), row.subject ?? ""), {
          due: todayISO(),
          source: madeBy("email", row.threadId),
        });
        say("Added to your tasks");
        return;
      case "block_time": {
        if (!scheduleSvc) return;
        const now = new Date();
        const today = todayISO(now);
        const tmr = addDays(today, 1);
        const all = await scheduleSvc.listEvents();
        // ONE DEFINITION OF BUSY. Same rule the Schedule tab's Open rows use:
        // events and hard routine blocks are busy, a focus block is not,
        // because focus time is time set aside FOR work like this.
        const busyFor = async (date: string) => {
          const r = await routineSvc?.get().catch(() => null);
          if (!r) return [];
          const dow = new Date(date + "T12:00:00").getDay();
          return protectedRangesFor(r, dow).filter((l) => !isFocusRange(l)).map((l) => ({ s: l.s, e: l.e }));
        };
        const slot = nextOpening(
          { date: today, events: eventsForDate(all, today), busy: await busyFor(today) },
          { date: tmr, events: eventsForDate(all, tmr), busy: await busyFor(tmr) },
          now.getHours() * 60 + now.getMinutes(),
        );
        if (!slot) { say("No open slot in the next two days"); return; }
        const id = await scheduleSvc.createEvent(laterTaskTitle(displayName(row.to), row.subject ?? ""), {
          date: slot.date,
          start: slot.start,
          end: slot.end,
          source: madeBy("email", row.threadId),
        });
        say(id
          ? (slot.date === today ? "Booked " : "Booked tomorrow ") + fmtTime(slot.start) + " · " + BOOK_MIN + " min"
          : "Couldn't book that");
        return;
      }
      default:
        // Everything left is a draft or a dial, and startNudge knows the
        // difference from the action's own channel.
        await startNudge(row, a);
    }
  };

  // Every account's drafts, not just the first's (2026-08-09).
  const loadDrafts = useCallback(async () => {
    const list = g.apis("mail");
    if (list.length === 0) return;
    setLoading(true);
    try {
      const per = await Promise.all(list.map(async ({ api }) => api.listDrafts(25).catch(() => [])));
      setDrafts(per.flat().map((d) => ({
        id: d.id,
        to: header(d.message, "To"),
        subject: header(d.message, "Subject"),
        snippet: d.message.snippet || "",
        // N10 needs an age. internalDate is Gmail's own receive/save stamp,
        // which is the only honest answer to "how long has this sat".
        dateMs: Number((d.message as { internalDate?: string }).internalDate || 0),
        threadId: (d.message as { threadId?: string }).threadId,
      })));
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

  // Arriving from a home-page notice: open that exact thread once the inbox
  // has loaded. Once only, so backing out of the thread does not bounce him
  // straight back into it.
  const jumped = useRef<string | null>(null);
  useEffect(() => {
    if (!openThreadId || rows.length === 0) return;
    if (jumped.current === openThreadId) return;
    if (!rows.some((r) => r.id === openThreadId)) return;
    jumped.current = openThreadId;
    void openThread(openThreadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThreadId, rows]);

  // THE HOME SNAPSHOT (Dave 2026-08-20). Today must render instantly, so it
  // never touches Gmail: the Email tab leaves behind everything the home page
  // needs the moment it knows it. Sender, subject, gist and the deadline the
  // sender stated, plus who owes him a reply and what he promised. See
  // messages/home.ts for what the home page does with it.
  useEffect(() => {
    if (!triaged || rows.length === 0) return;
    const todayIso = new Date().toISOString().slice(0, 10);
    // A thread whose last message is no longer HIS has answered itself, which
    // is the same derivation Waiting On uses, so the two can never disagree.
    const answeredThreads = rows.filter((r) => !waiting.some((w) => w.threadId === r.id)).map((r) => r.id);
    const map = selfBlankGuard(
      applyRules(triage, rows, rules),
      rows,
      g.accounts.map((a) => a.email),
    );
    const { needsYou } = splitByBucket(rows, map);
    const ordered = sortByDeadline(needsYou, map);
    saveMailSnapshot({
      ts: Date.now(),
      needsYou: needsYou.length,
      threads: ordered.slice(0, 6).map((r) => ({
        id: r.id,
        from: displayName(r.from),
        fromEmail: r.fromEmail,
        subject: r.subject,
        gist: map[r.id]?.gist ?? r.snippet ?? "",
        by: map[r.id]?.by,
        account: (r as ThreadRow & { account?: string }).account,
        snippet: r.snippet ?? "",
        lastMsgId: r.lastMsgId,
        // Reuse the quick replies this thread already has. Regenerating them
        // for the home page would be a second AI call for an answer we own.
        replies: briefFor(r.lastMsgId)?.replies,
      })),
      waiting: waiting.slice(0, 3).map((w) => ({
        threadId: w.threadId, to: displayName(w.to), subject: w.subject, days: w.waitingDays,
      })),
      promises: liveSweep(loadSweep(), loadPromised()).slice(0, 3),
      // N1: only meetings with an open slot travel to the home page. "You're
      // busy for all of them" is a real answer, but it is not a one-tap one,
      // so it stays in the tab rather than becoming an interruption.
      meetings: meetings.slice(0, 2),
      // N3: chases HE set, come due, and still unanswered. A thread whose
      // last message is no longer his has answered itself out of the list.
      chases: dueChases(loadChases(), todayIso, answeredThreads).slice(0, 2).map((c) => ({
        threadId: c.threadId, to: c.to, subject: c.subject,
      })),
      // N10: drafts he started and never sent, offered once each.
      drafts: staleDrafts(drafts.filter((d) => !!d.dateMs).map((d) => ({
        id: d.id, to: d.to, subject: d.subject, snippet: d.snippet, dateMs: d.dateMs!,
      })), Date.now(), loadOffered()).slice(0, 1).map((d) => ({
        id: d.id, threadId: (drafts.find((x) => x.id === d.id)?.threadId) || "", to: d.to, subject: d.subject,
        line: staleLine(d, Date.now()),
      })),
    });
  }, [triaged, rows, triage, rules, waiting, sweepTick, meetings, drafts]);

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
          .createTask(laterTaskTitle(r.from, r.subject), { due: new Date().toISOString().slice(0, 10), source: madeBy("email", r.id) })
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

  // Fans out across EVERY mail account (2026-08-09): it used to quietly
  // cover only the first, so a hit in the second account came back as "No
  // matches" with no hint anything was skipped. Same shape as loadThreads.
  const runSearch = async () => {
    const list = g.apis("mail");
    const q = search.trim();
    if (list.length === 0 || !q) return;
    setSearching(true);
    setError(null);
    try {
      const perAccount = await Promise.all(list.map(async ({ email, api }) => {
        const metas = await api.searchThreads(q, 20).catch(() => []);
        return metas.map(mapThread).filter((t): t is ThreadRow => t !== null).map((t) => ({ ...t, account: email }));
      }));
      setResults(perAccount.flat().sort((a, b) => b.dateMs - a.dateMs));
    } catch (e) {
      setError((e as Error).message || "Search failed");
    } finally {
      setSearching(false);
    }
  };

  // HEADS-DOWN AUTO-REPLY (N8, 2026-08-20).
  //
  // Every guard lives in shouldAutoReply, so "should this send" is one answer
  // with one reason rather than a chain of ifs spread across a component:
  // off by default, VIPs only, once per person per block, never a machine,
  // never himself, never a thread he already answered. The body is
  // deterministic and names a REAL time he is back, because a model
  // improvising over his name while he is not looking is not a feature.
  useEffect(() => {
    if (!autoReplyOn || !routineSvc || rows.length === 0 || vips.length === 0) return;
    void (async () => {
      try {
        const r = await routineSvc.get();
        const now = new Date();
        const min = now.getHours() * 60 + now.getMinutes();
        const block = protectedRangesFor(r, now.getDay())
          .find((b) => isFocusRange(b) && min >= b.s && min < b.e);
        if (!block) return; // no focus block running: nothing auto-sends, ever
        const blockId = `${now.toISOString().slice(0, 10)}:${block.s}`;
        const me = (g.accounts[0]?.email ?? "").toLowerCase();
        const backAt = fmtTime(`${String(Math.floor(block.e / 60)).padStart(2, "0")}:${String(block.e % 60).padStart(2, "0")}`);
        for (const row of rows.filter((x) => x.unread)) {
          const state = loadAutoState(blockId);
          if (!shouldAutoReply({
            enabled: autoReplyOn, fromEmail: row.fromEmail, myEmail: me, vips,
            state, alreadyRepliedThread: !!waiting.find((w) => w.threadId === row.id),
          })) continue;
          const api = apiFor(accountOfThread(row.id));
          if (!api) continue;
          const full = mapThreadFull(await api.getThread(row.id));
          const last = full.messages[full.messages.length - 1];
          if (!last) continue;
          const reply = buildReply(last, "");
          await api.sendMessage(encodeEmail({
            to: reply.to, subject: reply.subject,
            body: autoReplyBody(`${backAt.time} ${backAt.ap}`, (await profileSvc?.get())?.name ?? ""),
            inReplyTo: reply.inReplyTo,
          }), full.id);
          markAutoReplied(blockId, row.fromEmail);
          emit({ type: "action", props: { name: "email.autoreply" } });
        }
      } catch { /* an auto-reply that fails is silent; it is a courtesy, not a job */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReplyOn, rows, vips, routineSvc]);

  // N11 (2026-08-20): "what did I tell Wei about the invoice". Before a call
  // the question is never "show me the thread"; it is the sentence he wrote.
  //
  // It QUOTES him. The parser refuses any quote that is not verbatim in what
  // he actually sent, because a paraphrased commitment is how you walk into a
  // call wrong, and no match is a real answer rather than a failure to hide.
  const askWhatISaid = async () => {
    const question = search.trim();
    const list = g.apis("mail");
    if (!question || list.length === 0 || !ai.available || saidBusy) return;
    setSaidBusy(true);
    setSaid(null);
    try {
      const metas = await list[0]!.api.searchThreads(saidQuery("", question), 8).catch(() => []);
      const items = metas
        .map((m) => {
          const full = mapThreadFull(m as unknown as Parameters<typeof mapThreadFull>[0]);
          const mine = full.messages[full.messages.length - 1];
          if (!mine) return null;
          return {
            subject: full.subject,
            dateISO: (mine.date ? new Date(mine.date) : new Date()).toISOString().slice(0, 10),
            threadId: full.id,
            body: cleanBody(mine.body),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      if (items.length === 0) { setSaid([]); return; }
      const raw = await ai.complete(
        [{ role: "user", content: saidPrompt(question, items.map((i) => ({ subject: i.subject, dateISO: i.dateISO, body: i.body }))) }],
        SAID_SYSTEM,
      );
      setSaid(parseSaid(raw, items));
    } catch {
      setSaid([]);
    } finally {
      setSaidBusy(false);
    }
  };

  // EMAIL WINDOWS. A curtain, never a lock: one tap opens it anyway, with no
  // friction and no scolding. "Peeked" lasts for this visit only, so the
  // habit re-forms next time rather than being permanently switched off by
  // one impatient moment.
  const [windows, setWindows] = useState(() => loadWindows());
  const [peeked, setPeeked] = useState(false);
  const [editWindows, setEditWindows] = useState(false);
  const applyWindows = (next: WindowSettings) => {
    setWindows(next);
    saveWindows(next);
    setEditWindows(false);
    if (!next.on) setPeeked(false);
  };
  const curtained = windows.on && !peeked && !isOpenNow(windows, new Date());

  const [held, setHeld] = useState<{ at: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const heldRef = useRef<typeof held>(null);
  useEffect(() => { heldRef.current = held; }, [held]);
  // Fire the send if the app is torn down mid-hold. Losing a message the user
  // believes they sent is far worse than sending one they meant to catch.
  useEffect(() => () => { if (heldRef.current) void doSend(); /* eslint-disable-line */ }, []);

  const send = () => {
    if (!draft.to.trim()) { setError("Add a recipient"); return; }
    if (held) return;
    setError(null);
    setView("list");
    const timer = setTimeout(() => { setHeld(null); void doSend(); }, HOLD_SECONDS * 1000);
    setHeld({ at: Date.now(), timer });
  };

  const undoSend = () => {
    if (!held) return;
    clearTimeout(held.timer);
    setHeld(null);
    setView("compose");
  };

  const sendNow = () => {
    if (!held) return;
    clearTimeout(held.timer);
    setHeld(null);
    void doSend();
  };

  const openThread = async (id: string) => {
    const api = apiFor(accountOfThread(id));
    if (!api) return;
    // A new thread gets a fresh attachment offer; the last one's dismissal
    // must not silence this one.
    setAttachDone(false);
    setSummary(null);
    setReplies(DEFAULT_REPLIES);
    try {
      const full = mapThreadFull(await api.getThread(id));
      if (full.messages.length === 0) return;
      setThread(full);
      setView("detail");
      // Remember who CAN be unsubscribed from, for the batch sweep. Read off
      // a thread already fetched; the sweep never triggers a fetch of its own.
      const um = full.messages[full.messages.length - 1];
      if (um?.fromEmail) {
        const u = parseUnsub(um.listUnsubscribe, um.listUnsubscribePost);
        if (u) setUnsubbable((prev) => (prev[um.fromEmail.toLowerCase()] ? prev : { ...prev, [um.fromEmail.toLowerCase()]: u }));
      }
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

  // Detail-view archive rides the list row's path (2026-08-09): the same
  // gesture used to teach two contracts, toast+Undo from the list and dead
  // silence from the open thread.
  const archiveThread = (id: string) => {
    const row = rows.find((r) => r.id === id);
    setView("list");
    if (row) archiveRow(row);
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

  // N9: one sender's unsubscribe, without opening their mail. Same two forms
  // and the same honesty as doUnsub: mailto is sent, https is OPENED, because
  // without List-Unsubscribe-Post a URL may be a page needing a click and
  // pretending otherwise is a false receipt.
  const requestUnsub = async (u: Unsub) => {
    if (u.kind === "mailto") {
      const api = g.apis("mail")[0]?.api;
      if (!api) return;
      await api.sendMessage(encodeEmail({ to: u.target, subject: u.subject || UNSUB_SUBJECT, body: UNSUB_BODY })).catch(() => {});
    } else {
      window.open(u.target, "_blank", "noopener,noreferrer");
    }
    emit({ type: "action", props: { name: "email.unsubscribe", kind: u.kind } });
  };

  // Which of the binned senders published a machine-readable way to stop.
  // Read off the threads already in hand: no extra fetches for an offer.
  useEffect(() => {
    if (rows.length === 0) return;
    const names: Record<string, string> = {};
    for (const r of rows) if (r.fromEmail) names[r.fromEmail.toLowerCase()] = r.from;
    const cands = sweepCandidates(loadTossed(), loadAsked(), names, Object.keys(unsubbable));
    setSweep(cands);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, unsubbable]);

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
    // A failed write un-hides the row and says so (2026-08-09): pretending it
    // worked meant the "archived" mail quietly reappeared on the next load.
    apiFor(r.account)?.modifyThread(r.id, [], ["INBOX"]).catch(() => {
      setRows((rs) => [r, ...rs.filter((x) => x.id !== r.id)].sort((a, b) => b.dateMs - a.dateMs));
      say("Couldn't archive · still in inbox");
    });
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
    say("Deleted · in trash 30 days", { label: "Undo", run: () => {
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
    const what = capAfterNumber(noise.length === 1 ? "1 conversation archived" : noise.length + " conversations archived");
    // Undo (2026-08-09): this was the one archive without it, and it is the
    // one that takes the most at once, including when the opt-in auto-clear
    // runs it unattended.
    say(manual ? what : what + " · " + noiseLine(noise), {
      label: "Undo",
      run: () => {
        setRows((rs) => [...noise, ...rs].sort((a, b) => b.dateMs - a.dateMs));
        for (const r of noise) apiFor(r.account)?.modifyThread(r.id, ["INBOX"], []).catch(() => {});
      },
    }, manual ? 6000 : 8000);
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
    // Push 15 (auto-file, folded into the Everything AI level): auto-clear
    // runs at Everything without the manual opt-in; the opt-in still works
    // at any level. Receipt + undo either way; nothing is silently hidden.
    const autoOn = autoNoise || effectiveLevel(getAIControl()) === "everything";
    if (!triaged || !autoOn || autoRan.current) return;
    const { noise } = splitByBucket(rows, applyRules(triage, rows, rules));
    if (noise.length === 0) return;
    autoRan.current = true;
    archiveAllNoise(noise, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triaged, autoNoise, rows, triage, rules]);

  // N15: only ever something he ALREADY has. Nothing is generated, nothing is
  // guessed at, and nothing is attached without him.
  useEffect(() => {
    if (view !== "compose" || !notesSvc || myFiles.length > 0) return;
    void notesSvc.listNotes()
      .then((ns) => setMyFiles(ns.slice(0, 60).map((n) => ({ id: n.id, name: String(n.data.title ?? ""), kind: "note" })).filter((c) => c.name.trim() !== "")))
      .catch(() => setMyFiles([]));
  }, [view, notesSvc, myFiles.length]);

  // N7: the open projects a thread can belong to. Read once; a tab that
  // renders without the provider simply offers nothing, same as every other
  // optional service here.
  useEffect(() => {
    if (!projectsSvc || projects.length > 0) return;
    void projectsSvc.list()
      .then((ps) => setProjects(ps
        .filter((p) => p.data.status !== "done")
        .slice(0, 8)
        .map((p) => ({ id: p.id, title: String(p.data.title ?? ""), category: p.data.category as string | undefined }))
        .filter((p) => p.title.trim() !== "")))
      .catch(() => setProjects([]));
  }, [projectsSvc, projects.length]);

  const lastMsg = (t: ThreadFull): MailFull => t.messages[t.messages.length - 1]!;

  const attachHint: AttachSuggestion | null =
    view === "compose" && thread && thread.messages.length > 0
      ? suggestAttachment(cleanBody(lastMsg(thread).body), draft.body, myFiles)
      : null;

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
          const p = handoffPrompt(target, t.subject, effTriage[t.id]?.gist || "", await voiceText());
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

  // UNDO SEND (2026-08-20, from the complaint research). Send is the only
  // irreversible button in this app; everything else can be archived back or
  // untrashed. That asymmetry is why "undo send" tops every email survey and
  // why Apple finally shipped it in Mail. So nothing leaves immediately.
  //
  // The hold is REAL: during it the message has not been handed to Gmail, so
  // Undo genuinely un-sends rather than asking the recipient nicely. The
  // composer's state is kept intact for the whole window, so Undo puts him
  // back exactly where he was, mid-sentence if that is where he was.
  const doSend = async () => {
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
      const raw = encodeEmail({ to: draft.to.trim(), subject: draft.subject, body: draft.body, inReplyTo: draft.inReplyTo, ...(trackOpens ? { pixelUrl: pixelUrlFor(trackId) } : {}) });
      const sent = await api.sendMessage(raw, draft.threadId);
      if (trackOpens) {
        saveTrack(trackId, { threadId: sent.threadId || draft.threadId || sent.id, sentAt: Date.now() });
        void registerTrack(trackId, authToken);
      }
      // The voice metric: a deck draft that needed editing before it could be
      // sent (flag: true). Unedited sends are logged from the deck's Send &
      // Next. Durable EventType since 2026-08-07, same shape both places.
      if (draft.fromDeck) emit({ type: "email.deck_sent", props: { flag: true } });
      if (editingDraftId) {
        const id = editingDraftId;
        api.deleteDraft(id).catch(() => {});
        setDrafts((ds) => ds.filter((d) => d.id !== id));
        setEditingDraftId(null);
      }
      // Commitment catcher: if he just promised something, it becomes a task
      // with the date HE named. Once per thread, and never for a hand-off note
      // (the promise there is the other person's).
      // N13: the ladder climbs on what was actually SENT to someone who owes
      // him, so it cannot be gamed by opening the drafter and closing it.
      if (draft.threadId && chaseDays > 0) {
        setChase({
          threadId: draft.threadId, to: draft.to, subject: draft.subject,
          setISO: new Date().toISOString().slice(0, 10), days: chaseDays,
        });
      }
      const nudged = draft.threadId && waiting.some((w) => w.threadId === draft.threadId);
      if (nudged) setNudgeCounts(countNudge(draft.threadId!));
      // N3: a chase he set retires the moment he acts on it.
      if (draft.threadId) clearChase(draft.threadId);
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
            await tasks.createTask(c.text, { due: c.due ?? null, source: madeBy("email", threadForPromise) });
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
  // N4 (2026-08-20): VIPs come LAST, because a VIP is the one rule allowed to
  // overrule both the model and his own filing. Mail from his attorney
  // surfaces the moment it lands whatever anything else thinks.
  const effTriage = applyVips(applyRules(triage, rows, rules), rows, vips);

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
        <PageHeader title="Email" />
        <div className="pad-x"><div className="card"><div className="empty-state">
          <div className="deck-dead-burst"><Burst show /></div>
          <div className="empty-title">Inbox: Dead</div>
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
        <div><div className="list-flat">
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
        {/* N8 (2026-08-20). The ONLY thing in this app that sends without a
            tap, so the promise and the guard are the same sentence and it
            lives OFF until he turns it on. */}
        <div className="grp"><div className="eyebrow">Heads-Down Auto-Reply</div></div>
        <div><div className="list-flat">
          <div className="row">
            <div className="row-grow">
              <div className="conn-name">{autoReplyOn ? "On During Focus Blocks" : "Off"}</div>
              <div className="conn-meta">{AUTO_REPLY_EXPLAINER}</div>
            </div>
            <button className="pill-act" onClick={() => {
              const next = !autoReplyOn;
              setAutoReplyOn(next);
              try { localStorage.setItem(AUTOREPLY_KEY, next ? "on" : "off"); } catch { /* private mode */ }
            }}>{autoReplyOn ? "Turn Off" : "Turn On"}</button>
          </div>
          {vips.length === 0 && (
            <div className="row"><div className="row-grow">
              <div className="conn-meta">Nobody is a VIP yet, so nothing would send. Mark someone from their thread.</div>
            </div></div>
          )}
        </div></div>

        <div className="grp"><div className="eyebrow">Muted Threads</div></div>
        <div><div className="list-flat">
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
              say("Auto-clear off · noise stays");
            }}>Stop Clearing Noise Automatically</button>
          </div>
        )}
      </div>
    );
  }

  // THE CURTAIN. An early return, the same shape as the not-connected screen:
  // outside a window the Email tab simply is not an inbox. One tap opens it
  // anyway, because an app that refuses to show a man his own email is a toy.
  if (view === "list" && curtained) {
    // A VIP is never behind the curtain (the feature's own second law, which
    // v1 broke: the early return hid EVERYTHING). Unread VIP threads show
    // through, alone; tapping one opens exactly that thread.
    const vipRows = rows.filter((r) => r.unread && isVip(r.fromEmail, vips)).slice(0, 3);
    return (
      <div className="screen">
        <PageHeader title="Email" />
        <div className="pad-x">
          <div className="card mail-curtain">
            <div className="row">
              <div className="row-glyph cat-fg-teal"><Mail className="ic" /></div>
              <div className="row-grow">
                {/* WHEN, never how many. A count here would reintroduce the
                    exact guilt this feature exists to remove. And it says WHO
                    closed it: Dave found this screen and did not recognise it
                    as his own choice, which is the failure the sub repairs. */}
                <div className="conn-name">{closedLine(windows, new Date())}</div>
                <div className="conn-meta">You close email outside your windows</div>
              </div>
            </div>
            <div className="row row-acts">
              <button className="btn btn-primary btn-sm" onClick={() => setPeeked(true)}>Open Anyway</button>
              <button className="btn-sm" onClick={() => setEditWindows(true)}>Adjust</button>
            </div>
          </div>
        </div>
        {vipRows.length > 0 && (
          <div className="pad-x"><div className="card">
            {vipRows.map((r) => (
              <div className="row" role="button" tabIndex={0} key={r.id} onClick={() => { setPeeked(true); void openThread(r.id); }}>
                <div className="row-grow">
                  <div className="conn-name truncate">{displayName(r.from)}</div>
                  <div className="conn-meta truncate">VIP · {r.subject}</div>
                </div>
                <span className="pill-act">Open It</span>
              </div>
            ))}
          </div></div>
        )}
        {editWindows && (
          <WindowsSheet
            initial={windows}
            onSave={applyWindows}
            onTurnOff={() => applyWindows({ ...windows, on: false })}
            onClose={() => setEditWindows(false)}
          />
        )}
        <div className="screen-foot" />
      </div>
    );
  }

  if (view === "list" && (!configured || !g.hasToken)) {
    // Demo build: show the real anatomy with fixture mail so previews and
    // the App Store demo read as a working inbox. Off unless the shell says
    // this session is the seeded demo (tests and real builds keep the honest
    // connect state).
    if (demoMail) {
      // Lazy AND behind the build constant: the fixtures live in that module,
      // so a static import would ship them to every real user.
      return DemoMail ? (
        <div className={pushCls} key="demo">
          <Suspense fallback={null}>
            <DemoMail onConnect={configured ? connect : onOpenConnections} />
          </Suspense>
        </div>
      ) : null;
    }
    return (
      <div className={"screen " + pushCls} key="connect">
        <PageHeader title="Email" />
        {/* Catalog V3.1: the empty state carries its action. Directions to a
            button somewhere else are illegal; the button is here. */}
        <div className="pad-x"><div className="card"><div className="empty-state">
          <div className="empty-icon"><Mail className="ic" /></div>
          <div className="empty-title">Connect Your Email</div>
        </div></div></div>
        <div className="pad-x conn-action">
          {configured
            ? <button className="btn btn-primary btn-block" onClick={connect}>Connect Google</button>
            : <button className="btn btn-primary btn-block" onClick={onOpenConnections}>Open Connections</button>}
        </div>
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

          {/* N15 (2026-08-20): they asked for the waiver, he has a waiver.
              Every mail client waits until Send and then asks if he forgot;
              none of them offers the file he actually owns. Only ever
              something he ALREADY has, by name, and never attached on its
              own. */}
          {attachHint && (
            <div className="card"><div className="row">
              <div className="row-grow">
                <div className="conn-name">You Have That File</div>
                <div className="conn-meta">{suggestLine(attachHint)}</div>
              </div>
              <button className="pill-act" onClick={() => {
                setDraft((d) => ({ ...d, body: d.body + "\n\n(" + attachHint.candidate.name + ")" }));
                setToast("Named it in the message · Attach it from your phone");
                setTimeout(() => setToast(null), 4000);
              }}>Mention It</button>
            </div></div>
          )}

          {/* N3: set the chase when he SENDS, which is the only moment he
              remembers he is owed anything. It cancels itself the instant
              they write back. */}
          {draft.threadId && (
            <div className="card"><div className="row">
              <div className="row-grow">
                <div className="conn-name">Chase If No Reply</div>
                <div className="conn-meta">{chaseDays === 0 ? "Off · Waiting On will still find it eventually" : `In ${chaseDays} days`}</div>
              </div>
              <div className="msg-chips">
                <button className={"chip" + (chaseDays === 0 ? " on" : "")} onClick={() => setChaseDays(0)}>Off</button>
                {CHASE_DAYS.map((d) => (
                  <button key={d} className={"chip" + (chaseDays === d ? " on" : "")} onClick={() => setChaseDays(d)}>{d}d</button>
                ))}
              </div>
            </div></div>
          )}
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
            <button className="nav-action danger" onClick={() => trashThread(thread.id)} aria-label="Delete"><Trash2 className="ic" /></button>
            <button className="nav-action" onClick={() => archiveThread(thread.id)} aria-label="Archive"><Archive className="ic" /></button>
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
              say("Muted · won't come back", { label: "Undo", run: () => setMuted(unmute(thread.id)) });
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
                    <div className="conn-meta">No emails in People yet</div>
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
                        setToast(lastMsg(thread).from + " · " + BUCKET_LABEL[b] + " from now on");
                        setTimeout(() => setToast(null), 2500);
                      }}
                    >{BUCKET_LABEL[b]}</button>
                  );
                })}
              </div>
            </div>
          )}
          {/* N7 (2026-08-20): he asked for this on the projects page rounds
              ago. The link lives on THIS device and is a VIEW, not a
              mutation: nothing is written to Gmail and nothing is written to
              the project, so unlinking leaves no trace anywhere. One home
              per thread, because a thread in two projects is in neither. */}
          {projects.length > 0 && (
            <div className="msg-filed">
              <span className="conn-meta">{links[thread.id] ? "Part of " + links[thread.id]!.label : "Not linked to anything"}</span>
              <div className="msg-chips">
                {projects.slice(0, 4).map((p) => (
                  <button
                    key={p.id}
                    className={"chip" + (links[thread.id]?.id === p.id ? " on" : "")}
                    onClick={() => {
                      const on = links[thread.id]?.id === p.id;
                      setLinks(linkThread(thread.id, on ? null : { type: "project", id: p.id, label: p.title, category: p.category }));
                      setToast(on ? "Unlinked" : "Filed under " + p.title);
                      setTimeout(() => setToast(null), 2500);
                    }}
                  >{p.title}</button>
                ))}
              </div>
            </div>
          )}

          {/* N4 (2026-08-20): the one rule allowed to overrule the model AND
              his own filing. Short on purpose: a VIP list with twenty people
              on it is an inbox with extra steps. */}
          <div className="msg-filed">
            <span className="conn-meta">{isVip(lastMsg(thread).fromEmail, vips) ? "Always gets through" : "Everyone else waits for the drain"}</span>
            <div className="msg-chips">
              <button
                className={"chip" + (isVip(lastMsg(thread).fromEmail, vips) ? " on" : "")}
                onClick={() => {
                  const next = toggleVip(lastMsg(thread).fromEmail);
                  setVips(next);
                  setToast(isVip(lastMsg(thread).fromEmail, next)
                    ? displayName(lastMsg(thread).from) + " always gets through now"
                    : displayName(lastMsg(thread).from) + " is back to normal");
                  setTimeout(() => setToast(null), 2500);
                }}
              >VIP</button>
            </div>
          </div>

          {/* N2 and N6: a file in an inbox is a chore in a costume. An
              invoice with a real amount becomes a bill; a .ics becomes
              events; anything else he has to deal with becomes a task.
              Money is never guessed from a filename. */}
          {(() => {
            const m = lastMsg(thread);
            const offer = attachOffer({ from: displayName(m.from), subject: thread.subject, body: cleanBody(m.body), attachments: m.attachments });
            if (!offer || attachDone) return null;
            return (
              <div className="pad-x"><div className="card"><div className="row">
                <div className="row-grow">
                  <div className="conn-name">{offer.title}</div>
                  <div className="conn-meta">{offer.sub}</div>
                </div>
                <button className="pill-act" onClick={() => void (async () => {
                  if (offer.kind === "calendar") {
                    // The .ics goes to the phone's own calendar, which is the
                    // same handoff reminders already use and the only thing
                    // that can actually fire an alarm on iOS.
                    setToast("Open the attachment to add it · Your Calendar handles .ics");
                    setTimeout(() => setToast(null), 4000);
                    setAttachDone(true);
                    return;
                  }
                  if (!tasks) return;
                  if (offer.kind === "bill" && offer.amount != null) {
                    await tasks.createTask(offer.title, { bill: { amount: offer.amount }, source: madeBy("email", thread.id) });
                    setToast("Added to Money · $" + offer.amount.toLocaleString());
                  } else {
                    await tasks.createTask(offer.title, { source: madeBy("email", thread.id) });
                    setToast("Added to your tasks");
                  }
                  setAttachDone(true);
                  setTimeout(() => setToast(null), 3000);
                })()}>{offer.action}</button>
              </div></div></div>
            );
          })()}

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
      {/* Reserved column: read and unread rows share one text edge. */}
      <span className={"msg-dot" + (r.unread ? "" : " off")} aria-label={r.unread ? "unread" : undefined}></span>
      <div className="row-grow">
        <div className="msg-line">
          <span className={"conn-name truncate" + (r.unread ? " msg-strong" : "")}>{displayName(r.from)}</span>
          {/* N4: a VIP is marked where he reads, not buried in a setting. */}
          {isVip(r.fromEmail, vips) && <span className="msg-vip" aria-label="Always gets through">★</span>}
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
      <PageHeader title="Email" actions={<BarAction label="New Message" onClick={startCompose}><Plus className="ic" /></BarAction>} />
      {/* The hold. It is the whole point of undo-send that this is loud,
          reachable, and honest about what is happening: the message has NOT
          gone yet, and Undo puts him back in the composer where he was. */}
      {held && <SendHold startedAt={held.at} onUndo={undoSend} onNow={sendNow} />}
      {/* The tripwire, defused (2026-08-22): this row used to TURN THE
          FEATURE ON, one stray tap and the tab starts closing with no
          explanation. It opens the editor now; nothing closes until Start
          is tapped inside it, with every window on screen. When windows are
          already on, the same editor is one tap away for adjusting. */}
      <div className="pad-x">
        <button className="row-act" onClick={() => setEditWindows(true)}>
          {windows.on ? "Email Windows" : "Open Email on a Schedule"}
        </button>
      </div>
      {editWindows && !curtained && (
        <WindowsSheet
          initial={windows}
          onSave={applyWindows}
          onTurnOff={windows.on ? () => applyWindows({ ...windows, on: false }) : undefined}
          onClose={() => setEditWindows(false)}
        />
      )}
      <div className="pad-x">
        <input
          className="msg-input msg-search" placeholder="Search All Mail" value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!e.target.value.trim()) setResults(null);
          }}
          onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
        />
        {/* N11 (2026-08-20): the same box answers a different question. Search
            finds threads; this finds the sentence HE wrote, with the date. */}
        {search.trim() && ai.available && (
          <button className="row-act" disabled={saidBusy} onClick={() => void askWhatISaid()}>
            {saidBusy ? "Reading your sent mail…" : "What Did I Say About This?"}
          </button>
        )}
      </div>
      {said !== null && (
        <div className="pad-x"><div className="card">
          {said.length === 0 ? (
            <div className="row"><div className="row-grow"><div className="conn-meta">{saidEmpty("")}</div></div></div>
          ) : said.map((h, i) => (
            <div className="row" role="button" tabIndex={0} key={h.threadId + i} onClick={() => void openThread(h.threadId)}>
              <div className="row-grow">
                <div className="conn-name">&ldquo;{h.quote}&rdquo;</div>
                <div className="conn-meta">{h.dateISO} · {h.subject}</div>
              </div>
              <div className="chev" />
            </div>
          ))}
          <button className="row-act" onClick={() => setSaid(null)}>Clear</button>
        </div></div>
      )}
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
      {showTriage && needsYou.length > 0 && (
        <div className="pad-x deck-cta">
          <div className="promo-card">
            <div className="promo-head">
              <div className="promo-badge b-red"><svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg></div>
              <div className="promo-body">
                <div className="promo-title">{needsYou.length === 1 ? "1 Thread Needs You" : `${needsYou.length} Threads Need You`}</div>
                <div className="promo-sub">Everything else is filed below.</div>
              </div>
            </div>
            {!drainOpen ? (
              <div className="promo-acts">
                <button className="promo-pill quiet" onClick={() => setDrainOpen(true)}>Only have a few minutes?</button>
                <button className="promo-pill" onClick={() => { setDeckRows(needsYou); setView("deck"); }}>Deal With It</button>
              </div>
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
                <div className="promo-acts">
                  <button className="promo-pill" onClick={() => {
                    saveMinutes(minutes);
                    setDrainMs(minutes * 60000);
                    setDeckRows(needsYou);
                    setDrainOpen(false);
                    setView("deck");
                  }}>Start the Drain</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {error && <div className="pad-x conn-error">{error}</div>}
      {searching && <div className="pad-x conn-status">Searching everything...</div>}

      {filter === "drafts" ? (
        loading && !draftsLoaded ? (
          <div className="pad-x"><div className="card"><div className="empty-state"><div className="empty-title">Loading...</div></div></div></div>
        ) : drafts.length === 0 ? (
          <div className="pad-x"><div className="card"><div className="empty-state">
            <div className="empty-icon"><Mail className="ic" /></div>
            <div className="empty-title">No Drafts</div>
          </div></div></div>
        ) : (
          <div><div className="list-flat">
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
            <div className="empty-title">Couldn’t Sort Your Mail</div>
            <div className="empty-sub">Nothing lost · All still here</div>
            {triageWhy && <div className="msg-guard">{triageWhy}</div>}
            <div className="conn-action">
              <button className="btn btn-secondary btn-block" onClick={() => setFilter("all")}>Show All Mail</button>
            </div>
          </div></div></div>
        ) : (
          <div className="pad-x"><div className="card"><div className="empty-state">
            <div className="empty-icon"><Mail className="ic" /></div>
            <div className="empty-title">Reading Your Inbox</div>
            <div className="empty-sub">Sorting your mail</div>
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
          <div><div className="list-flat">{listRows.map((r) => threadRow(r))}</div></div>
        )
      ) : (
        <>
          {rows.length === 0 && (
            <div className="pad-x"><div className="card"><div className="empty-state">
              <div className="empty-icon"><Mail className="ic" /></div>
              <div className="empty-title">Inbox Is Quiet</div>
            </div></div></div>
          )}
          {/* N12 (2026-08-20): thirty seconds of speech for the car or the gym.
              It says the SAME things the cards say, and never reads a body
              aloud: a private message read out with other people in the car
              is a real harm and nothing here is worth it. */}
          {needsYou.length > 0 && canSpeak() && (
            <div className="pad-x"><div className="card"><div className="row">
              <div className="row-grow">
                <div className="conn-name">Read It to Me</div>
                <div className="conn-meta">Senders and gists only · Never the message</div>
              </div>
              <button className="pill-act" onClick={() => {
                if (speaking) { stopSpeaking(); setSpeaking(false); return; }
                const notices = mailNotices(loadMailSnapshot(), new Date().toISOString().slice(0, 10));
                setSpeaking(speak(speakable(notices, inboxSentence(notices, loadMailSnapshot()))));
              }}>{speaking ? "Stop" : "Play"}</button>
            </div></div></div>
          )}

          {/* N14: once a week, everything nobody chased. Needs-you is NEVER
              in the set, whatever its age, and neither is unsorted mail:
              not having read something is not evidence about it. */}
          {(() => {
            if (closeDone || !closeDue(new Date().toISOString().slice(0, 10), lastClose())) return null;
            const set = closeCandidates(unmutedRows, effTriage, vips, Date.now());
            if (set.count === 0) return null;
            return (
              <div className="pad-x"><div className="card"><div className="row">
                <div className="row-grow">
                  <div className="conn-name">{closeLine(set)}</div>
                  <div className="conn-meta">Older than a fortnight · Archive, never delete</div>
                </div>
                <button className="pill-act" onClick={() => void (async () => {
                  const ids = set.ids;
                  setRows((rs) => rs.filter((r) => !ids.includes(r.id)));
                  markClosed(new Date().toISOString().slice(0, 10));
                  setCloseDone(true);
                  await Promise.all(ids.map((id) => apiFor(accountOfThread(id))?.modifyThread(id, [], ["INBOX"]).catch(() => {})));
                  setToast(closeReceipt(set));
                  setTimeout(() => setToast(null), 4000);
                })()}>Close It Out</button>
              </div></div></div>
            );
          })()}

          {needsYou.length > 0 && (
            <>
              <div className="sh2"><span className="t">Needs You</span></div>
              <div><div className="list-flat">
                {needsYou.map((r) => threadRow(r, effTriage[r.id]?.gist))}
              </div></div>
            </>
          )}
          {waiting.length > 0 && (() => {
            // Dave, 2026-08-21: "Email buttons suck. Make them useful."
            // They were useless for two reasons, both visible here.
            //
            // One: every thread in a real inbox is weeks old, so every row
            // hit the top rung and five rows wore the same button. Now the
            // top rung splits on whether a phone number exists, so a Call
            // dials and an Ask To Call admits it is writing an email.
            //
            // Two: the reason ("Email isn't working here") was printed on
            // every row. A sentence that is true of the whole section is
            // said once, by the section.
            // THE ASK DECIDES THE ACTION (2026-08-21, Dave: "the email buttons
            // are not working properly they will all say the exact same action
            // instead of appropriate ones"). Every row in a real inbox is weeks
            // old, so a ladder keyed on the WAIT put every row on the same rung
            // and printed the same button four times. The wait now sets the
            // tone of the draft; what you are OWED sets the button.
            const rungs = waiting.map((w) => ({ w, d: decideFor(w) }));
            // A receipt owes you nothing and was never a thread you are waiting
            // on. It leaves the list rather than wearing a button that lies.
            const owed = rungs.filter((r) => r.d.ask !== "nothing");
            const unowed = rungs.filter((r) => r.d.ask === "nothing");
            const allTop = owed.length > 0 && owed.every((r) => r.d.tone === "firm");
            return (
            <>
              <div className="sh2"><span className="t">Waiting On</span></div>
              {allTop && (
                <div className="pad-x conn-meta wait-why">
                  All of these are past the point where another email helps.
                </div>
              )}
              <div><div className="list-flat">
                {owed.map(({ w, d }) => (
                  <LetGoSwipe
                    key={w.threadId}
                    onMore={d.alternates.length ? () => setMore({ row: w, d }) : undefined}
                    onLetGo={() => dropRow(w.threadId)}
                  >
                  <div className="row" role="button" tabIndex={0} onClick={() => void startNudge(w)}>
                    <span className="msg-dot off"></span>
                    <div className="row-grow">
                      <div className="msg-line">
                        <span className="conn-name truncate">{displayName(w.to)}</span>
                        {/* Age as severity: the number was always there and
                            said nothing. Past the point email helps, it reads
                            hot. */}
                        <span className={"mail-age" + (d.tone === "firm" ? " hot" : d.tone === "direct" ? " warm" : "")}>{w.waitingDays}d</span>
                        <span className="pill-act">{nudging === w.threadId ? "Drafting…" : d.primary.label}</span>
                      </div>
                      <div className="conn-meta msg-gist">
                        {w.subject} · {waitingLine(w, opens[w.threadId] ?? null)}
                        {g.accounts.length > 1 && w.account && <span className="msg-acct">{acctLabel(w.account)}</span>}
                      </div>
                    </div>
                  </div>
                  </LetGoSwipe>
                ))}
              </div></div>
              {/* Nothing is owed on these, so they get their own quiet band
                  and an honest button instead of sitting in Waiting On
                  pretending somebody is late. */}
              {unowed.length > 0 && (
                <>
                  <div className="sh2"><span className="t">Nothing Owed</span><span className="n">{unowed.length}</span></div>
                  <div><div className="list-flat">
                    {unowed.map(({ w, d }) => (
                      <LetGoSwipe
                        key={w.threadId}
                        onMore={d.alternates.length ? () => setMore({ row: w, d }) : undefined}
                        onLetGo={() => dropRow(w.threadId)}
                      >
                      <div className="row" role="button" tabIndex={0} onClick={() => dropRow(w.threadId)}>
                        <span className="msg-dot off"></span>
                        <div className="row-grow">
                          <div className="msg-line">
                            <span className="conn-name truncate">{displayName(w.to)}</span>
                            <span className="pill-act">{d.primary.label}</span>
                          </div>
                          <div className="conn-meta msg-gist">{w.subject} · a receipt needs no reply</div>
                        </div>
                      </div>
                      </LetGoSwipe>
                    ))}
                  </div></div>
                </>
              )}
            </>
            );
          })()}
          {/* THE FOLD. Everything that does not need Dave collapses to one
              line. Worth Knowing and Noise live behind it and expand in
              place, so the tab is never a scroll of mail he did not ask for. */}
          {restCount > 0 && (
            <div className="pad-x msg-fold">
              <div className="card">
                <div className="row" role="button" tabIndex={0} onClick={() => setRestOpen(!restOpen)}>
                  <div className="row-grow">
                    <div className="conn-name">The Rest</div>
                    <div className="conn-meta msg-gist">
                      {"Nothing waiting on you"}
                    </div>
                  </div>
                  {/* V2 anatomy: the count is a pill, never buried in the line. */}
                  <span className="pill pill-subdued">{restCount}</span>
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
                            <div className="conn-name">{capAfterNumber(noise.length === 1 ? "1 automated email" : noise.length + " automated emails")}</div>
                            <div className="conn-meta msg-gist">{noiseLine(noise)}</div>
                          </div>
                        </div>
                        {/* N5 (2026-08-20): a sender who writes six times a
                            week about things he will never act on is not six
                            decisions. It is one, repeated. Collapsing is
                            presentation only: nothing is archived or filed,
                            and only NOISE ever collapses. */}
                        {noiseOpen && (() => {
                          const { groups, loose } = collapseNoise(noise);
                          return (
                            <>
                              {groups.map((g) => (
                                <div key={g.key}>
                                  <div className="row" role="button" tabIndex={0} onClick={() => setNoiseGroups((s) => ({ ...s, [g.key]: !s[g.key] }))}>
                                    <div className="row-grow">
                                      <div className="conn-name">{g.from}</div>
                                      <div className="conn-meta msg-gist">{collapseLine(g)}</div>
                                    </div>
                                    <button className="pill-act" onClick={(e) => { e.stopPropagation(); void archiveAllNoise(g.rows); }}>Archive All</button>
                                  </div>
                                  {noiseGroups[g.key] && g.rows.map((r) => threadRow(r, effTriage[r.id]?.gist))}
                                </div>
                              ))}
                              {loose.map((r) => threadRow(r, effTriage[r.id]?.gist))}
                            </>
                          );
                        })()}
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
          {/* N9 (2026-08-20): the BATCH version of self-cleaning, and it does
              the better thing. Filing hides mail; unsubscribing ends it. Only
              senders he has already thrown away by hand, asked once each,
              and it NEVER claims it worked: some senders ignore the header,
              and a false receipt is worse than no receipt. */}
          {sweep.length > 1 && !toss ? (
            <div className="pad-x offer-row">
              <div className="card"><div className="row"><div className="row-grow">
                <div className="conn-name">{sweepTitle(sweep)}</div>
                <div className="conn-meta msg-offer-line">{sweepSub(sweep)}</div>
              </div></div></div>
              <button
                className="btn btn-primary btn-block"
                onClick={() => {
                  let ended = 0;
                  let filed = 0;
                  for (const c of sweep) {
                    markAsked(c.sender);
                    if (c.canUnsub) {
                      const u = unsubbable[c.sender];
                      if (u) { void requestUnsub(u); ended++; continue; }
                    }
                    setRules(saveRule(c.sender, "noise"));
                    filed++;
                  }
                  setSweep([]);
                  setToast(sweepReceipt(ended, filed));
                  setTimeout(() => setToast(null), 4000);
                }}
              >{sweepSub(sweep)}</button>
              <button className="quiet-action" onClick={() => { sweep.forEach((c) => markAsked(c.sender)); setSweep([]); }}>Leave them</button>
            </div>
          ) : toss ? (
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
                  setToast("Straight to Noise from now on");
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
      {/* Everything else this thread could become, one swipe from the row. */}
      {more && (
        <MailMoreSheet
          who={displayName(more.row.to)}
          subject={more.row.subject ?? ""}
          days={more.row.waitingDays}
          decision={more.d}
          onPick={(a) => void runAction(more.row, a)}
          onClose={() => setMore(null)}
        />
      )}
    </div>
  );
}

// The send hold, counting down. Deliberately a bar and not a toast: a toast
// that vanishes while he is still deciding is the same as not offering undo.
function SendHold({ startedAt, onUndo, onNow }: { startedAt: number; onUndo: () => void; onNow: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((startedAt + HOLD_SECONDS * 1000 - now) / 1000));
  return (
    <div className="pad-x">
      <div className="card send-hold">
        <div className="row">
          <div className="row-glyph cat-fg-blue"><Send className="ic" /></div>
          <div className="row-grow">
            <div className="conn-name">{left > 0 ? "Sending in " + left : "Sending"}</div>
            <div className="conn-meta">Nothing has left yet</div>
          </div>
          <button className="pill-act" onClick={onUndo}>Undo</button>
        </div>
        <div className="row row-acts">
          <button className="btn-sm" onClick={onNow}>Send Now</button>
        </div>
      </div>
    </div>
  );
}
