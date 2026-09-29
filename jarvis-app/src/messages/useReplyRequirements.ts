import { useEffect, useState } from "react";
import type { ThreadFull } from "../connections/google/map";
import { briefFor, isCurrentBrief, loadBriefs } from "./brief";
import { revisionOf } from "./briefSource";
import type { ReplyRequirements } from "./mailContracts";
import { ensureThreadBrief, type ThreadBriefAI } from "./threadBrief";

// WHAT THE REPLY IN FRONT OF YOU HAS TO ANSWER, WITHOUT ANOTHER READ (2026-09-29).
//
// A reply belongs to one conversation at one revision in one mailbox: the
// SOURCE. This finds what that conversation asked, from the one place the
// answer already lives, and in this order:
//
//   1. the brief cache, keyed by account and revision: zero calls. Reply from
//      an open thread lands here, because opening it read the thread.
//   2. the open thread, through ensureThreadBrief: the same single-flight door
//      openThread uses, so the two can never read one thread twice.
//   3. a thread that is not open (a draft restored from Continue Your Reply or
//      the Drafts list): fetched once, then through the same door.
//
// It is NEVER run per keystroke. It runs when the source changes: a new draft,
// a different thread, a different revision, another mailbox. Typing does not
// change the source.

/** Where a reply came from. Account, thread and revision travel with the draft. */
export interface ReplySource { account: string; threadId: string; revision: string }

/**
 * The source of a draft, or null when it is not a reply: a new compose and a
 * forward have no thread they are answering, and a forward's copy of the mail
 * is not a set of questions put to the person writing it.
 */
export function replySourceOf(
  d: { threadId?: string; inReplyTo?: string; account?: string; sourceRevision?: string },
  fallback: { account: string; revision?: string },
): ReplySource | null {
  if (!d.threadId || !d.inReplyTo) return null;
  const revision = d.sourceRevision ?? fallback.revision;
  const account = d.account ?? fallback.account;
  if (!revision || !account) return null;
  return { account, threadId: d.threadId, revision };
}

export interface RequirementsArgs {
  ai: ThreadBriefAI;
  userId: string;
  source: ReplySource | null;
  /** The thread on screen, when there is one. Used only if it is this source's thread and revision. */
  thread: ThreadFull | null;
  /** Fetches a thread that is not open. Null when the mailbox is not connected. */
  loadThread: (account: string, threadId: string) => Promise<ThreadFull | null>;
  selfEmails: readonly string[];
}

export function useReplyRequirements(a: RequirementsArgs): ReplyRequirements | undefined {
  const [found, setFound] = useState<{ key: string; reqs: ReplyRequirements | undefined } | null>(null);
  const s = a.source;
  const key = s ? [a.userId, s.account, s.threadId, s.revision].join("␟") : "";
  useEffect(() => {
    if (!s) return;
    let on = true;
    const scope = { userId: a.userId, account: s.account };
    const done = (reqs: ReplyRequirements | undefined) => { if (on) setFound({ key, reqs }); };
    void (async () => {
      const cached = briefFor(s.revision, loadBriefs(), scope);
      if (isCurrentBrief(cached)) { done(cached.replyRequirements); return; }
      let t = a.thread && a.thread.id === s.threadId && revisionOf(a.thread.messages, a.thread.id) === s.revision ? a.thread : null;
      if (!t) t = await a.loadThread(s.account, s.threadId).catch(() => null);
      if (!t || !on) { done(undefined); return; }
      const r = await ensureThreadBrief({
        ai: a.ai, scope, threadId: t.id, subject: t.subject, messages: t.messages, selfEmails: a.selfEmails,
      });
      done(r.brief?.replyRequirements);
    })();
    return () => { on = false; };
    // The source is the whole dependency: typing must never restart this.
  }, [key]);
  // An answer for another source is not this one's.
  return found && found.key === key ? found.reqs : undefined;
}
