// WHAT THIS REPLY HAS TO ANSWER, FOR THE EMAIL TAB'S COMPOSER (Dave 2026-10-12, ruling 7: "Answered X of Y").
//
// The reading is the thread's one brief (messages/threadBrief.ts): the same single-flight door, the same cache by
// account and content revision, so a thread is read at most once per revision on this phone. It runs when the
// SOURCE changes (the mailbox, the thread), never as the words are typed; the check of the draft against what was
// asked is local and debounced (messages/coverage/ReplyCoverage.tsx). The thread comes from the server's mail cache
// (thread_messages, then each message's text), not from Gmail.
//
// The AI gate is the whole condition. AI Off, or the admin's switch, shows nothing at all: no line, no error, no
// call, not even a cached reading. On Request reads a cached reading only: the reply was not a request for AI.
import { useEffect, useMemo, useState } from "react";
import { aiCallAllowed, effectiveLevel } from "../ai/aiGate";
import { getAIControl, isAdminAiBlocked } from "../ai/levelStore";
import { briefFor, isCurrentBrief, loadBriefs } from "../messages/brief";
import { revisionOf, type SourceInput } from "../messages/briefSource";
import type { ReplyRequirements } from "../messages/mailContracts";
import { ensureThreadBrief, type ThreadBriefAI } from "../messages/threadBrief";
import type { RpcClient } from "../substrate/commands/errors";
import { readMessage } from "./emailClient";
import { textOf } from "./candidates";
import { threadMessages } from "./waiting";
import type { DraftFields } from "./drafts";

/** The newest messages a reading takes from a thread: enough for what was asked, bounded so a long thread stays one read. */
export const COVERAGE_MESSAGES = 8;

/** The thread a draft answers, or null when it is not a reply (a new compose, a forward). */
export function replyThreadOf(f: Pick<DraftFields, "thread_id" | "reply_headers">): string | null {
  const thread = f.reply_headers?.thread_id || f.thread_id;
  return thread && f.reply_headers?.in_reply_to ? thread : null;
}

/** Whether the gate lets the indicator show at all, and whether it may make a reading of its own. */
export function coverageGate(ai: ThreadBriefAI | null | undefined): { show: boolean; read: boolean } {
  if (!ai?.available || isAdminAiBlocked()) return { show: false, read: false };
  const level = effectiveLevel(getAIControl());
  if (level === "off") return { show: false, read: false };
  return { show: true, read: aiCallAllowed(level, true) };
}

export function useEmailReplyRequirements(a: {
  client: RpcClient | null;
  ai: ThreadBriefAI | null | undefined;
  userId: string;
  /** The mailbox the reply is from. */
  account: string | null;
  threadId: string | null;
  selfEmails: readonly string[];
}): ReplyRequirements | undefined {
  const gate = coverageGate(a.ai);
  const key = gate.show && a.client && a.account && a.threadId ? [a.userId, a.account, a.threadId, gate.read ? "r" : "c"].join("␟") : "";
  const [found, setFound] = useState<{ key: string; reqs: ReplyRequirements | undefined } | null>(null);
  const selfKey = useMemo(() => a.selfEmails.join(","), [a.selfEmails]);
  useEffect(() => {
    if (!key || !a.client || !a.account || !a.threadId) return;
    let on = true;
    const client = a.client, account = a.account, threadId = a.threadId;
    const scope = { userId: a.userId, account };
    const done = (reqs: ReplyRequirements | undefined) => { if (on) setFound({ key, reqs }); };
    void (async () => {
      const t = await threadMessages(client, threadId);
      if (!on) return;
      if (!t.ok || t.value.length === 0) { done(undefined); return; }
      const msgs = [...t.value].filter((m) => !m.deleted).sort((x, y) => x.internal_date.localeCompare(y.internal_date) || x.id.localeCompare(y.id)).slice(-COVERAGE_MESSAGES);
      const revision = revisionOf(msgs, threadId);
      const cached = briefFor(revision, loadBriefs(), scope);
      if (isCurrentBrief(cached)) { done(cached.replyRequirements); return; }
      if (!gate.read || !a.ai) { done(undefined); return; }
      const bodies: SourceInput[] = [];
      for (const m of msgs) {
        const r = m.has_body ? await readMessage(client, m.id) : null;
        if (!on) return;
        bodies.push({ id: m.id, from: m.from_name || m.from_address, fromEmail: m.from_address, dateMs: Date.parse(m.internal_date), body: r && r.ok ? textOf(r.value) : m.snippet });
      }
      const r = await ensureThreadBrief({ ai: a.ai, scope, threadId, subject: msgs[msgs.length - 1]?.subject, messages: bodies, selfEmails: a.selfEmails });
      done(r.brief?.replyRequirements);
    })();
    return () => { on = false; };
    // The source is the whole dependency: typing never restarts this.
  }, [key, selfKey]);
  return found && found.key === key ? found.reqs : undefined;
}
