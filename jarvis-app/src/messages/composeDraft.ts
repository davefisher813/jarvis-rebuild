// THE LOCAL COMPOSE DRAFT (E-26, Email Build Master 2026-09-12, Push F).
//
// Cancel saves to Gmail Drafts (EMAIL-F-14) and that is still the one path
// that writes to Gmail Drafts. This is the other half of not losing his
// words: the composer autosaves every change HERE, on this device, so a
// tab killed mid-sentence, a phone call, or a crash reopens with the draft
// exactly where it was. Local only, never mirrored, never an event
// (laws/email.test.ts, laws 1 and 8): a half-typed mail is the most private
// text in the app.
//
// Keyed by the Gmail draft being edited, or "new" for anything that is not
// one yet: a fresh compose and a reply share the "new" seat, and the reply
// carries its threadId so For You can offer "Continue Your Reply" for it.

export const DRAFT_KEY = "jarvis.mail.composeDraft.v1";
const CAP = 20;

export interface LocalDraft {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  threadId?: string;
  account?: string;
  inReplyTo?: string;
  savedAt: number;
}

export type LocalDrafts = Record<string, LocalDraft>;

export function draftKey(editingDraftId: string | null | undefined): string {
  return editingDraftId || "new";
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export function loadLocalDrafts(storage: Pick<Storage, "getItem"> = localStorage): LocalDrafts {
  try {
    const p = JSON.parse(storage.getItem(DRAFT_KEY) || "{}") as unknown;
    if (typeof p !== "object" || p === null || Array.isArray(p)) return {};
    const out: LocalDrafts = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      const d = v as Partial<LocalDraft> | null;
      if (!d || typeof d !== "object" || typeof d.savedAt !== "number") continue;
      out[k] = {
        to: str(d.to) ?? "",
        subject: str(d.subject) ?? "",
        body: str(d.body) ?? "",
        savedAt: d.savedAt,
        ...(str(d.cc) !== undefined || d.cc === "" ? { cc: typeof d.cc === "string" ? d.cc : "" } : {}),
        ...(str(d.threadId) ? { threadId: d.threadId as string } : {}),
        ...(str(d.account) ? { account: d.account as string } : {}),
        ...(str(d.inReplyTo) ? { inReplyTo: d.inReplyTo as string } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function loadLocalDraft(key: string, storage: Pick<Storage, "getItem"> = localStorage): LocalDraft | null {
  return loadLocalDrafts(storage)[key] ?? null;
}

function write(all: LocalDrafts, storage: Pick<Storage, "setItem">): void {
  const keys = Object.keys(all).sort((a, b) => all[a]!.savedAt - all[b]!.savedAt).slice(-CAP);
  const trimmed: LocalDrafts = {};
  for (const k of keys) trimmed[k] = all[k]!;
  try { storage.setItem(DRAFT_KEY, JSON.stringify(trimmed)); } catch { /* private mode */ }
}

/** Whether there is anything worth keeping. A draft with no words in any
 *  field is not a draft, and saving it would only offer him nothing later. */
export function draftHasWords(d: Pick<LocalDraft, "to" | "cc" | "subject" | "body">): boolean {
  return !!(d.to.trim() || (d.cc ?? "").trim() || d.subject.trim() || d.body.trim());
}

export function saveLocalDraft(
  key: string,
  d: Omit<LocalDraft, "savedAt">,
  now = Date.now(),
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): void {
  const all = loadLocalDrafts(storage);
  if (!draftHasWords(d)) { delete all[key]; write(all, storage); return; }
  all[key] = { ...d, savedAt: now };
  write(all, storage);
}

export function clearLocalDraft(key: string, storage: Pick<Storage, "getItem" | "setItem"> = localStorage): void {
  const all = loadLocalDrafts(storage);
  if (!(key in all)) return;
  delete all[key];
  write(all, storage);
}

/** E-25: the reply worth offering on For You. A local draft with a thread
 *  and words in its body; the newest if there are several. Null otherwise. */
export function continuableReply(all: LocalDrafts): { key: string; draft: LocalDraft } | null {
  let best: { key: string; draft: LocalDraft } | null = null;
  for (const [key, draft] of Object.entries(all)) {
    if (!draft.threadId || !draft.body.trim()) continue;
    if (!best || draft.savedAt > best.draft.savedAt) best = { key, draft };
  }
  return best;
}

/** E-26: what a reopened composer starts from. The saved "new" draft wins
 *  over a fresh one when it is for the same conversation (both with no
 *  thread, or both with this thread); a saved reply never leaks into a
 *  fresh compose and vice versa. */
type Composable = { to: string; subject: string; body: string; cc?: string; threadId?: string; account?: string; inReplyTo?: string };
export function restoreInto<T extends Composable>(fresh: T, saved: LocalDraft | null): T {
  if (!saved || !draftHasWords(saved)) return fresh;
  if ((saved.threadId ?? null) !== (fresh.threadId ?? null)) return fresh;
  return {
    ...fresh,
    to: saved.to,
    subject: saved.subject,
    body: saved.body,
    ...(saved.cc !== undefined ? { cc: saved.cc } : {}),
    ...(saved.account ? { account: saved.account } : {}),
    ...(saved.inReplyTo ? { inReplyTo: saved.inReplyTo } : {}),
  };
}
