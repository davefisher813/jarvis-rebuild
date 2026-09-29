import type { GoogleApi } from "../connections/google/api";
import { b64urlDecodeBytes, mapGmailFull, type GmailFull, type GmailPart, type GmailThreadFull, type ThreadRow } from "../connections/google/map";
import { pool, singleFlight } from "./inboxRefresh";
import { mailAccountKey, mailThreadKey, type MailScope } from "./mailIdentity";
import { isMachineAddress, isNoReply } from "./noReply";
import type { NotificationClassification } from "./mailContracts";
import type { TriageMap } from "./triage";
import {
  analyzeNotification, extractActionEvidence, rememberCode,
  type ActionEvidenceBundle, type EntryLookup, type NotificationEntry,
} from "./notificationActions";

// THE ONE PLACE A NOTIFICATION'S BODY IS READ (2026-09-29).
//
// Reading a message's links needs its body, and bodies are the expensive read
// (one request per thread). So this reads a body only for a thread that is
//   - LIKELY a notification (a machine sender, a subject that says so, or a
//     triage kind), and
//   - has no answer for its CURRENT message (no cache entry for that revision).
// The answer is cached per account and thread, "nothing to do" included, so a
// message that holds no action is not read again until a newer message arrives.
//
// Nothing here runs on a Today visit. Today reads the snapshot, which reads
// this cache; the reads happen in a refresh that already found a new message
// (the pump, or the Email tab), and a refresh that found nothing new finds
// every thread already answered and reads nothing.
//
// There is no shared body cache in this app to reuse (each screen fetches its
// own threads), so the callers pass ONE `readThread` for the whole pass: the
// anchor pass and this scan ask for the same thread and Gmail is asked once.
//
// Codes are the exception to "cached": the action is cached, the code is not.
// It goes to short-lived memory (notificationActions.ts) and nowhere else.

const KEY = "jarvis.mail.notify.v1";
const CAP = 300;
/** Bodies read per pass. The newest first; the rest wait for the next pass. */
export const SCAN_LIMIT = 12;
/** Calendar attachments fetched per pass, on top of the bodies. */
const ATTACHMENT_LIMIT = 6;
const CONCURRENCY = 3;

type Store = Pick<Storage, "getItem" | "setItem">;
type AllEntries = Record<string, Record<string, NotificationEntry>>;

const memory = new WeakMap<object, string>();

function readEntry(v: unknown): NotificationEntry | null {
  if (typeof v !== "object" || v === null) return null;
  const e = v as Record<string, unknown>;
  if (typeof e.rev !== "string" || !e.rev || typeof e.at !== "number") return null;
  // The action is re-checked by the reader of a snapshot (readStoredAction);
  // here it is carried, and a null is a cached "nothing to do".
  return {
    rev: e.rev, at: e.at,
    action: e.action && typeof e.action === "object" ? (e.action as NotificationEntry["action"]) : null,
    ...(e.bulk === true ? { bulk: true } : {}),
    ...(e.view === "code" ? { view: "code" as const } : {}),
  };
}

function readAll(storage: Pick<Storage, "getItem">): AllEntries {
  try {
    const raw = memory.get(storage) ?? storage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as { v?: unknown; accounts?: unknown } | null;
    if (!p || p.v !== 1 || typeof p.accounts !== "object" || p.accounts === null || Array.isArray(p.accounts)) return {};
    const out: AllEntries = {};
    for (const [acct, entries] of Object.entries(p.accounts as Record<string, unknown>)) {
      if (typeof entries !== "object" || entries === null) continue;
      const m: Record<string, NotificationEntry> = {};
      for (const [id, v] of Object.entries(entries as Record<string, unknown>)) { const e = readEntry(v); if (e) m[id] = e; }
      out[acct] = m;
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(storage: Store, all: AllEntries): void {
  const text = JSON.stringify({ v: 1, accounts: all });
  try { storage.setItem(KEY, text); memory.delete(storage); } catch { memory.set(storage, text); }
}

export function loadNotificationEntries(scope: MailScope, storage: Pick<Storage, "getItem"> = localStorage): Record<string, NotificationEntry> {
  return readAll(storage)[mailAccountKey(scope)] ?? {};
}

export function saveNotificationEntries(scope: MailScope, entries: Record<string, NotificationEntry>, storage: Store = localStorage): void {
  const all = readAll(storage);
  const ids = Object.keys(entries);
  const keep = ids.length > CAP ? ids.slice(ids.length - CAP) : ids;
  const trimmed: Record<string, NotificationEntry> = {};
  for (const id of keep) trimmed[id] = entries[id]!;
  all[mailAccountKey(scope)] = trimmed;
  writeAll(storage, all);
}

/** A lookup over every account's entries, read once. Each account's entries are its own: two mailboxes never share a thread's answer. */
export function notificationLookup(userId: string, accounts: readonly string[], storage: Pick<Storage, "getItem"> = localStorage): EntryLookup {
  const all = readAll(storage);
  const byThread = new Map<string, NotificationEntry>();
  for (const account of accounts) {
    const entries = all[mailAccountKey({ userId, account })] ?? {};
    for (const [id, e] of Object.entries(entries)) byThread.set(mailThreadKey({ userId, account }, id), e);
  }
  return (account, threadId) => (account ? byThread.get(mailThreadKey({ userId, account }, threadId)) : undefined);
}

/** Removes everything this device remembers about notifications (sign-out, Clear Local Data). */
export function clearNotificationEntries(storage: Pick<Storage, "removeItem"> = localStorage): void {
  try { storage.removeItem(KEY); } catch { /* private mode */ }
}

// ---------------------------------------------------------------------------
// Who is worth a body read
// ---------------------------------------------------------------------------

const NOTIFY_WORDS = /verification code|security code|one[- ]time|passcode|your code|sign[- ]?in code|access request|requesting access|shared .{0,60}with you|invited you|invitation:|invitation from|docusign|signature|please sign|review and sign|shipped|out for delivery|tracking|track your|payment (failed|declined|unsuccessful)|card (was )?declined|update your (payment|billing)|flight|itinerary|reservation|boarding pass|hotel|unsubscribe/i;
const NOTIFIER_DOMAINS = /@(?:[a-z0-9-]+\.)*(?:google\.com|docusign\.(?:net|com)|hellosign\.com|amazon\.com|ups\.com|fedex\.com|usps\.com|dhl\.com|expedia\.com|booking\.com|airbnb\.com)$/i;

/**
 * Cheap, from what the list already holds: no body, no model. A human writing
 * a real message is never a candidate, so their thread is never read for links.
 */
export function isNotificationCandidate(
  row: Pick<ThreadRow, "fromEmail" | "subject" | "snippet">,
  triage?: { action?: unknown },
): boolean {
  if (triage?.action) return true;
  if (isNoReply(row.fromEmail) || isMachineAddress(row.fromEmail)) return true;
  if (NOTIFIER_DOMAINS.test(row.fromEmail || "")) return true;
  return NOTIFY_WORDS.test(row.subject + " " + row.snippet);
}

// ---------------------------------------------------------------------------
// Reading one message
// ---------------------------------------------------------------------------

function decodeText(b64url: string): string {
  const bytes = b64urlDecodeBytes(b64url);
  try { return new TextDecoder().decode(bytes); } catch { return ""; }
}

async function calendarParts(msg: GmailFull, api: Pick<GoogleApi, "getAttachment">, budget: { n: number }): Promise<string[]> {
  const found: string[] = [];
  const wanted: { attachmentId: string }[] = [];
  const walk = (part: GmailPart | undefined) => {
    if (!part) return;
    const p = part as GmailPart & { filename?: string; body?: { data?: string; attachmentId?: string } };
    const mime = (p.mimeType || "").toLowerCase();
    const isCal = mime === "text/calendar" || mime === "application/ics" || /\.ics$/i.test(p.filename || "");
    if (isCal) {
      if (p.body?.data) found.push(decodeText(p.body.data));
      else if (p.body?.attachmentId) wanted.push({ attachmentId: p.body.attachmentId });
    }
    for (const c of part.parts || []) walk(c);
  };
  walk(msg.payload as GmailPart | undefined);
  for (const w of wanted) {
    if (budget.n <= 0) break;
    budget.n--;
    try {
      const a = await api.getAttachment(msg.id, w.attachmentId);
      if (a.data) found.push(decodeText(a.data));
    } catch { /* a calendar we cannot read is no calendar: the rest still stands */ }
  }
  return found;
}

/**
 * The bundle for one message of a full thread read, or null when the thread
 * does not hold it. Shared by the scan and by the tap that has to fetch a code
 * again: same extraction, no model.
 */
export async function evidenceFromThread(
  raw: GmailThreadFull,
  o: { threadId: string; messageId?: string; revision: string; fallback: { fromEmail: string; subject: string } },
  api: Pick<GoogleApi, "getAttachment">,
  budget: { n: number } = { n: ATTACHMENT_LIMIT },
): Promise<{ bundle: ActionEvidenceBundle; messageId: string; bulk: boolean } | null> {
  const msgs = raw.messages ?? [];
  const msg = (o.messageId ? msgs.find((m) => m.id === o.messageId) : undefined) ?? (o.messageId ? undefined : msgs[msgs.length - 1]);
  if (!msg) return null;
  const full = mapGmailFull(msg);
  const ics = await calendarParts(msg, api, budget);
  const bundle = extractActionEvidence({
    threadId: o.threadId,
    messageId: msg.id,
    revision: o.revision,
    fromEmail: full.fromEmail || o.fallback.fromEmail,
    subject: full.subject || o.fallback.subject,
    body: full.body,
    html: full.html,
    listUnsubscribe: full.listUnsubscribe,
    ics,
  });
  return { bundle, messageId: msg.id, bulk: !!full.listUnsubscribe.trim() };
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

export interface ScanDeps {
  userId: string;
  account: string;
  api: Pick<GoogleApi, "getThread" | "getAttachment">;
  /** This account's rows. */
  rows: readonly ThreadRow[];
  triage: TriageMap;
  /** The optional model reading for a row: a triage kind, or the brief's. Never required. */
  classificationFor?: (row: ThreadRow) => NotificationClassification | undefined;
  /** One shared read for the whole pass, so two passes that want the same thread ask Gmail once. */
  readThread?: (threadId: string) => Promise<GmailThreadFull>;
  storage?: Store;
  now?: () => number;
  limit?: number;
  isCurrent?: () => boolean;
}

export interface ScanResult {
  /** Threads analysed and cached in this call. */
  scanned: number;
  /** Full thread reads this call asked for (the number the cost tests watch). */
  reads: number;
  failed: number;
  /** The cache changed, so a snapshot built from it is out of date. */
  wrote: boolean;
}

export function scanNotifications(deps: ScanDeps): Promise<ScanResult> {
  return singleFlight(`notify#${mailAccountKey({ userId: deps.userId, account: deps.account })}`, () => runScan(deps));
}

async function runScan(deps: ScanDeps): Promise<ScanResult> {
  const clock = deps.now ?? Date.now;
  const storage = deps.storage ?? localStorage;
  const scope = { userId: deps.userId, account: deps.account };
  const entries = { ...loadNotificationEntries(scope, storage) };
  const inWindow = new Set(deps.rows.map((r) => r.id));
  let wrote = false;
  // A thread that left the window takes its answer with it.
  for (const id of Object.keys(entries)) if (!inWindow.has(id)) { delete entries[id]; wrote = true; }

  const pending = deps.rows
    .filter((r) => entries[r.id]?.rev !== r.lastMsgId && isNotificationCandidate(r, deps.triage[r.id]))
    .sort((a, b) => b.dateMs - a.dateMs)
    .slice(0, deps.limit ?? SCAN_LIMIT);

  let scanned = 0;
  let reads = 0;
  let failed = 0;
  const budget = { n: ATTACHMENT_LIMIT };
  await pool(pending, CONCURRENCY, async (r) => {
    try {
      reads++;
      const raw = await (deps.readThread ? deps.readThread(r.id) : deps.api.getThread(r.id));
      const got = await evidenceFromThread(raw, { threadId: r.id, revision: r.lastMsgId, fallback: { fromEmail: r.fromEmail, subject: r.subject } }, deps.api, budget);
      if (!got) { failed++; return; }
      const now = clock();
      const res = analyzeNotification(got.bundle, {
        ...(deps.triage[r.id]?.bucket ? { bucket: deps.triage[r.id]!.bucket } : {}),
        ...(deps.classificationFor?.(r) ? { classification: deps.classificationFor(r)! } : {}),
        messageAtMs: r.dateMs,
        now,
      });
      if (res.action?.kind === "copy_code" && got.bundle.codes.length === 1) {
        rememberCode({ userId: deps.userId, account: deps.account, messageId: got.messageId }, got.bundle.codes[0]!, now);
      }
      entries[r.id] = {
        rev: r.lastMsgId, at: now, action: res.action,
        ...(got.bulk ? { bulk: true } : {}),
        ...(res.view ? { view: res.view } : {}),
      };
      scanned++;
      wrote = true;
    } catch {
      // A read that failed is not "nothing to do": nothing is cached, and the
      // thread is offered again on the next pass.
      failed++;
    }
  });

  if (deps.isCurrent && !deps.isCurrent()) return { scanned: 0, reads, failed, wrote: false };
  if (wrote) saveNotificationEntries(scope, entries, storage);
  return { scanned, reads, failed, wrote };
}
