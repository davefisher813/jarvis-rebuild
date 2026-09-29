import type { AIService } from "../ai/AIService";
import type { GoogleApi } from "../connections/google/api";
import type { GmailThreadFull, ThreadRow } from "../connections/google/map";
import {
  selfBlankGuard, loadTriageView, saveTriageView, splitByBucket, sortByDeadline, type TriageMap,
} from "./triage";
import { refreshInboxAccounts, ensureThreadAnalysis } from "./inboxRefresh";
import { loadRules, applyRules } from "./rules";
import { anchorNeedsYou } from "./evidencePass";
import { makePersonIdFor, noPersonId, type PersonEmail } from "./personFor";
import { mapThreadFull } from "../connections/google/map";
import { findWaiting } from "./waiting";
import { loadLetGo } from "./letGo";
import { loadSweep, liveSweep } from "./sentSweep";
import { loadPromised } from "./commitments";
import { loadChases, dueChases } from "./followUp";
import { displayName } from "./names";
import { briefFor } from "./brief";
import { saveMailSnapshot } from "./home";
import { buildNotificationSnapshot, classificationFrom, redactCodes } from "./notificationActions";
import { notificationLookup, scanNotifications } from "./notificationScan";
import { loadUnsubs } from "./unsubRecords";
import { todayISO } from "../schedule/calendar";

// S6-Q34 (2026-09-04): "the email band only fills if you visit the Email
// tab." The home-page snapshot (home.ts's MailSnapshot) had exactly one
// writer -- MessagesFlow.tsx's own effect, which only ever runs while the
// Email tab is mounted -- so connecting Gmail and never opening that tab (or
// not opening it in 36 hours) left Today's email section permanently empty,
// even with real, actionable mail sitting in the inbox.
//
// This is the same build, callable with no component mounted at all: fetch,
// triage (cache-aware -- a thread the Email tab already sorted costs nothing
// here), waiting, and already-tracked promises/chases, then save. It is a
// second implementation of the assembly MessagesFlow.tsx's own effect does
// (see that file's "THE HOME SNAPSHOT" comment) -- deliberately, since
// extracting a shared assembler would mean threading this module's return
// shape through MessagesFlow's live component state, a much larger and
// riskier change to a 3700-line file for one catalog item. Both read and
// write the exact same MailSnapshot shape in home.ts, so a field added there
// needs a matching line in both places; each side says so in its own
// comment.
//
// Scoped down from the tab's own build in two ways, both deliberate:
//   - meetings: needs a schedule service AND a second, per-thread AI call
//     (see MessagesFlow's findMeetings) -- the most speculative, most
//     expensive enrichment, and the one the Email tab already only shows for
//     the rare thread that actually proposes a time. Left for the tab.
//   - drafts: in the tab itself, drafts only ever load when the user visits
//     the Drafts filter (MessagesFlow's loadDrafts is gated on `filter ===
//     "drafts"`), so this field is already usually empty in the snapshot the
//     tab writes today. Leaving it empty here is not a regression.
// Everything else -- needsYou threads with their triage gist/deadline/act,
// Waiting On, already-swept promises, and due chases -- costs nothing beyond
// the Gmail fetch and the same triage call the tab would have spent anyway,
// and travels through unchanged.
// 2026-09-11: "answered" is read off the thread itself: its last message is
// from someone who is not him. It used to be "in the inbox but not in
// Waiting On", and Waiting On is capped at five and skips anything under two
// days old, so a thread still waiting on them counted as answered and its
// chase never fired. MessagesFlow uses this same function.
export function answeredThreadIds(rows: ThreadRow[], myEmails: string[]): string[] {
  const mine = new Set(myEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  return rows.filter((r) => r.fromEmail && !mine.has(r.fromEmail.trim().toLowerCase())).map((r) => r.id);
}

export interface SnapshotRefreshDeps {
  /** Same accessor GoogleSession's useGoogle() exposes: g.apis("mail"). */
  apis: () => { email: string; api: GoogleApi }[];
  /** Whose mail: every cache read and written here is scoped to this owner. */
  userId: string;
  ai: AIService;
  now?: number;
  // UP-MIND-10 (2026-09-05): Contacts, for the person id on every row that
  // has a counterpart. Optional: with no People service the snapshot is
  // exactly what it was before, never a broken one.
  people?: () => Promise<PersonEmail[]>;
}

export async function refreshMailSnapshot(deps: SnapshotRefreshDeps): Promise<void> {
  const { ai, now = Date.now() } = deps;
  const list = deps.apis();
  if (list.length === 0) return;

  // EMAIL-F-04 (2026-09-05): fetched zero and fetch failed are different
  // facts. This used to `.catch(() => [])` per account, so an expired token
  // or a dead network every four hours rewrote the snapshot as an empty
  // inbox with a fresh timestamp and blanked Today's band. An account that
  // fails is collected; if every account failed, this throws and the pump's
  // own catch leaves the last good snapshot standing until the next check.
  // A partial failure still writes: what came back is real mail, and real
  // beats stale.
  // 2026-09-29: this used to be a second implementation of the inbox read
  // (its own list, its own triage). It now asks the same coordinator the
  // Email tab does, so a tab visit and a pump tick in the same minute are ONE
  // read, "nothing changed" costs a list and a history read, and only the
  // threads whose content moved are analysed. An account that fails keeps its
  // last good rows (the refresh returns them, marked stale); if every account
  // failed this throws and the pump's own catch leaves the last good snapshot
  // standing until the next check.
  const out = await refreshInboxAccounts(deps.userId, list, { reason: "pump" });
  const failed = out.filter((o) => !o.result.ok);
  if (failed.length === list.length) {
    const e = failed[0]!.result.error;
    throw e instanceof Error ? e : new Error("Could not load mail");
  }
  const rows = out.flatMap((o) => o.result.rows).sort((a, b) => b.dateMs - a.dateMs);
  const accounts = list.map((a) => a.email);

  // Triage: cache-aware, same cache the Email tab reads and writes, so a
  // thread already sorted by a tab visit is never re-sent to the model. A
  // budget or sign-in refusal ends the loop: the rest would be refused too.
  if (ai.available) {
    for (const { email } of list) {
      const res = await ensureThreadAnalysis({ userId: deps.userId, account: email }, rows.filter((r) => r.account === email), { ai });
      if (res.status === "budget" || res.status === "auth") break;
    }
  }
  const merged: TriageMap = loadTriageView(deps.userId, accounts);

  const rules = loadRules();
  let map = selfBlankGuard(applyRules(merged, rows, rules), rows, list.map((a) => a.email));

  // ONE READ PER THREAD PER PASS (2026-09-29). The notification scan and the
  // anchor pass below both want full bodies, for overlapping threads. They ask
  // through this memo, so a thread wanted by both is one request. There is no
  // body cache across passes in this app to share; this is the sharing there is.
  const apiByAccount = new Map(list.map((a) => [a.email, a.api]));
  const bodies = new Map<string, Promise<GmailThreadFull>>();
  const readThread = (account: string, api: GoogleApi, id: string): Promise<GmailThreadFull> => {
    const k = account + "\u0000" + id;
    let p = bodies.get(k);
    if (!p) { p = api.getThread(id); bodies.set(k, p); }
    return p;
  };

  // NOTIFICATION ACTIONS (2026-09-29). Bodies are read only for threads that
  // look like notifications AND whose newest message has no answer yet; the
  // answer, "nothing to do" included, is cached. An unchanged inbox reads
  // nothing and asks no model anything. Deterministic: works with AI off. A
  // failure here never fails the snapshot.
  await Promise.all(list.map(({ email, api }) => scanNotifications({
    userId: deps.userId, account: email, api,
    rows: rows.filter((r) => r.account === email),
    triage: map,
    classificationFor: (r) => classificationFrom(map[r.id]?.action),
    readThread: (id) => readThread(email, api, id),
  }).catch(() => null)));

  // UP-MIND-12 (2026-09-05): the claims triage made from a 200-character
  // snippet get anchored to the sentence they came from, over the full body,
  // for the threads that need him. Capped and best-effort: a claim that
  // cannot be anchored keeps its place and renders without a chip.
  if (ai.available) {
    const before = map;
    map = await anchorNeedsYou(
      rows,
      map,
      async (id, account) => {
        const acct = account && apiByAccount.has(account) ? account : list[0]!.email;
        const full = mapThreadFull(await readThread(acct, apiByAccount.get(acct) ?? list[0]!.api, id));
        return { id: full.id, messages: full.messages.map((m) => ({ id: m.id, body: m.body })) };
      },
      (messages, system) => ai.complete(messages as { role: "user" | "assistant"; content: string }[], system),
    ).catch(() => before);
    if (map !== before) saveTriageView(deps.userId, rows, map);
  }
  const { needsYou } = splitByBucket(rows, map);
  const ordered = sortByDeadline(needsYou, map);

  const waitingPer = await Promise.all(list.map(async ({ email, api }) => {
    const w = await findWaiting(api, now).catch(() => []);
    return w.map((r) => ({ ...r, account: email }));
  }));
  const dropped = loadLetGo();
  const waiting = waitingPer.flat()
    .filter((r) => !dropped.includes(r.threadId))
    .sort((a, b) => b.waitingDays - a.waitingDays)
    .slice(0, 5);

  // UP-MIND-10: built ONCE per snapshot, because this build touches thirty
  // rows and reading the People list thirty times reads the same list thirty
  // times. A failed read means no ids, which is the old behaviour.
  const personIdFor = deps.people ? makePersonIdFor(await deps.people().catch(() => [])) : noPersonId;

  const todayIso = todayISO();
  const answeredThreads = answeredThreadIds(rows, list.map((a) => a.email));

  // The one helper the Email tab's own writer uses too: actionable threads
  // apart from the six rows, and each row's account, revision and action.
  const notif = buildNotificationSnapshot({
    owner: deps.userId, rows, map,
    entryFor: notificationLookup(deps.userId, accounts),
    asked: loadUnsubs(),
    excludeIds: new Set(ordered.slice(0, 6).map((r) => r.id)),
    now,
  });

  saveMailSnapshot({
    ts: Date.now(),
    owner: deps.userId,
    needsYou: needsYou.length,
    actionable: notif.actionable,
    threads: ordered.slice(0, 6).map((r) => ({
      id: r.id,
      from: displayName(r.from),
      fromEmail: r.fromEmail,
      subject: r.subject,
      gist: redactCodes(map[r.id]?.gist ?? r.snippet ?? ""),
      ...notif.fields(r),
      by: map[r.id]?.by,
      act: map[r.id]?.act,
      ...(map[r.id]?.byEv ? { byEv: map[r.id]!.byEv! } : {}),
      ...(map[r.id]?.actEv ? { actEv: map[r.id]!.actEv! } : {}),
      account: (r as ThreadRow & { account?: string }).account,
      ...(personIdFor(r.fromEmail) ? { personId: personIdFor(r.fromEmail)! } : {}),
      snippet: redactCodes(r.snippet ?? ""),
      lastMsgId: r.lastMsgId,
      replies: briefFor(r.lastMsgId)?.replies,
    })),
    waiting: waiting.slice(0, 3).map((w) => ({
      threadId: w.threadId, to: displayName(w.to), subject: w.subject, days: w.waitingDays,
      ...(personIdFor(w.toEmail) ? { personId: personIdFor(w.toEmail)! } : {}),
    })),
    promises: liveSweep(loadSweep(), loadPromised()).slice(0, 3),
    chases: dueChases(loadChases(), todayIso, answeredThreads).slice(0, 2).map((c) => ({
      threadId: c.threadId, to: c.to, subject: c.subject,
    })),
  });
}
