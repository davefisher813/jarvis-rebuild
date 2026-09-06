// THE DRAFT AS A JOB (2026-08-24).
//
// ai/pregen.ts shipped complete: a background pre-generation pass, capped at
// five per open, cached by source id and content hash, gated twice by AI
// Control, with tests. It has had ZERO callers since the day it landed, so
// the app has always paid the full model wait at the moment Dave taps Draft
// on a card, which is the one moment the wait is most expensive.
//
// This is the missing half. A card draft is described ONCE, as a
// PregenRequest, and both paths consume that description:
//
//   - the background pass at app open hands a list of them to pregenerate()
//   - the tap handler asks cachedDraft() first and only builds on a miss
//
// Written as one function rather than a prompt built in each place, for the
// reason TodayFlow's breakdown drifted away from TasksFlow's: two callers
// that must agree about a hash will not stay agreed. If the live path hashed
// the source even slightly differently from the background path, every entry
// the background pass wrote would miss, and the feature would look like it
// worked while costing double.

import { contentHash, type PregenRequest } from "../ai/pregen";
import { cardNudgePrompt, cardReplyPrompt, parseCardDraft } from "./cardDraft";
import type { MailSnapshot } from "./home";

export interface CardNotice { kind: string; threadId: string }

// The prompt-shaped facts for one notice, or null when the snapshot no longer
// holds what the notice refers to. Separated from the request so a test can
// assert the hash without a model.
interface Source {
  kind: string;
  system: string;
  user: string;
  // Everything the prompt is built FROM. The hash covers this and nothing
  // else, so a cached draft is invalidated by exactly the changes that would
  // have produced a different draft.
  //
  // Joined on NUL, because a separator a field could contain is a separator
  // that can lose. With a space, a subject ending in "9" and a 0-day wait
  // hash the same as a subject ending in "9 0" and no wait: two different
  // emails, one cache entry, one of them getting the other's draft.
  //
  // Written as an escape, never as a literal byte (2026-08-24): the string is
  // identical, and a literal one makes this whole file read as binary to
  // grep, diff and review tooling. See laws/controlBytes.test.ts.
  material: string;
}

function sourceFor(
  n: CardNotice,
  snap: MailSnapshot,
  nudgeCounts: Record<string, number>,
  extraInstruction: (subject: string, days: number, sent: number) => string,
  voice: string,
): Source | null {
  if (n.kind === "nudge" || n.kind === "chase") {
    const w = snap.waiting.find((x) => x.threadId === n.threadId);
    const c = (snap.chases ?? []).find((x) => x.threadId === n.threadId);
    const to = w?.to ?? c?.to;
    const subject = w?.subject ?? c?.subject;
    if (!to || !subject) return null;
    const days = w?.days ?? 0;
    const sent = nudgeCounts[n.threadId] ?? 0;
    const p = cardNudgePrompt(to, subject, days, voice);
    // The escalation instruction is part of the prompt, so it is part of the
    // material: a nudge that has climbed a rung is a different draft, and a
    // cache that ignored the rung would keep serving the gentle one forever.
    const instruction = extraInstruction(subject, days, sent);
    return {
      kind: "nudge",
      system: p.system + "\n" + instruction,
      user: p.user,
      // UP-MIND-01 (2026-09-05): the voice is an input to the prompt, so it is
      // an input to the hash. Editing the How You Write doc has to strand the
      // drafts written before the edit, or the card keeps serving the sentence
      // the old doc produced and the edit reads as ignored.
      material: ["nudge", to, subject, days, sent, instruction, voice].join("\u0000"),
    };
  }
  const t = snap.threads.find((x) => x.id === n.threadId);
  if (!t) return null;
  const body = t.snippet ?? t.gist ?? "";
  const p = cardReplyPrompt(t.from, t.subject, t.gist, body, voice);
  return {
    kind: "reply",
    system: p.system,
    user: p.user,
    material: ["reply", t.from, t.subject, t.gist, body, voice].join("\u0000"),
  };
}

// A complete() shaped exactly like AIService's, so the caller passes its own
// and nothing here has to know about the service.
type Complete = (messages: { role: string; content: string }[], system: string) => Promise<string>;

export function cardDraftJob(
  n: CardNotice,
  snap: MailSnapshot,
  nudgeCounts: Record<string, number>,
  extraInstruction: (subject: string, days: number, sent: number) => string,
  complete: Complete,
  // UP-MIND-01 (2026-09-05): voiceToText of the live context, or "" when it
  // could not be gathered. Defaulted so a caller that has no context provider
  // above it still gets the generic draft rather than a type error.
  voice = "",
): PregenRequest | null {
  const s = sourceFor(n, snap, nudgeCounts, extraInstruction, voice);
  if (!s) return null;
  return {
    kind: s.kind,
    sourceId: n.threadId,
    hash: contentHash(s.material),
    // The one pin the AI Control screen already names for this work, so
    // turning email drafting off turns the background pass off with it.
    pin: "emailDrafts",
    build: async () => parseCardDraft(await complete([{ role: "user", content: s.user }], s.system)),
  };
}
