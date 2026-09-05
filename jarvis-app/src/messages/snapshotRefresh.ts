import type { AIService } from "../ai/AIService";
import type { GoogleApi } from "../connections/google/api";
import { mapThread, type ThreadRow } from "../connections/google/map";
import {
  selfBlankGuard, loadTriageCache, saveTriageCache, triageDelta, buildTriageInput, parseTriage,
  TRIAGE_SCHEMA, fillSkipped, splitByBucket, sortByDeadline, type TriageMap,
} from "./triage";
import { loadRules, applyRules } from "./rules";
import { findWaiting } from "./waiting";
import { loadLetGo } from "./letGo";
import { loadSweep, liveSweep } from "./sentSweep";
import { loadPromised } from "./commitments";
import { loadChases, dueChases } from "./followUp";
import { displayName } from "./names";
import { briefFor } from "./brief";
import { saveMailSnapshot } from "./home";
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
const TRIAGE_BATCH = 12;
const TRIAGE_TIMEOUT_MS = 20000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Sorting took too long.")), ms)),
  ]);
}

export interface SnapshotRefreshDeps {
  /** Same accessor GoogleSession's useGoogle() exposes: g.apis("mail"). */
  apis: () => { email: string; api: GoogleApi }[];
  ai: AIService;
  now?: number;
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
  const failures: unknown[] = [];
  const perAccount = await Promise.all(list.map(async ({ email, api }) => {
    const metas = await api.listThreads(30).catch((e: unknown) => { failures.push(e); return null; });
    if (!metas) return [];
    return metas.map(mapThread)
      .filter((t): t is ThreadRow => t !== null && t.inInbox)
      .map((t) => ({ ...t, account: email }));
  }));
  if (failures.length === list.length) {
    throw failures[0] instanceof Error ? failures[0] : new Error("Could not load mail");
  }
  const rows = perAccount.flat().sort((a, b) => b.dateMs - a.dateMs);

  // Triage: cache-aware, same cache the Email tab reads and writes, so a
  // thread already sorted by a tab visit is never re-sent to the model.
  const cache = loadTriageCache();
  let merged: TriageMap = { ...cache };
  const delta = triageDelta(rows, cache);
  if (delta.length > 0 && ai.available) {
    for (let i = 0; i < delta.length; i += TRIAGE_BATCH) {
      const batch = delta.slice(i, i + TRIAGE_BATCH);
      try {
        const raw = await withTimeout(
          ai.complete(
            [{ role: "user", content: buildTriageInput(batch) }],
            "You output only a JSON array, nothing else.",
            { kind: "triage", schema: TRIAGE_SCHEMA },
          ),
          TRIAGE_TIMEOUT_MS,
        );
        const parsed = parseTriage(raw, batch);
        if (parsed) merged = fillSkipped({ ...merged, ...parsed }, batch);
      } catch {
        // This batch stays unsorted; the next refresh (or a real tab visit)
        // tries again. A missed sort is silent, a wrong one is not.
      }
    }
    merged = fillSkipped(merged, delta);
    saveTriageCache(merged);
  }

  const rules = loadRules();
  const map = selfBlankGuard(applyRules(merged, rows, rules), rows, list.map((a) => a.email));
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

  const todayIso = todayISO();
  const answeredThreads = rows.filter((r) => !waiting.some((w) => w.threadId === r.id)).map((r) => r.id);

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
      act: map[r.id]?.act,
      account: (r as ThreadRow & { account?: string }).account,
      snippet: r.snippet ?? "",
      lastMsgId: r.lastMsgId,
      replies: briefFor(r.lastMsgId)?.replies,
    })),
    waiting: waiting.slice(0, 3).map((w) => ({
      threadId: w.threadId, to: displayName(w.to), subject: w.subject, days: w.waitingDays,
    })),
    promises: liveSweep(loadSweep(), loadPromised()).slice(0, 3),
    chases: dueChases(loadChases(), todayIso, answeredThreads).slice(0, 2).map((c) => ({
      threadId: c.threadId, to: c.to, subject: c.subject,
    })),
  });
}
