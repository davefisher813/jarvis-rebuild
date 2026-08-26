// THE ERROR A PERSON CAN ACT ON (Dave 2026-08-25, from the email audit).
//
// api.ts throws machine strings by design: `throw new Error("gmail " + status)`
// is a fine thing for a client to do, because the status is what a caller
// needs. What was not fine is that fifteen call sites did this:
//
//     setError((e as Error).message || "Could not load mail");
//
// and rendered it. The `||` fallback never runs, because `.message` is never
// empty, so the screen said "gmail 401". The AI transport was worse: its
// message carries the raw response body, so "Couldn't Sort Your Mail" was
// followed by a JSON rate-limit blob cut off mid-word at 140 characters.
//
// One rule: a status a person can do something about gets a sentence saying
// what. Everything else gets the plain fallback the call site already wrote.
// Nothing here invents a diagnosis.

const SIGNED_OUT = "Your Google sign-in expired · Reconnect in Settings";
// 403 usually means the token's scopes cannot do what the button offered
// (the 2026-08-26 scope bug was exactly this, app-wide). Reconnecting runs
// consent again and re-grants under the current scope list, so that is the
// action this sentence sells.
const NO_ACCESS = "Google refused that · Reconnect in Settings to update permissions";
const TOO_FAST = "Google is rate-limiting us · Try again in a minute";
const GOOGLE_DOWN = "Google's mail service is having trouble · Try again shortly";
const OFFLINE = "You're offline · Nothing was lost";

export function humanError(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (!raw) return fallback;

  // A fetch that never reached a server. The browser's own wording for this
  // is "Failed to fetch" / "NetworkError", which tells a person nothing.
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) return OFFLINE;

  const status = statusIn(raw);
  if (status === 401) return SIGNED_OUT;
  if (status === 403) return NO_ACCESS;
  if (status === 429) return TOO_FAST;
  if (status != null && status >= 500) return GOOGLE_DOWN;

  // Anything else, including every message that carries a response body: the
  // call site's own sentence. Showing the machine's words to a person is the
  // bug this file exists to end, so an unrecognised message never survives.
  return fallback;
}

// "gmail 401", "thread 500", "AI request failed (429). {...}". The status is
// the first three-digit number that is a plausible HTTP status; a bare number
// elsewhere in a response body cannot masquerade as one.
function statusIn(raw: string): number | null {
  for (const m of raw.matchAll(/\b([1-5]\d\d)\b/g)) {
    const n = Number(m[1]);
    if (n >= 100 && n <= 599) return n;
  }
  return null;
}
