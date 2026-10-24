// The client's memory of a provider outage. One value, in memory only, the same shape as budgetBlock and for the same reason.
//
// An account out of credit refuses every call it is sent, and every refused call still counts against the per-user hourly cap and
// the global daily ceiling (the proxy counts BEFORE it asks the provider). Background callers (triage, briefs, pre-generation) retry
// on failure, so a dead account would be knocked on until the caps were spent on nothing. After the first refusal that only a
// person can fix (credit, usage limit, key, model access) they stop asking.
//
// It differs from budgetBlock in one way, because fixing it happens outside the app: nothing here is told when credit is added.
// So the hold ends on its own after a quarter of an hour (the next call goes out as the probe, and a failure holds again), and
// the moment any call goes through, which proves the account works, it ends at once. A call the person asked for is never held
// back by this: it is the probe.

import { outageCode, type AIProviderError } from "./providerFailure";

const HOLD_MS = 15 * 60_000;

let held: { err: AIProviderError; at: number } | null = null;

export function providerBlocked(now: number = Date.now()): AIProviderError | null {
  if (!held) return null;
  if (now - held.at >= HOLD_MS) {
    held = null;
    return null;
  }
  return held.err;
}

export function noteProviderFailure(e: AIProviderError, now: number = Date.now()): void {
  // Busy, rate and a request-shaped refusal say nothing about the next call, so they hold nothing.
  if (outageCode(e.code)) held = { err: e, at: now };
}

export function clearProviderBlock(): void {
  held = null;
}
