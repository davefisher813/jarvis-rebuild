import type { GoogleApi } from "../connections/google/api";
import { mapThread, type ThreadRow } from "../connections/google/map";
import { JARVIS_VOICE } from "../ai/voice";

// Waiting On (email 3): the loops running the OTHER way, emails the user
// sent that expect a reply and have not gotten one. Derived, never guessed:
// a thread qualifies only if the LAST message is the user's own and enough
// time has passed. If the other person replied, the last message would be
// theirs and the thread drops out on its own.

export interface WaitingRow {
  threadId: string;
  to: string;        // display name of who owes the reply
  toEmail: string;
  subject: string;
  waitingDays: number;
  lastMsgId: string;
}

const MIN_WAIT_DAYS = 2;
const AUTOMATED = /no-?reply|donotreply|notifications?@|mailer-daemon|@docs\.|@calendar-server\./i;

export function waitingDaysOf(sentMs: number, now: number): number {
  return Math.floor((now - sentMs) / 86400e3);
}

// The user's own address is who Gmail says we are; rows where the last sender
// is NOT me mean they replied, so I am not waiting.
export async function findWaiting(
  api: Pick<GoogleApi, "searchThreads" | "getProfile">,
  now: number,
  max = 5,
): Promise<WaitingRow[]> {
  const me = (await api.getProfile()).emailAddress.toLowerCase();
  const metas = await api.searchThreads("in:sent -in:chats", 15);
  const out: WaitingRow[] = [];
  for (const meta of metas) {
    const msgs = meta.messages || [];
    const last = msgs[msgs.length - 1];
    if (!last) continue;
    const row = mapThread(meta);
    if (!row) continue;
    if (row.fromEmail.toLowerCase() !== me) continue; // they replied: not waiting
    const days = waitingDaysOf(row.dateMs, now);
    if (days < MIN_WAIT_DAYS) continue;
    // Who owes the reply = whoever the last message was sent To.
    const toHeader = (last.payload?.headers || []).find((h) => h.name.toLowerCase() === "to")?.value || "";
    const toEmail = (toHeader.match(/<([^>]+)>/)?.[1] || toHeader).trim();
    if (!toEmail || AUTOMATED.test(toEmail)) continue; // machines never owe replies
    if (toEmail.toLowerCase() === me) continue;        // notes to self are not waiting
    const toName = (toHeader.match(/^(.*?)\s*</)?.[1] || toEmail.split("@")[0] || toEmail).trim();
    out.push({
      threadId: row.id,
      to: toName,
      toEmail,
      subject: row.subject,
      waitingDays: days,
      lastMsgId: row.lastMsgId,
    });
  }
  return out.sort((a, b) => b.waitingDays - a.waitingDays).slice(0, max);
}

// "4 days, no reply" or with a real open signal: "Opened Aug 2 · no reply".
// The absence of an open says NOTHING (image blockers read invisibly), so the
// line never claims "not opened".
export function waitingLine(row: WaitingRow, openedISO: string | null): string {
  const wait = row.waitingDays === 1 ? "1 day · no reply" : row.waitingDays + " days · no reply";
  if (!openedISO) return wait;
  const d = new Date(openedISO);
  const when = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return "Opened " + when + " · no reply";
}

// The nudge goes out over the USER'S name, so it inherits JARVIS_VOICE and,
// when the app knows the recipient, the writing voice plus STYLE_SCOPE_RULE
// (Brain Personalization Phase 3). Before this it had neither: every nudge
// read the same whether it was going to a brother-in-law or a sponsor, and
// the model was never told the em dash rule. `voice` is optional so the
// prompt still builds in tests and when context gathering fails.
export function nudgePrompt(row: WaitingRow, voice = ""): { system: string; user: string } {
  return {
    system: [
      JARVIS_VOICE,
      "You draft a SHORT follow-up nudge for an email the user sent that got no reply.",
      "One to three sentences. Warm, zero guilt, zero passive aggression: assume they are busy, make replying easy.",
      "Never mention tracking, opens, or that the user knows anything about whether it was read.",
      "Reply with ONLY the message body, no subject, no signature.",
      voice.trim() ? "\nWrite it as this person would write it:\n" + voice.trim() : "",
    ].filter(Boolean).join("\n"),
    user: "The email was to " + row.to + ", subject: \"" + row.subject + "\", sent " + row.waitingDays + " days ago. Draft the nudge.",
  };
}
