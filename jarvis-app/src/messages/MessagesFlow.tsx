import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { lazyWithRecovery } from "../shell/chunkRecovery";
import PageHeader, { BarAction } from "../shared/PageHeader";
import { Mail, Plus, Archive, Trash2, CornerUpLeft, Forward, Send, Tag, Clock, MessageSquare, Volume2 } from "../shared/icons";
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
import { shortDateFromMs } from "../shared/dateFormat";
import { findWaiting, waitingLine, nudgePrompt, type WaitingRow } from "./waiting";
import { loadTracks, saveTrack, trackForThread, newTrackId, pixelUrlFor, registerTrack, checkOpens } from "./tracking";
import { loadNetted, saveNetted, netCandidates, guardLine, seedFirstRun } from "./safetyNet";
import { madeBy } from "../shared/provenance";
import { effectiveLevel } from "../ai/aiGate";
import { getAIControl } from "../ai/levelStore";
import { cleanBody, isLong, leadIn, wordCount } from "./bodyText";
import MailHtmlView from "./MailHtmlView";
import { recordToss, markAsked, tossOffer, tossLine, loadTossed, loadAsked } from "./selfClean";
import { sweepCandidates, sweepTitle, sweepSub, sweepReceipt, type SweepCandidate } from "./unsubSweep";
import { PRESETS, loadMinutes, saveMinutes, clampMinutes } from "./drain";
import { handoffTargets, defaultNote, handoffPrompt, forwardSubject, handoffLine, type HandoffTarget } from "./handoff";
import { COMMITMENT_SYSTEM, commitmentPrompt, parseCommitment, alreadyPromised, markPromised, commitmentLine, loadPromised } from "./commitments";
import { saveMailSnapshot, mailNotices, loadMailSnapshot, byLabel, type MailMeeting } from "./home";
import { settleAll, settleLine, type SettleWords } from "./settle";
import { recordSweepDay, loadSweepDays, streakView, receiptLines, sweepEstimate, type SweepReceipts } from "./sweep";
import ListFloor from "../shared/ListFloor";
import { senderPiles, selectedCount, selectedIds, purgeLabel, purgePromise, defaultPicks } from "./purge";
import { readIcs } from "./ics";
import { isNoReply, isBulk , isMachineAddress } from "./noReply";
import { humanError } from "../connections/google/humanError";
import { aiFailureLine } from "../ai/failureLine";
import { endOfAct } from "./mailAct";
import { dayPhrase, monthDay } from "../money/bills";
import { Head, Card } from "../settings/kit";

// The words every mail-archive receipt uses, in one place, because the four
// batch sites used to phrase the same outcome four ways.
const ARCHIVE_WORDS: SettleWords = {
  one: "conversation", many: "conversations",
  did: "archived", doing: "archive", stuck: "still in your inbox",
};

// For an Undo that could not put everything back. An undo that silently fails
// is worse than no undo: the rows return to the list and the mail does not.
const DELETE_WORDS: SettleWords = {
  one: "conversation", many: "conversations",
  did: "in the trash", doing: "delete", stuck: "still in your inbox",
};

// Undo on a delete: the mail comes BACK, so the words are about return.
const UNTRASH_WORDS: SettleWords = {
  one: "conversation", many: "conversations",
  did: "back in your inbox", doing: "put those back", stuck: "still in the trash",
};

const RESTORE_WORDS: SettleWords = {
  one: "conversation", many: "conversations",
  did: "back in your inbox", doing: "put those back", stuck: "still archived in Gmail",
};
import { inboxSentence } from "./inboxBrief";
import { dueChases, loadChases, clearChase, setChase, CHASE_DAYS, CHASE_DEFAULT } from "./followUp";
import { loadVips, toggleVip, isVip, applyVips, vipLine, VIP_MAX } from "./vip";
import { collapseNoise, collapseLine } from "./collapse";
import { loadNudgeCounts, countNudge } from "./escalate";
import { decide, type Decision, type MailAction } from "./mailAction";
import MailMoreSheet from "./MailMoreSheet";
import { phoneBook, phoneFor, telLink, smsLink, colleagueBook, altFor, firstName,
  type PhoneBook, type Colleague } from "./reachBy";
import { nameBook, nameFor, prettyHandle, type NameBook, displayName } from "./names";
import { clearedToday, bumpCleared, closeOut } from "./cleared";
import { railClass, railToneForWaiting, railToneForDeadline, ageBands, showBandHeads } from "./rows";
import { DEFAULT_ANSWERS } from "./quickAnswers";
import { loadLetGo, letGo, undoLetGo } from "./letGo";
import { closeCandidates, closeLine, amnestyDue, amnestyLine, amnestyPromise, markClosed, lastClose } from "./weeklyClose";
import { speakable, canSpeak, speak, stopSpeaking } from "./readAloud";
import { attachOffer, amountIn } from "./attachmentKind";
import { HOLD_SECONDS } from "./outbox";
import { loadWindows, saveWindows, isOpenNow, closedLine, peekLine, type WindowSettings } from "./batching";
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
const DemoMail = __DEMO_SEED__ ? lazyWithRecovery(() => import("./DemoMail")) : null;
import { noDashes } from "../ai/suggestions";
import { useOptionalAIContext } from "../ai/useAIContext";
import { voiceToText } from "../ai/context";
import { useOptionalTasks, useOptionalSchedule, useOptionalPeople, useOptionalProfile, useOptionalNotes, useOptionalProjects, useOptionalRoutine } from "../data/NotesProvider";
import { b64urlDecodeBytes } from "../connections/google/map";
import { capAfterNumber } from "../shared/casing";

type Draft = { to: string; subject: string; body: string; inReplyTo?: string; threadId?: string; fromDeck?: boolean; account?: string; handoffTo?: string };
type DraftRow = { id: string; to: string; subject: string; snippet: string; dateMs?: number; threadId?: string };
type View = "list" | "detail" | "compose" | "deck" | "dead" | "rules" | "purge";
type Filter = "triage" | "all" | "drafts";
type Outcome = "needs" | "waiting" | "owed";
let lastOutcome: Outcome = "needs";
const OUTCOME_LABEL: Record<Outcome, string> = { needs: "Needs You", waiting: "Waiting On", owed: "Nothing Owed" };
// The selection, or the first outcome that has anything when the selected
// one is empty. The same rule the switch draws by, so the two agree.
function outcomeShown<W>(sel: Outcome, needsYou: unknown[], waiting: W[], decide: (w: W) => { ask: string }): Outcome | null {
  const owed = waiting.filter((w) => decide(w).ask !== "nothing").length;
  const unowed = waiting.length - owed;
  const counts: Record<Outcome, number> = { needs: needsYou.length, waiting: owed, owed: unowed };
  if (counts[sel] > 0) return sel;
  return (["needs", "waiting", "owed"] as Outcome[]).find((o) => counts[o] > 0) ?? null;
}
type TriageState = "idle" | "pending" | "ready" | "failed";

// One recipient's name, or "3 people" when a draft has several. The raw To
// header is a transport artefact and never belongs in a name slot.
function draftTo(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return "(no recipient)";
  const parts = t.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) return parts.length + " people";
  const one = parts[0]!;
  const m = one.match(/^(.*?)\s*<.*>$/);
  return displayName(m?.[1] ?? one) || one;
}

// 8A: a stable warm color per sender, drawn from the category fills so the
// on-color contrast is already held at 4.5:1 by a law test. Red is absent on
// purpose: red is a verb (L1), never an identity.
const FACE_SLOTS = ["yellow", "sky", "green", "orange", "teal", "pink", "purple", "blue"] as const;
export function faceSlot(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return FACE_SLOTS[h % FACE_SLOTS.length]!;
}

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

// E9 (2026-08-24): this was a second copy of quickAnswers' DEFAULT_ANSWERS,
// identical today and free to drift tomorrow. One list now.

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
  return shortDateFromMs(ms);
}

// Email (rebuild, session Email 1): not an inbox, a status report. One AI
// pass buckets every thread (needs you / worth knowing / noise) with a gist,
// so junk is never opened. The headline counts what needs Dave, never unread.
// Threads are the unit throughout; search is server-side over the whole
// mailbox. Without AI the tab is an honest threaded list, no fake triage.
export default function MessagesFlow({ ai, configured = googleConfigured(), token, onOpenConnections , demoMail = false, openThreadId, openDraftId }: { demoMail?: boolean; ai: AIService; configured?: boolean; token?: string; onOpenConnections?: () => void; openThreadId?: string; openDraftId?: string }) {
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
  // A PUSHED SCREEN STARTS AT THE TOP (2026-08-25, caught by a browser walk
  // of the Clean Out). Nothing in the app resets scroll between views, so
  // opening a screen from a link at the FOOT of a long list lands you
  // already scrolled past its first rows. On the Clean Out that is fatal to
  // the whole design: it sorts biggest-offender-first, and the two senders
  // worth deciding about first were the two hidden under the nav bar.
  //
  // Pushing goes to the top; popping back to the list deliberately does NOT,
  // because returning to where you were is the point of going back. That is
  // the iOS push/pop contract, and it is the reason this is not just a blunt
  // reset on every change.
  //
  // SCOPED TO EMAIL, AND THAT TURNS OUT TO BE THE RIGHT SCOPE.
  //
  // An earlier version of this note claimed the bug was app-wide, reasoning
  // that one shared .app-scroll stays mounted and nothing resets it, so a
  // tab switch must inherit the previous screen's offset. That was read off
  // the code and never measured, and measuring it says otherwise: scroll
  // Schedule to 400 and tap Today, and Today lands at 0 with 1631px of room
  // it could have carried into. Switching tabs swaps the screen INSIDE this
  // container, and the height collapsing through zero during the swap
  // resets the offset for free.
  //
  // The real distinction is mount, not container. A TAB change unmounts the
  // old screen and resets by accident. A VIEW change inside one flow keeps
  // the same component mounted, so the offset survives, which is exactly
  // how the Clean Out arrived scrolled past its top two senders.
  //
  // So this belongs here, in the flow that changes views without
  // unmounting, and there is no app-wide fix owed. Other multi-view flows
  // have the same shape and have not been measured; if one of them is ever
  // reached from a link low on a long list, it will want this same effect.
  useEffect(() => {
    if (view === "list") return;
    const el = document.querySelector(".app-scroll");
    if (el) el.scrollTop = 0; else window.scrollTo(0, 0);
  }, [view]);
  const [rows, setRows] = useState<ThreadRow[]>([]);
  const [triage, setTriage] = useState<TriageMap>({});
  const [triaged, setTriaged] = useState(false);
  // Never show the wall: For You has three honest states besides "ready".
  // The fallback for a failed sort is a calm screen with one way out, never
  // the raw list dumped back in Dave's face.
  const [triageState, setTriageState] = useState<TriageState>("idle");
  // E13 (2026-08-23): how much of the sort is done. Not a guess and not a
  // fake bar: `triageDelta` already says exactly how many threads need
  // sorting, and the loop below already runs them in batches of
  // TRIAGE_BATCH, so both numbers were sitting there unread.
  const [sortProg, setSortProg] = useState<{ done: number; total: number } | null>(null);
  const [triageWhy, setTriageWhy] = useState<string>("");
  // How each message's body is shown: as sent (the mail's own layout, when
  // it has one), the text lead-in, or the whole text. Unset means the
  // default for that message: as sent when it can be, else the lead-in.
  const [bodyMode, setBodyMode] = useState<Record<string, "sent" | "text" | "full">>({});
  const [restOpen, setRestOpen] = useState(false);
  // E10 (2026-08-24): select mode for the fold. Null when off; a set of
  // thread ids when on. Scoped to Worth Knowing and Noise on purpose: bulk
  // matters most where the count is highest and the stakes are lowest, and a
  // multi-select on Needs You would be a tool for ignoring things that need
  // you.
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  // 11A: the Clean Out screen's selection, keyed by SENDER rather than by
  // thread. Nobody wants to make four hundred decisions; everybody can make
  // eight.
  const [purgePicks, setPurgePicks] = useState<ReadonlySet<string> | null>(null);
  const [purging, setPurging] = useState(false);
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
  const [deadStats, setDeadStats] = useState<{ n: number; ms: number; receipts: SweepReceipts } | null>(null);
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
  const [attachBusy, setAttachBusy] = useState(false);
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
  // Real names for the addresses on Waiting On rows. Same list, same load,
  // one more book: a row that says "jrubino" is a row you have to decode.
  const [names, setNames] = useState<NameBook>({ byEmail: {} });
  // E12: what actually got cleared today, counted where the archives happen.
  const clearedKey = todayISO();
  const [cleared, setCleared] = useState<number>(() => clearedToday(clearedKey));
  const countCleared = (n: number) => setCleared(bumpCleared(clearedKey, n));
  // The rest of the moves for one Waiting On row, opened from its swipe.
  const [more, setMore] = useState<{ row: WaitingRow & { account?: string }; d: Decision } | null>(null);
  // E6 (2026-08-24): Waiting On, one decision at a time. An index into the
  // owed list, or null for the list view. Not a copy of the rows: Let It Go
  // shrinks the list under the index and the next card simply surfaces.
  const [waitDeck, setWaitDeck] = useState<number | null>(null);
  const [nudging, setNudging] = useState<string | null>(null);
  const [acctFilter, setAcctFilter] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  // No AI build: there is no For You chip at all, so the tab opens on All.
  const [filter, setFilter] = useState<Filter>(ai.available ? "triage" : "all");
  // THE OUTCOME SWITCH (ruled 2026-09-01: "a segmented switch across the top
  // for the outcome sections"). For You showed Needs You, Waiting On and
  // Nothing Owed stacked down one screen; it shows one at a time now, the
  // switch says which and how many, and The Rest stays the one row under
  // it. Remembered within the session, reset on launch.
  const [outcome, setOutcome] = useState<Outcome>(lastOutcome);
  const pickOutcome = (o: Outcome) => { lastOutcome = o; setOutcome(o); };
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ThreadRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadFull | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [replies, setReplies] = useState<string[]>(DEFAULT_ANSWERS);
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
    setSortProg({ done: 0, total: delta.length });
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
            // The raw AI response body used to land here and render under
            // "Couldn't Sort Your Mail", cut off mid-JSON at 140 characters
            // (2026-08-25).
            // 2026-09-02: the proxy's 502 used to read as "Google's mail
            // service is having trouble" (humanError knows only Gmail).
            // The sort is the AI proxy; say what its upstream said.
            lastErr = aiFailureLine(e, "The sort didn't come back");
          }
        }
        // A batch that failed is still a batch that is no longer pending, so
        // the count moves either way. It measures work attempted, not work
        // that succeeded, and a stuck number would be the lie here.
        setSortProg({ done: Math.min(i + batch.length, delta.length), total: delta.length });
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
      // Cleared on every exit path, including the early return above, so a
      // sort that died never leaves a strip claiming it is still working.
      setSortProg(null);
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
      setError(humanError(e, "Could not load mail"));
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
    const todayIso = todayISO();
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
        [{ role: "user", content: sweepPrompt(items.slice(0, 8), todayISO()) }],
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
          setNames(nameBook(list));
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
    countCleared(1);
    say(said, { label: "Undo", run: () => {
      undoLetGo(threadId);
      void loadWaiting();
    } });
  };

  // E14 (2026-08-23): the one batch move that is safe on this list.
  //
  // A Nothing Owed row is a receipt: `decideFor(w).ask === "nothing"` is the
  // whole definition of the section. Archiving them owes nobody a reply and
  // sends nobody an email, which is exactly why Waiting On does NOT get a
  // head verb: the batch move there would be sending six real emails on one
  // tap. One Undo covers the whole batch.
  //
  // B3-1 (2026-09-04): this used to only clear local state and call letGo,
  // which letGo.ts's own header is explicit is NOT archiving ("the mail is
  // untouched. It only says stop counting the days on this one"). The button
  // reads "Archive These" and the receipt said "N cleared"; every one of
  // those conversations stayed in the Gmail inbox. Now it makes the same
  // real modifyThread call archivePicked already makes on the general inbox
  // list, counted the same honest way, with an Undo that puts INBOX back.
  const dropAll = async (rows: (WaitingRow & { account?: string })[]) => {
    if (!rows.length) return;
    const ids = new Set(rows.map((w) => w.threadId));
    setWaiting((ws) => ws.filter((x) => !ids.has(x.threadId)));
    const { failed } = await settleAll(rows, (w) => apiFor(w.account)?.modifyThread(w.threadId, [], ["INBOX"]));
    if (failed.length) setWaiting((ws) => [...failed, ...ws]);
    countCleared(rows.length - failed.length);
    say(capAfterNumber(settleLine(rows.length - failed.length, failed.length, ARCHIVE_WORDS)), {
      label: "Undo",
      run: () => void (async () => {
        setWaiting((ws) => [...rows, ...ws]);
        const back = await settleAll(rows, (w) => apiFor(w.account)?.modifyThread(w.threadId, ["INBOX"], []));
        if (back.failed.length) say(settleLine(back.ok.length, back.failed.length, RESTORE_WORDS));
        void loadWaiting();
      })(),
    });
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
    // A THROW USED TO CLOSE THE SHEET AND SAY NOTHING (2026-08-25). This is
    // called as `void runAction(...)`, so a rejected write produced an
    // unhandled rejection and the only observable effect of tapping "Add as
    // Bill" was the sheet disappearing.
    //
    // The switch stays INSIDE this function rather than moving to a helper: a
    // law test scans runAction's own body for a case per action key, and a
    // split put every case out of its reach.
    try {
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
        // Silent returns, both of them (2026-08-25). A label that promises
        // "Files it under Money" may not answer a tap with nothing.
        if (!tasks) { say("Tasks aren't available right now"); return; }
        if (amount == null) { say("No amount in that one · Nothing to file"); return; }
        const id = await tasks.createTask(laterTaskTitle(displayName(row.to), row.subject ?? ""), {
          bill: { amount },
          source: madeBy("email", row.threadId),
        });
        // toFixed, not toLocaleString: the latter drops the trailing cent, so
        // $1,234.50 was printing as $1,234.5 on every money receipt.
        say(id ? "Added to Money · $" + amount.toFixed(2) : "Couldn't file it · Nothing was saved");
        return;
      }
      case "add_task": {
        if (!tasks) { say("Tasks aren't available right now"); return; }
        const id = await tasks.createTask(laterTaskTitle(displayName(row.to), row.subject ?? ""), {
          due: todayISO(),
          source: madeBy("email", row.threadId),
        });
        say(id ? "Added to your tasks" : "Couldn't add it · Nothing was saved");
        return;
      }
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
        // fmtTime returns { time, ap }, not a string. Concatenating it raw
        // printed "Booked [object Object] · 30 min" (2026-08-25); this was
        // the only site in the app that did not destructure it.
        say(id
          ? (slot.date === today ? "Booked " : "Booked tomorrow ") + fmtTime(slot.start).time + " " + fmtTime(slot.start).ap + " · " + BOOK_MIN + " min"
          : "Couldn't book that");
        return;
      }
      default:
        // Everything left is a draft or a dial, and startNudge knows the
        // difference from the action's own channel.
        await startNudge(row, a);
    }
    } catch {
      say("Couldn't save · Nothing was lost");
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
      setError(humanError(e, "Could not load drafts"));
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

  // "Finish It" lands HERE, in the draft, with the unsent words loaded
  // (2026-08-25). It used to hand a draft id to the thread jump above, which
  // found no matching row and returned silently.
  const jumpedDraft = useRef<string | null>(null);
  useEffect(() => {
    if (!openDraftId) return;
    if (jumpedDraft.current === openDraftId) return;
    jumpedDraft.current = openDraftId;
    void openDraft(openDraftId);
  }, [openDraftId]);

  // THE HOME SNAPSHOT (Dave 2026-08-20). Today must render instantly, so it
  // never touches Gmail: the Email tab leaves behind everything the home page
  // needs the moment it knows it. Sender, subject, gist and the deadline the
  // sender stated, plus who owes him a reply and what he promised. See
  // messages/home.ts for what the home page does with it.
  //
  // B6-8 (2026-09-04): "Demo email fixtures show on the real home page."
  // rows.length === 0 used to gate this write too, on top of triaged. Before
  // triage settles, rows really is empty AND triaged is still false, so
  // triaged alone already covers "still loading." But a real, connected
  // account whose inbox is genuinely empty also reaches triaged === true
  // with rows.length === 0 (runTriage's cache-hit branch sets it regardless
  // of how many rows it triaged), and the old guard treated that exactly
  // like still-loading: it never wrote the honest empty snapshot, so
  // DemoMail's fixture snapshot (written before any real account connected)
  // sat there looking current, with live Add Task and Reply buttons on
  // threads that were never real, until its 36-hour TTL happened to expire.
  // triaged is the real signal here; rows.length was never doing anything
  // triaged didn't already cover, except this.
  useEffect(() => {
    if (!triaged) return;
    const todayIso = todayISO();
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
        // Unresolved on purpose: mailNotices validates it against the day it
        // is actually being read on, not the day this snapshot was written.
        act: map[r.id]?.act,
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
          .createTask(laterTaskTitle(r.from, r.subject), { due: todayISO(), source: madeBy("email", r.id) })
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
      setError(humanError(e, "Could not connect"));
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
      setError(humanError(e, "Search failed"));
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
            // The INSTANT, read as a local calendar day. This used to parse
            // the raw Date header and re-serialize it through UTC, so a mail
            // sent at 8:40 PM ET on the 19th was filed and shown as the 20th
            // (2026-08-25). It now takes dateMs and todayISO, which is the
            // app's own local-day function.
            dateISO: todayISO(mine.dateMs ? new Date(mine.dateMs) : new Date()),
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
    setReplies(DEFAULT_ANSWERS);
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
      // Deliberately unreported. Nothing on screen claims the thread was
      // marked read, so a failure here costs a bold row and nothing else.
      // Routed through settleAll so the choice is visible rather than an
      // empty catch that reads like every other one that WAS a bug.
      void settleAll([id], () => api.modifyThread(id, [], ["UNREAD"]));
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
      setError(humanError(e, "Could not open conversation"));
    }
  };

  // Attachments open in a new tab (or download when the browser can't render
  // the type). Bytes travel Gmail -> this device only, nothing is uploaded.
  // Fetch a .ics and read it. Separate from openAttachment because that one
  // hands the bytes to the browser to download; this one keeps them.
  const readIcsAttachment = async (messageId: string, attachmentId?: string) => {
    if (!attachmentId) return null;
    const api = apiFor(thread ? accountOfThread(thread.id) : undefined);
    if (!api) return null;
    try {
      const { data } = await api.getAttachment(messageId, attachmentId);
      const bytes = b64urlDecodeBytes(data);
      if (bytes.length === 0) return null;
      return readIcs(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  };

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

  const sweepSender = async (fromEmail: string) => {
    const hit = rows.filter((r) => r.fromEmail.toLowerCase() === fromEmail.toLowerCase());
    if (hit.length === 0) return;
    setRows((rs) => rs.filter((r) => r.fromEmail.toLowerCase() !== fromEmail.toLowerCase()));
    setView("list");
    // COUNTED, NOT ASSUMED (2026-08-25). This printed hit.length archived
    // while every failure went into an empty catch, so a sender whose sweep
    // half-failed reported a clean number and the rest came back on the next
    // load. The rows that did not move go back in the list where they were.
    const { ok, failed } = await settleAll(hit, (r) => apiFor(r.account)?.modifyThread(r.id, [], ["INBOX"]));
    // One act per thread that actually moved (handoff item 1). Counted from
    // `ok`, never from the attempt: the log records what happened.
    for (let i = 0; i < ok.length; i++) emit({ type: "email.handled", props: { kind: "sweep" } });
    if (failed.length) setRows((rs) => [...failed, ...rs.filter((x) => !failed.some((f) => f.id === x.id))].sort((a, b) => b.dateMs - a.dateMs));
    say(settleLine(ok.length, failed.length, ARCHIVE_WORDS), ok.length ? {
      label: "Undo",
      run: () => {
        void (async () => {
          setRows((rs) => [...ok, ...rs].sort((a, b) => b.dateMs - a.dateMs));
          const back = await settleAll(ok, (r) => apiFor(r.account)?.modifyThread(r.id, ["INBOX"], []));
          if (back.failed.length) say(settleLine(back.ok.length, back.failed.length, RESTORE_WORDS));
        })();
      },
    } : undefined);
  };

  // Unsubscribe using the sender's own header. mailto is sent (on this tap);
  // an http endpoint is opened, because only the sender's page can finish it.
  // The receipt never claims success: some senders ignore it.
  const doUnsub = async (t: ThreadFull) => {
    const m = lastMsg(t);
    const u = parseUnsub(m.listUnsubscribe, m.listUnsubscribePost);
    if (!u) return;
    // The receipt was careful not to claim the sender would comply, and then
    // claimed the REQUEST was made whether or not it was (2026-08-25): the
    // send failure went into an empty catch and window.open's null was never
    // read. Both are now the thing the receipt is about.
    let sent: boolean;
    if (u.kind === "mailto") {
      const api = apiFor(accountOfThread(t.id));
      if (!api) return;
      const raw = encodeEmail({ to: u.target, subject: u.subject || UNSUB_SUBJECT, body: UNSUB_BODY });
      const { ok } = await settleAll([raw], () => api.sendMessage(raw));
      sent = ok.length > 0;
    } else {
      sent = !!window.open(u.target, "_blank", "noopener,noreferrer");
    }
    if (!sent) {
      say(u.kind === "mailto" ? "Couldn't send it · Nothing was asked" : "Your browser blocked that tab · Nothing was asked");
      return;
    }
    emit({ type: "action", props: { name: "email.unsubscribe", kind: u.kind } });
    setView("list");
    say(unsubLine(m.from));
  };

  // N9: one sender's unsubscribe, without opening their mail. Same two forms
  // and the same honesty as doUnsub: mailto is sent, https is OPENED, because
  // without List-Unsubscribe-Post a URL may be a page needing a click and
  // pretending otherwise is a false receipt.
  // Returns whether the ASK actually left the building. It used to return
  // nothing and swallow both failures (2026-08-25), which let the sweep above
  // count an unsubscribe that never happened.
  //
  // The https branch is the interesting one: a sweep opens these in a loop
  // from a single tap, and every browser blocks all but the first popup.
  // window.open returns null when it is blocked, so that is the check. There
  // is no way to make the second tab open, and the honest move is to say so
  // rather than to report three asks and send one.
  const requestUnsub = async (u: Unsub): Promise<boolean> => {
    let sent = false;
    if (u.kind === "mailto") {
      const api = g.apis("mail")[0]?.api;
      if (!api) return false;
      const { ok } = await settleAll([u], () =>
        api.sendMessage(encodeEmail({ to: u.target, subject: u.subject || UNSUB_SUBJECT, body: UNSUB_BODY })));
      sent = ok.length > 0;
    } else {
      sent = !!window.open(u.target, "_blank", "noopener,noreferrer");
    }
    if (sent) emit({ type: "action", props: { name: "email.unsubscribe", kind: u.kind } });
    return sent;
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

  // 11C: BULK DELETE, the same shape as archive and the same honesty.
  // Trash, never the permanent-delete endpoint: that is the standing law and
  // this is the surface where it matters most. Undo untrashes.
  const deleteThreads = async (chosen: ThreadRow[]) => {
    if (!chosen.length) return;
    const ids = new Set(chosen.map((r) => r.id));
    setRows((rs) => rs.filter((x) => !ids.has(x.id)));
    setResults((rs) => (rs ? rs.filter((x) => !ids.has(x.id)) : rs));
    const { ok, failed } = await settleAll(chosen, (r) => apiFor(r.account)?.trashThread(r.id));
    if (failed.length) setRows((rs) => [...failed, ...rs.filter((x) => !failed.some((f) => f.id === x.id))].sort((a, b) => b.dateMs - a.dateMs));
    say(capAfterNumber(settleLine(ok.length, failed.length, DELETE_WORDS)), ok.length ? {
      label: "Undo",
      run: () => void (async () => {
        setRows((rs) => [...ok, ...rs.filter((x) => !ids.has(x.id))].sort((a, b) => b.dateMs - a.dateMs));
        const back = await settleAll(ok, (r) => apiFor(r.account)?.untrashThread(r.id));
        if (back.failed.length) say(settleLine(back.ok.length, back.failed.length, UNTRASH_WORDS));
      })(),
    } : undefined, 8000);
  };

  const deletePicked = async (all: ThreadRow[]) => {
    const chosen = all.filter((r) => picked?.has(r.id));
    setPicked(null);
    await deleteThreads(chosen);
  };

  // E10: archive every picked row in one move, one Undo for the lot. Same
  // optimistic shape as archiveRow; a failed write un-hides its own row.
  const archivePicked = async (all: ThreadRow[]) => {
    const chosen = all.filter((r) => picked?.has(r.id));
    setPicked(null);
    if (!chosen.length) return;
    const ids = new Set(chosen.map((r) => r.id));
    setRows((rs) => rs.filter((x) => !ids.has(x.id)));
    // COUNTED, LIKE EVERY OTHER BATCH (2026-08-25). This still looped with a
    // per-row catch that put the row back and told nobody, then reported
    // chosen.length regardless.
    const { failed } = await settleAll(chosen, (r) => apiFor(r.account)?.modifyThread(r.id, [], ["INBOX"]));
    if (failed.length) setRows((rs) => [...failed, ...rs.filter((x) => !failed.some((f) => f.id === x.id))].sort((a, b) => b.dateMs - a.dateMs));
    countCleared(chosen.length - failed.length);
    say(capAfterNumber(settleLine(chosen.length - failed.length, failed.length, ARCHIVE_WORDS)), {
      label: "Undo",
      // AN UNDO THAT DOES NOT UNDO IS THE WORST ONE (2026-08-25): the rows
      // come back in the list, the mail stays archived in Gmail, and the next
      // load quietly takes them away again.
      run: () => void (async () => {
        setRows((rs) => [...chosen, ...rs.filter((x) => !ids.has(x.id))].sort((a, b) => b.dateMs - a.dateMs));
        const { failed } = await settleAll(chosen, (r) => apiFor(r.account)?.modifyThread(r.id, ["INBOX"], []));
        if (failed.length) say(settleLine(chosen.length - failed.length, failed.length, RESTORE_WORDS));
      })(),
    });
  };

  const archiveRow = (r: ThreadRow) => {
    // THE BRAIN IS LISTENING NOW (handoff item 1, 2026-09-04). Email did the
    // most daily work in the app and emitted the least meaning, so a month of
    // it taught the Brain nothing. One typed act, no free text: an hour and a
    // day, which is all the email_window band reads.
    emit({ type: "email.handled", props: { kind: "archive" } });
    setToss(tossOffer(recordToss(r.fromEmail, r.unread)));
    setRows((rs) => rs.filter((x) => x.id !== r.id));
    setResults((rs) => (rs ? rs.filter((x) => x.id !== r.id) : rs));
    // A failed write un-hides the row and says so (2026-08-09): pretending it
    // worked meant the "archived" mail quietly reappeared on the next load.
    apiFor(r.account)?.modifyThread(r.id, [], ["INBOX"]).catch(() => {
      setRows((rs) => [r, ...rs.filter((x) => x.id !== r.id)].sort((a, b) => b.dateMs - a.dateMs));
      say("Couldn't archive · Still in inbox");
    });
    say("Archived", { label: "Undo", run: () => void (async () => {
      setRows((rs) => [r, ...rs.filter((x) => x.id !== r.id)].sort((a, b) => b.dateMs - a.dateMs));
      const { failed } = await settleAll([r], (x) => apiFor(x.account)?.modifyThread(x.id, ["INBOX"], []));
      if (failed.length) say("Couldn't put it back · Still archived in Gmail");
    })() });
  };

  // Delete goes to Gmail's Trash, recoverable for 30 days. The permanent
  // delete endpoint is never called from this app.
  const trashThread = async (id: string, account?: string) => {
    const api = apiFor(account ?? accountOfThread(id));
    if (!api) return;
    setRows((rs) => rs.filter((r) => r.id !== id));
    setResults((rs) => (rs ? rs.filter((r) => r.id !== id) : rs));
    // Deleting the thread you are reading must not leave you reading it.
    setView("list");
    const gone = rows.find((r) => r.id === id);
    // DELETE HAS TO BE TRUE (2026-08-25). This said "In trash 30 days" with
    // the rejection in an empty catch: the row vanished locally, the thread
    // stayed in the inbox, and it reappeared on the next load with no mention.
    // Archive, twelve lines up, got this right in August and Delete never did.
    const { ok } = await settleAll([id], () => api.trashThread(id));
    if (!ok.length) {
      if (gone) setRows((rs) => [gone, ...rs.filter((x) => x.id !== id)].sort((a, b) => b.dateMs - a.dateMs));
      say("Couldn't delete it · Still in your inbox");
      return;
    }
    say("Deleted · In trash 30 days", { label: "Undo", run: () => void (async () => {
      if (gone) setRows((rs) => [gone, ...rs.filter((x) => x.id !== id)].sort((a, b) => b.dateMs - a.dateMs));
      const { failed } = await settleAll([id], () => api.untrashThread(id));
      if (failed.length) say("Couldn't put it back · Still in trash");
    })() });
  };

  const archiveAllNoise = async (noise: ThreadRow[], manual = true) => {
    if (noise.length === 0) return;
    const ids = new Set(noise.map((r) => r.id));
    setRows((rs) => rs.filter((r) => !ids.has(r.id)));
    setNoiseOpen(false);
    let counts;
    for (const r of noise) counts = recordToss(r.fromEmail, r.unread);
    if (counts) setToss(tossOffer(counts));
    // THE NUMBER THIS FEEDS IS CALLED "COUNTED, NEVER ESTIMATED" (2026-08-25).
    // It was an estimate: every write's failure went into an empty catch and
    // the receipt printed noise.length. This one runs UNATTENDED from the
    // auto-clear effect, so nobody was watching the inbox it did not clear.
    const { ok, failed } = await settleAll(noise, (r) => apiFor(r.account)?.modifyThread(r.id, [], ["INBOX"]));
    if (failed.length) setRows((rs) => [...failed, ...rs.filter((x) => !ids.has(x.id) || !failed.some((f) => f.id === x.id))].sort((a, b) => b.dateMs - a.dateMs));
    // E12: an auto-clear the user did not ask for is not something the user
    // cleared, so only the manual sweep counts toward today's number.
    if (manual && ok.length) countCleared(ok.length);
    const what = capAfterNumber(settleLine(ok.length, failed.length, ARCHIVE_WORDS));
    // Undo (2026-08-09): this was the one archive without it, and it is the
    // one that takes the most at once, including when the opt-in auto-clear
    // runs it unattended.
    say(manual || !ok.length ? what : what + " · " + noiseLine(ok), ok.length ? {
      label: "Undo",
      run: () => {
        void (async () => {
          setRows((rs) => [...ok, ...rs].sort((a, b) => b.dateMs - a.dateMs));
          const back = await settleAll(ok, (r) => apiFor(r.account)?.modifyThread(r.id, ["INBOX"], []));
          if (back.failed.length) say(settleLine(back.ok.length, back.failed.length, RESTORE_WORDS));
        })();
      },
    } : undefined, manual ? 6000 : 8000);
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
    void archiveAllNoise(noise, false);
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
      setError(humanError(e, "Could not open draft"));
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
      // A reply is the other way a thread gets dealt with (handoff item 1).
      emit({ type: "email.handled", props: { kind: "reply" } });
      if (editingDraftId) {
        const id = editingDraftId;
        setDrafts((ds) => ds.filter((d) => d.id !== id));
        setEditingDraftId(null);
        // The mail is SENT by this point, so a failed draft cleanup is not
        // worth alarming him about; it leaves a stale draft in Gmail. Said
        // out loud rather than hidden in an empty catch, and reported quietly
        // so he is not hunting a duplicate later.
        void (async () => {
          const { failed } = await settleAll([id], () => api.deleteDraft(id));
          if (failed.length) say("Sent · The old draft is still in your drafts");
        })();
      }
      // Commitment catcher: if he just promised something, it becomes a task
      // with the date HE named. Once per thread, and never for a hand-off note
      // (the promise there is the other person's).
      // N13: the ladder climbs on what was actually SENT to someone who owes
      // him, so it cannot be gamed by opening the drafter and closing it.
      if (draft.threadId && chaseDays > 0) {
        setChase({
          threadId: draft.threadId, to: draft.to, subject: draft.subject,
          setISO: todayISO(), days: chaseDays,
        });
      }
      const nudged = draft.threadId && waiting.some((w) => w.threadId === draft.threadId);
      if (nudged) setNudgeCounts(countNudge(draft.threadId!));
      // N3: a chase he set retires the moment he acts on it.
      if (draft.threadId) clearChase(draft.threadId);
      const threadForPromise = draft.threadId || sent.threadId;
      if (tasks && ai.available && !draft.handoffTo && threadForPromise && !alreadyPromised(threadForPromise)) {
        const today = todayISO();
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
            setToast(commitmentLine(c, todayISO()));
            setTimeout(() => setToast(null), 4000);
          } catch { /* a missed catch is silent; a wrong task is not */ }
        })();
      }
      if (draft.handoffTo) {
        // It is theirs now: out of the inbox, into Waiting On.
        const tid = draft.threadId || sent.threadId;
        if (tid) {
          setRows((rs) => rs.filter((r) => r.id !== tid));
          // The handoff note went out; this only moves the thread out of the
          // inbox. A failure leaves it visible, which is recoverable and
          // worth one line rather than a silent divergence.
          void (async () => {
            const { failed } = await settleAll([tid], () => apiFor(draft.account)?.modifyThread(tid, [], ["INBOX"]));
            if (failed.length) say("Handed off · Still in your inbox");
          })();
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
      setError(humanError(e, "Could not send"));
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
          onDone={(n, ms, receipts) => {
            setDeckRows(null); setDrainMs(undefined);
            // 10A: the day colors in when at least one card truly died.
            // Recorded here, at the finish, never during render.
            recordSweepDay(todayISO(), n);
            setDeadStats({ n, ms, receipts }); setView("dead");
          }}
          onOpenThread={(id) => void openThread(id)}
          onEditReply={(t, body) => {
            const r = buildReply(t.messages[t.messages.length - 1]!, body);
            setThread(t);
            setEditingDraftId(null);
            setDraft({ to: r.to, subject: r.subject, body, inReplyTo: r.inReplyTo, threadId: r.threadId, fromDeck: true });
            setView("compose");
          }}
          onHandled={(threadId, archived) => {
            if (archived) {
              setRows((rs) => rs.filter((r) => r.id !== threadId));
              // E12: counted here, one per thread as it actually leaves,
              // rather than in a lump at the end. A deck the user abandons
              // half way still counts what it cleared.
              countCleared(1);
            }
          }}
        />
      </div>
    );
  }

  // 7A: THE FINISH IS A PLACE (Dave 2026-08-25, the Anti-Inbox catalog).
  // Gmail has no done state, so no session ever feels finished, so every
  // session feels like failure. This screen is the payoff and the proof in
  // one: a full-screen Done, the true receipts (counted as they happened,
  // never estimated), and the honest streak (10A): squares that color in and
  // never, ever reset.
  if (view === "dead" && deadStats) {
    const sv = streakView(loadSweepDays(), todayISO());
    const lines = receiptLines(deadStats.receipts);
    return (
      <div className={"screen sweep-finish " + pushCls} key="dead">
        <div className="sweep-finish-body">
          <div className="deck-dead-burst"><Burst show size="big" /></div>
          <div className="sweep-finish-done">{deadStats.n > 0 ? "Done." : "Nothing needed you."}</div>
          <div className="sweep-finish-sub">
            {deadStats.n > 0
              ? deadStats.n + " handled · " + fmtDuration(deadStats.ms)
              : "The deck is holding the rest for next time"}
          </div>
          {lines.length > 0 && (
            <div className="sweep-receipts">
              {lines.map((l) => <div className="sweep-receipt" key={l}>→ {capAfterNumber(l)}</div>)}
            </div>
          )}
          <div className="sweep-streak">
            <div className="sweep-streak-row" aria-label={"Cleared " + sv.cleared + " of the last 7 days"}>
              {sv.last7.map((hit, i) => <span className={"sweep-sq" + (hit ? " on" : "")} key={i} />)}
            </div>
            <div className="sweep-streak-line">
              {capAfterNumber("Cleared " + sv.cleared + " of the last 7")}{sv.best > 1 ? " · Best run: " + sv.best : ""}
            </div>
          </div>
        </div>
        <div className="pad-x conn-action">
          <button className="btn btn-secondary btn-block" onClick={() => { setDeadStats(null); setView("list"); }}>Back to Email</button>
        </div>
      </div>
    );
  }

  // 11A: THE CLEAN OUT (Dave 2026-08-25: "cleaning it out and mass deletion").
  //
  // The sweep is about the DAY. This is about the ACCOUNT: hundreds of
  // threads, grouped by sender, biggest offender first, deleted in one move.
  // The count beside each sender is what tells you which single decision
  // removes the most, which is the whole reason grouping beats a list.
  //
  // Safety is visible rather than assumed: a sender with even one needs-you
  // thread is shown but never pre-picked, and a VIP is not in the list at
  // all. Delete means Gmail's trash. This app has never called the
  // permanent-delete endpoint and this screen does not either.
  if (view === "purge") {
    const piles = senderPiles(unmutedRows, effTriage, vips);
    const picks = purgePicks ?? defaultPicks(piles);
    const n = selectedCount(piles, picks);
    const toggle = (email: string) => {
      const next = new Set(picks);
      if (next.has(email)) next.delete(email); else next.add(email);
      setPurgePicks(next);
    };
    return (
      <div className={"screen ruled " + pushCls} key="purge">
        <div className="nav-bar">
          <button className="nav-back" onClick={() => { setPurgePicks(null); setView("list"); }}>Email</button>
          <span className="nav-title">Clean Out</span>
          <button className="nav-action" onClick={() => setPurgePicks(new Set())}>None</button>
        </div>
        {piles.length === 0 ? (
          <div className="pad-x"><div className="card list-card-ruled"><div className="empty-state empty-compact">
            <div className="empty-title">Nothing to Clean Out</div>
            <div className="empty-sub">Your inbox is already down to what matters.</div>
          </div></div></div>
        ) : (
          <>
            <div className="sh2 sh2-quiet"><span className="t">Who Fills Your Inbox</span></div>
            <div className="pad-x"><div className="card list-card-ruled">
              {piles.map((p) => (
                <div className="row" role="button" tabIndex={0} key={p.email}
                  aria-pressed={picks.has(p.email)}
                  onClick={() => toggle(p.email)}>
                  <span className={"cb" + (picks.has(p.email) ? " on" : "")} aria-label={picks.has(p.email) ? "Picked" : "Not picked"}>
                    {picks.has(p.email) ? "\u2713" : ""}
                  </span>
                  <div className="row-grow">
                    <div className="conn-name">{p.name}</div>
                    {/* The safety line is on the ROW that is unsafe, not in a
                        legend somewhere. It is the reason not to tick it. */}
                    {!p.safe && <div className="conn-meta purge-warn">Some of these needed you</div>}
                  </div>
                  <span className="purge-count">{p.count}</span>
                </div>
              ))}
            </div></div>
            <ListFloor />
            <div className="pad-x conn-action purge-foot">
              {/* L1 LITERALLY: red is a VERB. With nothing picked there is no
                  verb, so a full-width red pill reading "Pick Some Senders"
                  is red announcing a danger that does not exist yet, on the
                  one screen where the eye most needs red to mean something.
                  It goes red the moment it will actually delete, and not one
                  render before. */}
              <button className={"btn btn-block " + (n === 0 ? "btn-secondary" : "btn-danger")} disabled={n === 0 || purging}
                onClick={() => void (async () => {
                  setPurging(true);
                  try {
                    const ids = new Set(selectedIds(piles, picks));
                    await deleteThreads(unmutedRows.filter((r) => ids.has(r.id)));
                    setPurgePicks(null);
                    setView("list");
                  } finally { setPurging(false); }
                })()}>
                {purging ? "Deleting..." : purgeLabel(n)}
              </button>
              <div className="conn-meta purge-promise">{purgePromise()}</div>
            </div>
          </>
        )}
        <div className="screen-foot" />
      </div>
    );
  }

  // Every standing decision, in one place, each one undoable. A rule that is
  // permanent and invisible is not a rule, it is a haunting.
  if (view === "rules") {
    const filed = Object.entries(rules);
    return (
      <div className={"screen ruled " + pushCls} key="rules">
        <div className="nav-bar"><button className="nav-back" onClick={() => setView("list")}>Email</button>
          <span className="nav-title">Standing Rules</span><span className="nav-action"></span></div>
        <Head label="Senders You Filed" />
        <Card>
          {filed.length === 0 ? (
            <div className="row"><div className="row-grow"><div className="conn-meta">Nothing filed yet.</div></div></div>
          ) : filed.map(([sender, bucket]) => (
            <div className="row" key={sender}>
              <div className="row-grow">
                <div className="line-between">
                  {/* The rule's storage key is an address. The row underneath
                    a Waiting On entry has used nameFor since August; this one
                    printed the key (2026-08-25). */}
                <span className="conn-name truncate">{nameFor(names, sender, prettyHandle(sender.split("@")[0] ?? "") ?? sender)}</span>
                  <span className="conn-meta">{BUCKET_LABEL[bucket]}</span>
                </div>
              </div>
              <button className="quiet-action" onClick={() => setRules(clearRule(sender))}>Undo</button>
            </div>
          ))}
        </Card>
        {/* N8 (2026-08-20). The ONLY thing in this app that sends without a
            tap, so the promise and the guard are the same sentence and it
            lives OFF until he turns it on. */}
        <Head label="Heads-Down Auto-Reply" />
        <Card>
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
        </Card>

        <Head label="Muted Threads" />
        <Card>
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
        </Card>
        {autoNoise && (
          <div className="pad-x conn-action">
            <button className="btn btn-secondary btn-block" onClick={() => {
              try { localStorage.removeItem(AUTONOISE_KEY); } catch { /* ignore */ }
              setAutoNoise(false);
              say("Auto-clear off · Noise stays");
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
      <div className="screen ruled">
        <PageHeader title="Email" />
        {/* 1B: THE DOOR. It used to be a card in a stack of cards, which is
            the wrong shape for the idea: a curtain that looks like one more
            row is a curtain you scroll past. Sealed means the screen is the
            door and there is nothing behind it to squint at.

            Three lines, in the order a person actually asks them. WHEN it
            opens. WHO is behind it, in people and names rather than a count.
            And WHOSE choice this was, because Dave once found this screen and
            did not recognise it as his own. */}
        <div className="mail-door">
          <div className="mail-door-seal cat-fg-teal"><Mail className="ic" /></div>
          <div className="mail-door-when">{closedLine(windows, new Date())}</div>
          {/* The peek may not claim an empty inbox it has not seen. On a
              fresh open the row load takes seconds (30 threads, one meta
              fetch each), and Dave's 2026-08-26 screenshot caught the door
              saying "Nothing from a person" while Joe Pareres sat in Needs
              You: the peek had read a list that simply had not arrived yet.
              While loading with nothing in hand it says it is looking, and
              on a failed load it does not pretend the silence is peace. */}
          <div className="mail-door-peek">
            {rows.length === 0 && loading ? "Seeing who wrote…"
              : rows.length === 0 && error ? "Couldn't check the inbox"
              : peekLine(rows, effTriage, vips)}
          </div>
          <div className="mail-door-acts">
            {/* Early, not "anyway". It is his door and he is allowed through
                it; the word should not imply he is breaking a rule.

                SECONDARY, not primary. The first draft made this a filled
                red pill, which put the loudest object in the app on its
                calmest screen and recommended the one action the screen
                exists to make unnecessary. The recommended action here is
                to WAIT, and nothing recommends waiting like the escape
                hatch being quiet. */}
            <button className="btn btn-secondary" onClick={() => setPeeked(true)}>Open Early</button>
            <button className="quiet-action" onClick={() => setEditWindows(true)}>Adjust My Windows</button>
          </div>
          <div className="mail-door-who">You close email outside your windows</div>
        </div>
        {vipRows.length > 0 && (
          <div className="pad-x"><div className="card list-card-ruled">
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
    // THE BLANK EMAIL PAGE (2026-09-02, found by the CLEAN=1 build). A build
    // with no backend mounts the shell with seedDemo on, and that flag
    // arrives here as demoMail. In a demo build the fixtures render; in a
    // CLEAN build the fixture module does not exist, and this branch used
    // to return null on the flag alone, so a new user opening Email got a
    // black screen with no words on it. The flag only means something when
    // the module is here; otherwise fall through to the honest connect
    // screen, which is what a real user without mail should see.
    if (demoMail && DemoMail) {
      // Lazy AND behind the build constant: the fixtures live in that module,
      // so a static import would ship them to every real user.
      return (
        <div className={pushCls} key="demo">
          <Suspense fallback={null}>
            <DemoMail onConnect={configured ? connect : onOpenConnections} />
          </Suspense>
        </div>
      );
    }
    return (
      <div className={"screen ruled " + pushCls} key="connect">
        <PageHeader title="Email" />
        {/* Catalog V3.1: the empty state carries its action. Directions to a
            button somewhere else are illegal; the button is here. */}
        <div className="pad-x"><div className="card list-card-ruled"><div className="empty-state">
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
      <div className={"screen ruled " + pushCls} key="compose">
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
    const noReply = isNoReply(lastMsg(thread).fromEmail, cleanBody(lastMsg(thread).body), lastMsg(thread).listUnsubscribe);
    // BULK LICENSES MORE THAN NO-REPLY (Dave 2026-08-25, on a marketing blast
    // carrying the full stack: Reply, quick answers, Hand This to Someone,
    // and four project chips). A blast belongs to no project and is nobody's
    // to hand off. An automated appointment reminder is neither of those, so
    // the two questions stay separate.
    const bulk = isBulk(lastMsg(thread).listUnsubscribe);
    const worthSummarising = thread.messages.length > 1 || isLong(cleanBody(lastMsg(thread).body));
    return (
      <div className={"screen ruled " + pushCls} key="detail">
        <div className="nav-bar">
          <button className="nav-back" onClick={() => setView("list")}>Email</button>
          <span className="nav-title"></span>
          <div className="nav-actions">
            <button className="nav-action danger" onClick={() => void trashThread(thread.id)} aria-label="Delete"><Trash2 className="ic" /></button>
            <button className="nav-action" onClick={() => archiveThread(thread.id)} aria-label="Archive"><Archive className="ic" /></button>
          </div>
        </div>
        <div className="pad-x">
          <div className="msg-detail-head">
            <div className="msg-detail-subj">{thread.subject}</div>
            <div className="conn-meta">{thread.messages.length === 1 ? lastMsg(thread).from : thread.messages.length + " messages"}</div>
          </div>
          {/* FOUR LAYERS OF ONE APPOINTMENT REMINDER (Dave 2026-08-25). His
              screenshot: the subject, then a JARVIS Summary, then the raw
              body opening with the same sentence, then "Read the whole thing
              · 141 words".

              A summary earns its place when there is something to summarise.
              One short message is already the shortest version of itself, and
              a paraphrase of two visible lines is furniture. */}
          {summary && worthSummarising && (
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
            // AS SENT (Dave 2026-09-02, "I can't read emails or see pics";
            // then, with his Gmail beside it: "Need to fix the email"). A
            // mail with an HTML version opens AS SENT, pictures and layout,
            // in a frame that cannot run anything (MailHtmlView), the way
            // his Gmail shows it. The text is one tap away, and a long text
            // folds behind its lead-in the way it always did.
            const asSent = !!m.html;
            const mode = bodyMode[m.id] ?? (asSent ? "sent" : "text");
            const setMode = (v: "sent" | "text" | "full") => setBodyMode((o) => ({ ...o, [m.id]: v }));
            return (
            <div className="msg-turn" key={m.id}>
              <div className="msg-turn-head">
                <span className="msg-turn-from">{m.from}</span>
                <span className="conn-meta">{m.date}</span>
              </div>
              {mode === "sent"
                ? <MailHtmlView html={m.html!} />
                : <div className="msg-body">{long && mode === "text" ? leadIn(clean) : clean}</div>}
              {(long || asSent) && (
                <div className="msg-more-row">
                  {mode === "sent" && <button className="quiet-action msg-more" onClick={() => setMode("text")}>Show as Text</button>}
                  {mode === "text" && long && (
                    <button className="quiet-action msg-more" onClick={() => setMode("full")}>Read the Whole Thing · {wordCount(clean)} words</button>
                  )}
                  {mode === "full" && <button className="quiet-action msg-more" onClick={() => setMode("text")}>Fold It Back</button>}
                  {mode !== "sent" && asSent && <button className="quiet-action msg-more" onClick={() => setMode("sent")}>Show as Sent</button>}
                </div>
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
          {/* NOBODY IS READING THAT MAILBOX (Dave 2026-08-25). His screenshot
              had "Got it, thanks." and "Will I need to reschedule?" under an
              email whose first line is "This is an automated message. Please
              do not reply." Both bounce, and the second is a question he
              would then believe he had asked.

              Forward survives, because forwarding an automated notice to a
              person is a real move. Reply does not, and the line says why
              rather than leaving a hole where a button was. */}
          {noReply ? (
            <>
              <div className="msg-actions">
                <button className="btn btn-secondary" onClick={() => startForward(thread)}><Forward className="ic" /> Forward</button>
              </div>
              <div className="conn-meta msg-noreply">{bulk ? "Bulk mail · A reply reaches a list, not a person" : "No-reply sender · Answers here go nowhere"}</div>
            </>
          ) : (
            <>
              <div className="msg-quick">
                {replies.map((q) => (
                  <button key={q} className="chip" onClick={() => quickReply(thread, q)}>{q}</button>
                ))}
              </div>
              <div className="msg-actions">
                <button className="btn btn-secondary" onClick={() => startReply(thread)}><CornerUpLeft className="ic" /> Reply</button>
                <button className="btn btn-secondary" onClick={() => startForward(thread)}><Forward className="ic" /> Forward</button>
              </div>
            </>
          )}
          {/* Mute, sweep, unsubscribe: the three ways to make a sender stop
              costing you attention, strongest last. */}
          <div className="msg-quiet-acts">
            <button className="quiet-action" onClick={() => {
              setMuted(mute(thread.id));
              setView("list");
              say("Muted · Won't come back", { label: "Undo", run: () => setMuted(unmute(thread.id)) });
            }}>Mute This Thread</button>
            {sweepCount(lastMsg(thread).fromEmail) > 1 && (
              <button className="quiet-action" onClick={() => void sweepSender(lastMsg(thread).fromEmail)}>
                {/* The sender's name used to sit INSIDE this button, so
                    "Archive all 2 from Resolve Psychiatric Services Client
                    Portal" ran to two lines (2026-08-25). The name is on
                    every message above; the button only has to say which
                    sender it means. */}
                Archive all {sweepCount(lastMsg(thread).fromEmail)} from this sender
              </button>
            )}
            {parseUnsub(lastMsg(thread).listUnsubscribe, lastMsg(thread).listUnsubscribePost) && (
              <button className="quiet-action" onClick={() => void doUnsub(thread)}>
                {unsubLabel(lastMsg(thread).from)}
              </button>
            )}
          </div>

          {/* Hand off: one gesture for "this is not mine". */}
          {people && handTargets === null && !bulk && (
            <button className="btn btn-secondary btn-block msg-hand" onClick={() => void openHandoff()}>
              <Forward className="ic" /> Hand This to Someone
            </button>
          )}
          {handTargets !== null && (
            <div className="msg-hand-pick">
              <div className="eyebrow">Hand This To</div>
              <div className="card list-card-ruled">
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
          {projects.length > 0 && !bulk && (
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
            <span className="conn-meta">{isVip(lastMsg(thread).fromEmail, vips) ? "Always gets through" : vipLine(vips.length)}</span>
            <div className="msg-chips">
              <button
                className={"chip" + (isVip(lastMsg(thread).fromEmail, vips) ? " on" : "")}
                onClick={() => {
                  // B3-7 (2026-09-04): a capped toggle is neither an add nor
                  // a removal; saying so, honestly, beats a lying "back to
                  // normal" about someone who was never a VIP.
                  const { list, capped } = toggleVip(lastMsg(thread).fromEmail);
                  if (capped) {
                    setToast(`VIP is full at ${VIP_MAX} · Remove one first`);
                  } else {
                    setVips(list);
                    setToast(isVip(lastMsg(thread).fromEmail, list)
                      ? displayName(lastMsg(thread).from) + " always gets through now"
                      : displayName(lastMsg(thread).from) + " is back to normal");
                  }
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
                <button className="pill-act" disabled={attachBusy} onClick={() => void (async () => {
                  if (attachBusy) return;
                  setAttachBusy(true);
                  try {
                    // THE BUTTON DOES THE THING (2026-08-25). This branch used
                    // to fire "Open the attachment to add it · Your Calendar
                    // handles .ics", mark the card done, and hide it: a button
                    // labelled Add whose entire effect was to hand the job
                    // back and withdraw the offer. The file states the title,
                    // the date and the time; ics.ts reads them.
                    if (offer.kind === "calendar") {
                      const read = await readIcsAttachment(m.id, offer.attachmentId);
                      if (!read?.event) {
                        // Law 1: unreadable means unreadable. It opens the
                        // file rather than inventing an appointment, and the
                        // card STAYS so the offer is not silently spent.
                        setToast("Couldn't read that invite · Opening the file");
                        setTimeout(() => setToast(null), 3500);
                        if (offer.attachmentId) void openAttachment(m.id, offer.attachmentId, offer.filename ?? "invite.ics", "text/calendar");
                        return;
                      }
                      const { event: ev, count } = read;
                      const extra = count > 1 ? " · " + (count - 1) + " more in the file" : "";
                      if (ev.start && scheduleSvc) {
                        const id = await scheduleSvc.createEvent(ev.title, {
                          date: ev.date, start: ev.start,
                          end: endOfAct(ev.start, ev.durationMin ?? 60),
                          source: madeBy("email", thread.id),
                        });
                        if (!id) { setToast("Couldn't add it · Nothing was saved"); setTimeout(() => setToast(null), 3000); return; }
                        setToast("On your schedule · " + dayPhrase(ev.date, todayISO()) + " " + fmtTime(ev.start).time + " " + fmtTime(ev.start).ap + extra);
                      } else if (tasks) {
                        // Law 2: an all-day invite has a date and no time.
                        // It stays a date rather than becoming a 9am nobody
                        // wrote down.
                        const id = await tasks.createTask(ev.title, { due: ev.date, source: madeBy("email", thread.id) });
                        if (!id) { setToast("Couldn't add it · Nothing was saved"); setTimeout(() => setToast(null), 3000); return; }
                        setToast("Added to your tasks · " + dayPhrase(ev.date, todayISO()) + extra);
                      } else {
                        return;
                      }
                      setAttachDone(true);
                      setTimeout(() => setToast(null), 3500);
                      return;
                    }
                    // A card offering a write with no service behind it is a
                    // button that does nothing, silently. The sheet's own file
                    // legislated against this shape; this card never got it.
                    if (!tasks) { setToast("Tasks aren't available right now"); setTimeout(() => setToast(null), 3000); return; }
                    const id = offer.kind === "bill" && offer.amount != null
                      ? await tasks.createTask(offer.title, { bill: { amount: offer.amount }, source: madeBy("email", thread.id) })
                      : await tasks.createTask(offer.title, { source: madeBy("email", thread.id) });
                    // createTask returns null for blank text without throwing.
                    if (!id) { setToast("Couldn't add it · Nothing was saved"); setTimeout(() => setToast(null), 3000); return; }
                    setToast(offer.kind === "bill" && offer.amount != null
                      ? "Added to Money · $" + offer.amount.toFixed(2)
                      : "Added to your tasks");
                    setAttachDone(true);
                    setTimeout(() => setToast(null), 3000);
                  } catch {
                    // Unwrapped before (2026-08-25): a throwing write produced
                    // an unhandled rejection, no toast, and a card that stayed
                    // put with no explanation.
                    setToast("Couldn't add it · Nothing was saved");
                    setTimeout(() => setToast(null), 3000);
                  } finally {
                    setAttachBusy(false);
                  }
                })()}>{attachBusy ? "Adding…" : offer.action}</button>
              </div></div></div>
            );
          })()}

          {toast && <div className="conn-status">{toast}</div>}
          {/* The page ends above the floating dock. */}
          <div className="msg-detail-tail" aria-hidden="true" />
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
  // E11 (2026-08-24): GIST FIRST. What the email wants from you leads the
  // row; who sent it drops to the eyebrow. The gist was already AI-written,
  // already scrubbed, already on the row, but it sat in the metadata slot
  // under the sender's name, so the eye caught "Nadia Brandt" and had to
  // read on to learn whether Nadia mattered today. Rows without a gist lead
  // with the subject, which is the same promise the catalog frame made: the
  // AI goes first only when it has something to say.
  //
  // E3: the unread dot becomes the rail, which also carries the deadline's
  // heat, so urgency is felt in the left margin before anything is read.
  const togglePick = (id: string) => setPicked((cur) => {
    const next = new Set(cur ?? []);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // `selectable` marks the fold's rows. In select mode their left column
  // swaps the rail for a checkbox and the row tap toggles instead of
  // opening; everything outside the fold is untouched, so select mode can
  // never archive something that needs you.
  const threadRow = (r: ThreadRow, gist?: string, selectable = false, alwaysStrong = false) => {
    const selecting = selectable && picked !== null;
    return (
    <MailSwipe
      key={r.id}
      onArchive={() => archiveRow(r)}
      onDelete={() => void trashThread(r.id, r.account)}
    >
    <div className="row" role="button" tabIndex={0}
      aria-pressed={selecting ? picked!.has(r.id) : undefined}
      onClick={() => (selecting ? togglePick(r.id) : void openThread(r.id))}>
      {/* Reserved column: read and unread rows share one text edge. */}
      {selecting ? (
        <span className={"cb" + (picked!.has(r.id) ? " on" : "")} aria-label={picked!.has(r.id) ? "Picked" : "Not picked"}>{picked!.has(r.id) ? "\u2713" : ""}</span>
      ) : effTriage[r.id]?.bucket === "noise" || isMachineAddress(r.fromEmail) ? (
        // 8A: a machine keeps the hairline rail. The signal is the triage
        // bucket plus the no-reply address rule, which is exactly the
        // knowledge the app already had and never spent: List-Unsubscribe is
        // not on ThreadRow (the list is built from thread metadata), so
        // reaching for it here would have meant a header fetch per row.
        // A machine's rail lights for a DEADLINE (a bill due is a real
        // tone) but never for mere unreadness: six unread promos wearing six
        // solid red rails was a red status column down the whole All tab,
        // which is L1's exact sin. Unread still bolds the headline.
        //
        // THE RAIL SITS IN THE SAME SLOT A FACE WOULD. The rail itself is
        // 3px, the face is 34px; without a matching slot, a machine row's
        // text starts 31px to the left of a person row's text, and a list
        // that mixes both kinds of sender reads as unaligned. Dave's
        // screenshot of Custom Ink (a face) next to GitHub and Supabase
        // (rails) shows exactly that stagger. .msg-lead is the reserved
        // column the comment above already promised and the rail alone
        // never got.
        <span className="msg-lead">
          <span className={railClass(false, railToneForDeadline(effTriage[r.id]?.by))} aria-label={r.unread ? "unread" : undefined}></span>
        </span>
      ) : (
        // 8A: A PERSON GETS A FACE. Warm, stable per sender, and big enough
        // that your eyes triage the list before your brain has to read it.
        <span className={"msg-face cat-bg-" + faceSlot(r.fromEmail || r.from)} aria-hidden="true">
          {(displayName(r.from)[0] || "?").toUpperCase()}
        </span>
      )}
      <div className="row-grow">
        <div className="msg-line">
          <span className="msg-from truncate">{displayName(r.from)}</span>
          {/* N4: a VIP is marked where he reads, not buried in a setting. */}
          {isVip(r.fromEmail, vips) && <span className="msg-vip" aria-label="Always gets through">★</span>}
          {/* ONE VOCABULARY FOR ONE FIELD (2026-08-25). The chip printed the
              model's raw phrase, sliced at 20 characters and mid-word, while
              the Today card ran the identical field through byLabel and read
              "Today" / "Tomorrow". Same email, two descriptions. */}
          {effTriage[r.id]?.by
            ? <span className={"msg-due" + (byRank(effTriage[r.id]!.by) >= 900 ? " soft" : "")}>{byLabel(effTriage[r.id]!.by)}</span>
            : <span className="msg-when">{fmtWhen(r.dateMs)}</span>}
        </div>
        {/* NEEDS YOU IS ALREADY A VERDICT. Gmail's raw unread flag used to be
            the only thing that made a subject line pop; three of Dave's
            four Needs You rows had already been read (on another device,
            or by him scrolling past) and so rendered in the same dim tone
            as their meta line. A section built by triage, not by read
            status, should not let an unrelated flag decide which of its
            own rows look important. That produced a list that was mostly
            grey with one bright row, which Dave read as noise: "too much
            grey subtext ... gives me anxiety." Everything in this section
            already earned its bold. */}
        <div className={"msg-headline" + (r.unread || alwaysStrong ? " msg-strong" : "")}>
          {gist ?? r.subject}{!gist && r.count > 1 ? " · " + r.count : ""}
          {g.accounts.length > 1 && r.account && <span className="msg-acct">{acctLabel(r.account)}</span>}
        </div>
      </div>
    </div>
    </MailSwipe>
    );
  };

  return (
    <div className={"screen ruled " + pushCls} key="list">
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
                <div className="conn-meta">{monthDay(h.dateISO)} · {h.subject}</div>
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
      {error && <div className="pad-x conn-error">{error}</div>}
      {searching && <div className="pad-x conn-status">Searching everything...</div>}
      {/* E13: the sort renders the first batch and keeps working, so the list
          below is real but incomplete. Saying so is the difference between
          "that is everything" and "that is everything so far". Disappears the
          moment the count catches up. */}
      {sortProg && sortProg.done < sortProg.total && triageState === "ready" && (
        <div className="pad-x sort-strip">
          <div className="conn-meta">{capAfterNumber(sortProg.done + " of " + sortProg.total + " sorted")}</div>
          <div className="sort-bar" role="presentation">
            <span className="sort-bar-fill" style={{ width: (sortProg.done / sortProg.total) * 100 + "%" }} />
          </div>
        </div>
      )}

      {filter === "drafts" ? (
        loading && !draftsLoaded ? (
          <div className="pad-x"><div className="card"><div className="empty-state"><div className="empty-title">Loading...</div></div></div></div>
        ) : drafts.length === 0 ? (
          <div className="pad-x"><div className="card"><div className="empty-state">
            <div className="empty-icon"><Mail className="ic" /></div>
            <div className="empty-title">No Drafts</div>
            {/* B14: the empty state carries its action (the app's own law). */}
            <button className="btn btn-secondary" onClick={startCompose}>New Email</button>
          </div></div></div>
        ) : (
          <div><div className="list-flat">
            {drafts.map((d) => (
              <div className="row" role="button" tabIndex={0} key={d.id} onClick={() => void openDraft(d.id)}>
                <div className="row-grow">
                  {/* The raw To header used to sit here: "Marcus Delaney
                      <marcus@northlake.org>", and the whole comma-joined
                      header for a multi-recipient draft (2026-08-25). */}
                  <div className="conn-name">{draftTo(d.to)}</div>
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
              {/* 2026-09-02: a failed sort had no way to run again short of
                  leaving the tab. Try Again re-runs the same sort over the
                  rows already loaded; Show All Mail stays the way out. */}
              <button className="btn btn-secondary btn-block" onClick={() => { setTriageWhy(""); setTriageState("pending"); void runTriage(rows); }}>Try Again</button>
              <button className="quiet-action" onClick={() => setFilter("all")}>Show All Mail</button>
            </div>
          </div></div></div>
        ) : (
          <div className="pad-x"><div className="card"><div className="empty-state">
            <div className="empty-icon"><Mail className="ic" /></div>
            <div className="empty-title">Reading Your Inbox</div>
            {/* E13: the wait was open-ended, which is the part that made it
                feel long. The number is real: `total` is how many threads
                actually need sorting and `done` counts batches attempted. */}
            <div className="empty-sub">
              {sortProg ? capAfterNumber(sortProg.done + " of " + sortProg.total + " sorted") : "Sorting your mail"}
            </div>
            {sortProg && sortProg.total > 0 && (
              <div className="sort-bar" role="presentation">
                <span className="sort-bar-fill" style={{ width: (sortProg.done / sortProg.total) * 100 + "%" }} />
              </div>
            )}
            {/* Never trapped: the way out is on screen the whole time. */}
            <button className="quiet-action" onClick={() => setFilter("all")}>Show All Mail Instead</button>
          </div></div></div>
        )
      ) : results !== null || !showTriage ? (
        // Search results, the All chip, or triage unavailable: honest threaded list.
        listRows.length === 0 ? (
          <div className="pad-x"><div className="card"><div className="empty-state">
            <div className="empty-icon"><Mail className="ic" /></div>
            <div className="empty-title">{results !== null ? "No Matches" : "Inbox Empty"}</div>
            {/* B14: a failed search that offers nothing is a dead end six
                inches from the box that caused it. */}
            {results !== null && (
              <button className="quiet-action" onClick={() => { setSearch(""); setResults(null); }}>Clear the Search</button>
            )}
          </div></div></div>
        ) : (
          <>
            <div><div className="list-flat">{listRows.map((r) => threadRow(r))}</div></div>
            <ListFloor />
          </>
        )
      ) : (
        <>
          {rows.length === 0 && (
            <div className="pad-x"><div className="card"><div className="empty-state">
              <div className="empty-icon"><Mail className="ic" /></div>
              <div className="empty-title">Inbox Is Quiet</div>
            </div></div></div>
          )}
          {/* THE MISSION DECK (Dave 2026-08-26, approved as "a combo of
              a/c"). His words, on finding the Sweep behind a small side
              button: "People wouldn't think those render into unique major
              features." He was right. The flagship modes were footnotes:
              the Sweep behind a see-all link, the drain behind a quiet
              line, the Clean Out behind a foot pill.
              The deck makes the two flagships the biggest objects on the
              tab, each carrying its count and its honest cost, and the
              launcher rows below it give every other mode a full-width
              target with a reason to tap. The tiny links are gone. */}
          {triageState === "ready" && (needsYou.length > 0 || unmutedRows.length > 0) && (
            <div className="pad-x mode-deck">
              {needsYou.length > 0 && (
                <div className="mode-card mode-hero" role="button" tabIndex={0}
                  onClick={() => { setDeckRows(needsYou); setView("deck"); }}>
                  <div className="mode-name">The Sweep</div>
                  <div className="mode-n">{needsYou.length}</div>
                  {/* CASING LAW APPLIES TO SCORECARDS (Dave 2026-08-29).
                      The line read as a continuation of the display number
                      above it, so it shipped lowercase -- but it is its own
                      element, and every other sub in the app leads each
                      segment with a capital ("A timed drain \u00b7 It stops
                      itself"). Same rule here, no exception for cards. */}
                  <div className="mode-why">{(needsYou.length === 1 ? "Needs you" : "Need you") + " \u00b7 " + sweepEstimate(needsYou.length)}</div>
                  <div className="mode-go">Start</div>
                </div>
              )}
              {unmutedRows.length > 0 && (
                <div className="mode-card" role="button" tabIndex={0}
                  onClick={() => { setPurgePicks(null); setView("purge"); }}>
                  <div className="mode-name">Clean Out</div>
                  <div className="mode-n">{unmutedRows.length}</div>
                  {/* THE SURVIVING HALF IS THE USEFUL HALF (Dave 2026-08-29).
                      .mode-why is deliberately clamped to one nowrap line so
                      every mode card is the same height whatever the sender
                      count -- that is right and stays. But the string read
                      "in the inbox \u00b7 12 senders", so the ellipsis ate the
                      NUMBER and left the filler: his screenshot shows
                      "in the inbox \u00b7 12 se...". The card already says Clean
                      Out and already shows 16 in display type, so "in the
                      inbox" is the half a reader can infer and the sender
                      count is the half they cannot. Leading with the count
                      means an overflow now costs the inferable words. */}
                  <div className="mode-why">{capAfterNumber(senderPiles(unmutedRows, effTriage, vips).length + " senders") + " \u00b7 In the inbox"}</div>
                  <div className="mode-go mode-go-quiet">Open</div>
                </div>
              )}
            </div>
          )}
          {/* The timed drain, promoted from a quiet line to a launcher. The
              picker it opens is the same one it always opened. */}
          {triageState === "ready" && needsYou.length > 0 && !drainOpen && (
            <div className="pad-x">
              <div className="launch-row" role="button" tabIndex={0} onClick={() => setDrainOpen(true)}>
                <span className="launch-ic" aria-hidden="true"><Clock className="ic" /></span>
                <div className="row-grow">
                  <div className="launch-tt">Only a Few Minutes?</div>
                  <div className="launch-ss">A timed drain · It stops itself</div>
                </div>
                <span className="launch-chev" aria-hidden="true">›</span>
              </div>
            </div>
          )}
          {triageState === "ready" && needsYou.length > 0 && drainOpen && (
            <div className="pad-x drain-pick">
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
          {/* One at a Time, promoted from a head link to a launcher when
              there is a real run of them to walk. */}
          {(() => {
            const owed = waiting.filter((w) => decideFor(w).ask !== "nothing");
            if (owed.length < 2) return null;
            const oldest = Math.max(...owed.map((w) => w.waitingDays));
            return (
              <div className="pad-x">
                <div className="launch-row" role="button" tabIndex={0} onClick={() => setWaitDeck(0)}>
                  <span className="launch-ic" aria-hidden="true"><MessageSquare className="ic" /></span>
                  <div className="row-grow">
                    <div className="launch-tt">One at a Time</div>
                    <div className="launch-ss">{capAfterNumber(owed.length + " waiting on answers \u00b7 oldest is " + oldest + (oldest === 1 ? " day" : " days"))}</div>
                  </div>
                  <span className="launch-chev" aria-hidden="true">›</span>
                </div>
              </div>
            );
          })()}
          {/* N12 (2026-08-20): thirty seconds of speech for the car or the gym.
              It says the SAME things the cards say, and never reads a body
              aloud: a private message read out with other people in the car
              is a real harm and nothing here is worth it. */}
          {/* ONE CHASSIS FOR EVERY LAUNCHER (Dave 2026-08-29: "I don't like
              the display at the bottom of the screen"). This was the last
              plain card in the launcher column: two launch-rows and then one
              odd card doing the same job in older clothes. Same chassis as
              its neighbours now -- icon tile, title, promise -- with the
              play control as the trailing pill, because this row performs
              rather than navigates and a chevron would lie about that. */}
          {needsYou.length > 0 && canSpeak() && (
            <div className="pad-x">
              <div className="launch-row" role="button" tabIndex={0} onClick={() => {
                if (speaking) { stopSpeaking(); setSpeaking(false); return; }
                const notices = mailNotices(loadMailSnapshot(), todayISO());
                setSpeaking(speak(speakable(notices, inboxSentence(notices, loadMailSnapshot()))));
              }}>
                <span className="launch-ic" aria-hidden="true"><Volume2 className="ic" /></span>
                <div className="row-grow">
                  <div className="launch-tt">Read It to Me</div>
                  <div className="launch-ss">Senders and gists only · Never the message</div>
                </div>
                <span className="pill-act">{speaking ? "Stop" : "Play"}</span>
              </div>
            </div>
          )}

          {/* N14: once a week, everything nobody chased. Needs-you is NEVER
              in the set, whatever its age, and neither is unsorted mail:
              not having read something is not evidence about it. */}
          {(() => {
            if (closeDone) return null;
            const set = closeCandidates(unmutedRows, effTriage, vips, Date.now());
            // 9A: the clock OR the pile. Three weeks of avoidance should not
            // have to wait for Sunday; that wait is the avoidance loop with
            // the app's help.
            if (!amnestyDue(set, todayISO(), lastClose())) return null;
            return (
              // 9A: THE AMNESTY. The offer names the AGE, never a verdict on
              // the person: "17 threads older than two weeks", not "17 you
              // ignored". The promise under it is the whole reason a one-tap
              // bulk action is safe to take, so it is stated in full.
              <div className="pad-x"><div className="card"><div className="row">
                <div className="row-grow">
                  <div className="conn-name">{amnestyLine(set)}</div>
                  <div className="conn-meta">{closeLine(set)}</div>
                  <div className="conn-meta msg-amnesty-promise">{amnestyPromise()}</div>
                </div>
                <button className="pill-act" onClick={() => void (async () => {
                  const ids = set.ids;
                  const kept = rows.filter((r) => ids.includes(r.id));
                  setRows((rs) => rs.filter((r) => !ids.includes(r.id)));
                  // THE WRITES DECIDE, NOT THE OFFER (2026-08-25). This marked
                  // the week closed BEFORE the awaits and reported set.count,
                  // which is the size of the offer. Every per-thread failure
                  // went into an empty catch, so a fortnight of mail could
                  // stay exactly where it was and the offer would not come
                  // back for another week to say so.
                  const { ok, failed } = await settleAll(ids, (id) => apiFor(accountOfThread(id))?.modifyThread(id, [], ["INBOX"]));
                  if (failed.length) {
                    const back = kept.filter((r) => failed.includes(r.id));
                    setRows((rs) => [...back, ...rs.filter((x) => !failed.includes(x.id))].sort((a, b) => b.dateMs - a.dateMs));
                  }
                  // Only a week that actually closed counts as closed.
                  if (ok.length) { markClosed(todayISO()); setCloseDone(true); }
                  setToast(settleLine(ok.length, failed.length, ARCHIVE_WORDS) + (ok.length && !failed.length ? " · Still searchable in Gmail" : ""));
                  setTimeout(() => setToast(null), 4000);
                })()}>Close It Out</button>
              </div></div></div>
            );
          })()}

          {(() => {
            // The switch: only outcomes that have anything, counts on the
            // labels, and a selection that has emptied falls to the first
            // live one. Never renders a zero.
            const rungsAll = waiting.map((w) => ({ w, d: decideFor(w) }));
            const counts: Record<Outcome, number> = {
              needs: needsYou.length,
              waiting: rungsAll.filter((r) => r.d.ask !== "nothing").length,
              owed: rungsAll.filter((r) => r.d.ask === "nothing").length,
            };
            const live = (Object.keys(OUTCOME_LABEL) as Outcome[]).filter((o) => counts[o] > 0);
            if (live.length === 0) return null;
            const cur = live.includes(outcome) ? outcome : live[0]!;
            return (
              <div className="pad-x outcome-seg">
                <div className="segmented" role="tablist" aria-label="Outcome">
                  {live.map((o) => (
                    <button key={o} role="tab" aria-selected={o === cur}
                      className={"seg" + (o === cur ? " active" : "")}
                      onClick={() => { if (o !== cur) pickOutcome(o); }}>
                      {OUTCOME_LABEL[o]}<span className="seg-n">{counts[o]}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
          {needsYou.length > 0 && outcomeShown(outcome, needsYou, waiting, decideFor) === "needs" && (
            <>
              {/* E14 (2026-08-23): the verb rides the head.
                  It used to live in a promo card above the whole list that
                  spent a badge, a title and a sub saying three things: the
                  count (which the head can carry), "everything else is filed
                  below" (which the fold below already says by existing), and
                  the verb. A whole card of height for one button. */}
              {/* E14's verb moved again (2026-08-26): off the head and onto
                  the Mission Deck above, where it is the biggest thing on
                  the tab instead of the smallest. The head keeps the count. */}
              {/* I3 REACHES EMAIL (Dave 2026-08-29, approved off a rendered
                  before/after). That law -- "SIX identical red heads down one
                  screen; when every head shouts, none of them does" -- was
                  written in August and applied to Today, which keeps exactly
                  one accent head (Now). Email was never swept: three bare
                  .sh2 heads, three accent labels, three dotted red rules,
                  none of them the reason you opened the tab. The mode deck
                  above already says where to start, so no head here needs to
                  compete with it and all three recede into a spine. */}
              {/* The switch above names the section and counts it; a head
                  here would say it twice (the repetition law). */}
              <div className="pad-x"><div className="card list-card-ruled">
                {needsYou.map((r) => threadRow(r, effTriage[r.id]?.gist, false, true))}
              </div></div>
              {/* L2: the list ends somewhere and says so. This floor once
                  carried count={restCount}, which printed "27 more are
                  waiting for next time" under a COMPLETE list of three:
                  those 27 were The Rest, a different list with its own pill
                  a scroll below. A floor may only count what it is the
                  floor OF. */}
              <ListFloor>That&rsquo;s every one that needs you.</ListFloor>
            </>
          )}
          {waiting.length > 0 && (() => {
            const shown = outcomeShown(outcome, needsYou, waiting, decideFor);
            if (shown !== "waiting" && shown !== "owed") return null;
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
            return (
            <>
              {shown === "waiting" && owed.length > 0 && (<>
              {/* E1 (2026-08-23): the count moved onto the head and the
                  standing sentence under it went away. It said "all of these
                  are past the point where another email helps" on every
                  render where every row was firm, which in a real aged inbox
                  is every render. Permanent helper text is not help.
                  2026-09-02: the switch above names and counts the section;
                  the head stays only as the slot the deck's controls use. */}
              <div className="sh2 sh2-quiet outcome-head">
                <span className="t">Waiting On</span>
                {/* E6: one decision on screen, nothing else. Not a batch
                    verb, which this head is forbidden (a batch here would
                    send real emails); each card still takes its own tap. */}
                {/* WAVE 4, DUPLICATE DOORS (2026-08-29). "One at a Time"
                    used to sit here AND as a launcher row a few hundred
                    lines up, same label, same setWaitDeck(0), same gate
                    (owed.length > 1 both times, computed from the identical
                    filter). Two buttons, one destination, one screen. The
                    launcher wins because it carries the count and the oldest
                    wait, which is the fact that decides whether you start;
                    this one carried nothing but its own name. */}
              </div>
              {/* E5: banded by age, because age is this section's organizing
                  fact, and the label on the band is what lets the number
                  leave every row. E2: THE ASK LEADS. The verb was a pill at
                  the row's far edge; it is the headline now, because "Open a
                  Dispute" is the decision and "Summitgear" is only context.
                  The tone that used to color a number colors the rail. */}
              {waitDeck !== null && owed.length > 0 ? (() => {
                const i = Math.min(waitDeck, owed.length - 1);
                const { w, d } = owed[i]!;
                const advance = () => setWaitDeck(i + 1 < owed.length ? i + 1 : null);
                return (
                  <div className="pad-x">
                    <div className="card pad wait-card">
                      <div className="conn-meta">{nameFor(names, w.toEmail, w.to)} &middot; {capAfterNumber(w.waitingDays + " days")}</div>
                      <div className="wait-card-subj">{w.subject}</div>
                      {opens[w.threadId] && <div className="conn-meta">{waitingLine(w, opens[w.threadId]!)}</div>}
                      <div className="momentum-actions wait-card-acts">
                        <button className="pill-act" onClick={() => void startNudge(w)}>{nudging === w.threadId ? "Drafting…" : d.primary.label}</button>
                        {d.alternates.length > 0 && <button className="btn-sm" onClick={() => setMore({ row: w, d })}>More Moves</button>}
                        <button className="btn-sm" onClick={() => dropRow(w.threadId)}>Let It Go</button>
                        <button className="btn-sm" onClick={advance}>Skip</button>
                      </div>
                      <div className="wait-card-count">
                        {capAfterNumber((i + 1) + " of " + owed.length)}
                        <button className="quiet-action" onClick={() => setWaitDeck(null)}>Show the List</button>
                      </div>
                    </div>
                  </div>
                );
              })() : (() => {
                const bands = ageBands(owed, ({ w }) => w.waitingDays);
                const heads = showBandHeads(bands);
                return bands.map((band) => (
                <div key={band.label}>
                  {heads && <div className="msg-fold-head">{band.label}<span className="band-n">{band.rows.length}</span></div>}
                  <div className="pad-x"><div className="card list-card-ruled">
                  {band.rows.map(({ w, d }) => (
                    <LetGoSwipe
                      key={w.threadId}
                      onMore={d.alternates.length ? () => setMore({ row: w, d }) : undefined}
                      onLetGo={() => dropRow(w.threadId)}
                    >
                    <div className="row" role="button" tabIndex={0} onClick={() => void startNudge(w)}>
                      <span className={railClass(false, railToneForWaiting(d.tone))}></span>
                      <div className="row-grow">
                        <div className="msg-line">
                          <span className="conn-name truncate">{nudging === w.threadId ? "Drafting…" : d.primary.label}</span>
                        </div>
                        <div className="conn-meta msg-gist">
                          {nameFor(names, w.toEmail, w.to)} · {w.subject}
                          {opens[w.threadId] ? " · " + waitingLine(w, opens[w.threadId]!) : ""}
                          {g.accounts.length > 1 && w.account && <span className="msg-acct">{acctLabel(w.account)}</span>}
                        </div>
                      </div>
                    </div>
                    </LetGoSwipe>
                  ))}
                  </div></div>
                </div>
                ));
              })()}
              </>)}
              {/* Nothing is owed on these, so they get their own quiet band
                  and an honest button instead of sitting in Waiting On
                  pretending somebody is late. */}
              {shown === "owed" && unowed.length > 0 && (
                <>
                  <div className="sh2 sh2-quiet outcome-head">
                    <span className="t">Nothing Owed</span>
                    <button className="see-all pill-action" onClick={() => void dropAll(unowed.map(({ w }) => w))}>Archive These</button>
                  </div>
                  <div className="pad-x"><div className="card list-card-ruled">
                    {unowed.map(({ w, d }) => (
                      <LetGoSwipe
                        key={w.threadId}
                        onMore={d.alternates.length ? () => setMore({ row: w, d }) : undefined}
                        onLetGo={() => dropRow(w.threadId)}
                      >
                      <div className="row" role="button" tabIndex={0} onClick={() => dropRow(w.threadId)}>
                        <span className="msg-rail"></span>
                        <div className="row-grow">
                          <div className="msg-line">
                            <span className="conn-name truncate">{d.primary.label}</span>
                          </div>
                          <div className="conn-meta msg-gist">{nameFor(names, w.toEmail, w.to)} · {w.subject}</div>
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
                <div className="row" role="button" tabIndex={0} onClick={() => { setRestOpen(!restOpen); setPicked(null); }}>
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
                    {/* E10: the one place bulk select lives. The fold holds
                        everything that does not need Dave, which is exactly
                        the pile where clearing ten at once is safe. */}
                    {picked === null ? (
                      <div className="fold-tools">
                        <button className="quiet-action" onClick={() => setPicked(new Set())}>Select</button>
                      </div>
                    ) : (
                      <div className="fold-tools">
                        <button className="btn-sm" onClick={() => void archivePicked([...worthKnowing, ...noise])} disabled={picked.size === 0}>
                          {picked.size === 0 ? "Archive Selected" : capAfterNumber("Archive " + picked.size)}
                        </button>
                        {/* 11B: the other half of the job. Archive keeps it
                            in the account; delete is for the mail that should
                            not be in the account at all. Both count what
                            landed, both undo. */}
                        <button className="btn-sm btn-danger" onClick={() => void deletePicked([...worthKnowing, ...noise])} disabled={picked.size === 0}>
                          {picked.size === 0 ? "Delete Selected" : capAfterNumber("Delete " + picked.size)}
                        </button>
                        <button className="quiet-action" onClick={() => setPicked(null)}>Done</button>
                      </div>
                    )}
                    {worthKnowing.length > 0 && (
                      <>
                        <div className="msg-fold-head">Worth Knowing</div>
                        {worthKnowing.map((r) => threadRow(r, effTriage[r.id]?.gist, true))}
                      </>
                    )}
                    {noise.length > 0 && (
                      <>
                        <div className="msg-fold-head">Noise</div>
                        {/* 8A: ONE GREY LINE FOR ALL OF THEM. This was a
                            full row with a bold name, which is the sensory
                            flatness the catalog is against: a shipping promo
                            wearing the same weight as a person. The count is
                            a fact, not an alarm, and the one action ends the
                            lot. Tap the line to unfold if you want to look. */}
                        <div className="msg-machines" role="button" tabIndex={0} onClick={() => setNoiseOpen(!noiseOpen)}>
                          <span className="msg-machines-icon" aria-hidden="true"><Tag className="ic" /></span>
                          <span className="msg-machines-text">
                            {capAfterNumber(noise.length === 1 ? "1 machine wrote" : noise.length + " machines wrote")}
                            {" \u00b7 "}{noiseOpen ? "Tap to fold" : "Tap to look"}
                          </span>
                          <button className="pill-act msg-machines-sweep" onClick={(e) => { e.stopPropagation(); void archiveAllNoise(noise); }}>
                            Sweep
                          </button>
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
                                  {noiseGroups[g.key] && g.rows.map((r) => threadRow(r, effTriage[r.id]?.gist, true))}
                                </div>
                              ))}
                              {loose.map((r) => threadRow(r, effTriage[r.id]?.gist, true))}
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
                onClick={() => void (async () => {
                  // ASKED MEANS ASKED (2026-08-25). This incremented `ended`
                  // off an un-awaited call, so the receipt said "Asked 3
                  // senders to stop" whether or not a single one went out.
                  // The file's own header says NEVER CLAIMS IT WORKED; the
                  // count of asks was itself the claim.
                  //
                  // A sender whose ask did NOT go out is not left in limbo:
                  // it falls through to the Noise rule, which is the outcome
                  // that does not depend on anyone else's server.
                  let ended = 0;
                  let filed = 0;
                  for (const c of sweep) {
                    markAsked(c.sender);
                    const u = c.canUnsub ? unsubbable[c.sender] : undefined;
                    if (u && await requestUnsub(u)) { ended++; continue; }
                    setRules(saveRule(c.sender, "noise"));
                    filed++;
                  }
                  setSweep([]);
                  setToast(sweepReceipt(ended, filed));
                  setTimeout(() => setToast(null), 4000);
                })()}
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
              <button className="btn btn-secondary btn-block" onClick={enableAutoNoise}>Clear Noise Automatically from Now On</button>
              <button className="quiet-action" onClick={() => setAutoOffer(false)}>Keep it manual</button>
            </div>
          ) : null}
          {/* E12 (2026-08-23): the close-out. It goes at the bottom because
              that is where you arrive having finished, and it is the only
              thing on this tab that says the day went anywhere.
              Two derived facts, no confetti and no advice. Every number here
              is counted, never estimated: `cleared` is incremented where the
              archives actually happen, and the other two are the lists on
              this screen. A zero is not dressed up as an achievement. */}
          {triageState === "ready" && (() => {
            const line = closeOut(cleared, rows.length, needsYou.length);
            // Null means there is nothing true to say: nothing cleared and
            // things still owed. The Needs You section already carries that.
            if (!line) return null;
            return (
              <div className="pad-x close-out">
                <div className="close-title">{line.title}</div>
                <div className="close-sub">{line.sub}</div>
              </div>
            );
          })()}
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
      {/* The two jobs that are not today's mail, at the floor of the screen
          where they cannot compete with it. Standing Rules is what you built;
          Clean Out is 11C, the account rather than the day. Both are quiet on
          purpose: neither is a thing you should be pulled into while you are
          trying to get through the morning, and a bulk-delete door that
          shouts is a bulk-delete door somebody taps on momentum. */}
      {(Object.keys(rules).length > 0 || muted.length > 0 || unmutedRows.length > 0) && (
        <div className="pad-x foot-links">
          {(Object.keys(rules).length > 0 || muted.length > 0) && (
            <button className="quiet-action" onClick={() => setView("rules")}>Standing Rules</button>
          )}
          {/* WAVE 4, DUPLICATE DOORS (2026-08-29). The Mission Deck's own
              note says "the tiny links are gone", and this one never went:
              a Clean Out foot pill sat under a Clean Out mode card carrying
              the same handler, on every render where triage was ready.
              It is not deleted, because the deck card is gated on
              triageState === "ready" and this is the only door before then.
              It is now the FALLBACK it was supposed to become. */}
          {unmutedRows.length > 0 && triageState !== "ready" && (
            <button className="quiet-action" onClick={() => { setPurgePicks(null); setView("purge"); }}>Clean Out</button>
          )}
        </div>
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
