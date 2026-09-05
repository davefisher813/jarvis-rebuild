import type { GoogleApi } from "../connections/google/api";
import { mapThreadFull, type ThreadFull } from "../connections/google/map";

// EMAIL-F-03 (2026-09-05): "What Did I Say About This? and the Promise Sweep
// read empty bodies." Both features searched sent mail with searchThreads
// and handed the hits straight to mapThreadFull, as if they were full
// threads. They are not: api.ts fetches search hits with format=metadata
// (headers only, no parts), so extractBody found nothing and every body was
// "". parseSaid's verbatim guard then rejected every quote ("Nothing you
// wrote covers that", whatever he wrote), and the sweep asked the model to
// find promises in subject lines. The bench fixture had the same metadata
// shape, so the bench never showed it.
//
// This is the missing step, the one voiceExamplesFor already takes: a real
// getThread per hit before mapping. Bounded twice, because these run on a
// tap and on every inbox load: at most `cap` threads (the 8 both callers
// already asked for), and each fetch under the same 20s ceiling the triage
// batches use, with a thread that fails or times out dropped rather than
// taking the rest with it.
export const SENT_BODY_CAP = 8;
export const SENT_BODY_TIMEOUT_MS = 20000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Reading took too long.")), ms)),
  ]);
}

export async function fullThreadsFor(
  api: Pick<GoogleApi, "getThread">,
  metas: { id: string }[],
  cap = SENT_BODY_CAP,
  timeoutMs = SENT_BODY_TIMEOUT_MS,
): Promise<ThreadFull[]> {
  const fetched = await Promise.all(metas.slice(0, cap).map((m) =>
    withTimeout(api.getThread(m.id), timeoutMs).then(mapThreadFull).catch(() => null)));
  return fetched.filter((t): t is ThreadFull => t !== null);
}
