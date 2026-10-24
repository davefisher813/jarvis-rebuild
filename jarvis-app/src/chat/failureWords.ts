// WHAT THE THREAD SAYS WHEN A TURN FAILS (Dave 2026-10-24, the chat box order: "when something is broken the thread says what is
// actually wrong").
//
// The AI lane had one sentence for every way it could fail, "Couldn't reach the AI · Try again": an account out of credit, a
// spending limit, AI turned off in Settings, an expired sign-in and a dropped connection all read the same, and only the last is fixed
// by trying again. This maps what was actually thrown (typed by AIService, see ai/providerFailure and ai/aiGate) to the sentence that
// is true, and to whether asking again can help, which is what decides if the thread offers Try Again.
//
// Sentence case: the app talking in a conversation (laws/sentenceCase.ts).

import { isBudgetError } from "../ai/aiBudget";
import { isUnavailableError } from "../ai/aiGate";
import { isProviderError } from "../ai/providerFailure";

export interface ChatFailure {
  text: string;
  /** Would the same ask, a moment later, plausibly work? Only then does the thread offer Try Again. */
  retryable: boolean;
}

const NETWORK = /failed to fetch|networkerror|load failed|network request failed|network connection was lost/i;

// The thread speaks in short fragments joined by a middle dot (the short-copy law, Dave 2026-08-15), so a sentence that reaches it
// from a server or a constant is set in that shape: "Rate limit reached. Try again shortly." reads "Rate limit reached · Try again
// shortly". The one thing never run through this is the spending limit's sentence, which is his, in his words.
function asFragments(s: string): string {
  return s.trim().replace(/\.\s+(?=[A-Z])/g, " · ").replace(/\.$/, "");
}

// The proxy's own envelope is { error: "<sentence>" }; read it when a failure arrived untyped (an older deploy, a hand-built error).
function envelopeSentence(body: string): string | null {
  try {
    const j = JSON.parse(body) as { error?: unknown };
    return typeof j.error === "string" && j.error.trim() ? asFragments(j.error) : null;
  } catch {
    return null;
  }
}

export function chatFailure(e: unknown): ChatFailure {
  // The provider, named by its body: credit, usage limit, key, model access, rate, busy, too large, turned down.
  if (isProviderError(e)) return { text: e.message, retryable: e.retryable };
  // The spending limit Dave set: its own plain words, and no amount of asking again moves it.
  if (isBudgetError(e)) return { text: e.message, retryable: false };
  // AI is not available at all (Off, the admin switch, a build with no backend). Records and commands do not need it.
  if (isUnavailableError(e)) {
    const base = asFragments(e.message);
    return { text: e.code === "AI_OFF" ? base + " · I can still answer from your records and run commands" : base, retryable: false };
  }

  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (NETWORK.test(raw)) return { text: "Couldn't reach JARVIS · Check your connection, then try again", retryable: true };

  // An untyped proxy failure: "AI request failed (503). {...}".
  const m = /^AI request failed \((\d{3})\)\.?\s*([\s\S]*)$/.exec(raw);
  if (m) {
    const status = Number(m[1]);
    const said = envelopeSentence(m[2] ?? "");
    if (status === 401) return { text: "Your session expired · Sign in again", retryable: false };
    if (status === 413) return { text: "That was too much to send at once · Try a shorter message", retryable: false };
    if (status === 429) return { text: said ?? "Rate limit reached · Try again shortly", retryable: true };
    if (status === 502 || status === 503 || status === 504) return { text: said ?? "The AI isn't answering right now · Try again in a moment", retryable: true };
    if (said) return { text: said, retryable: false };
  }

  // Nothing says what happened. Assume the kind that a second try can fix, and say only what is known: the line this used to be for everything.
  return { text: "Couldn't reach the AI · Try again", retryable: true };
}
