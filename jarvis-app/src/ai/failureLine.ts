// THE SORT SAID GOOGLE WAS DOWN (Dave 2026-09-02, "Couldn't Sort Your Mail
// · Google's mail service is having trouble", for two weeks). The sort is
// not Google. It is the AI proxy, and when the proxy's upstream fails it
// answers 502 with the upstream's own error in `detail`. humanError reads
// the 502 and, knowing only Gmail, blames Google. So the one sentence a
// person could have acted on (the upstream's message: a model name, a
// schema complaint, a key) was thrown away, and the wrong service was
// named. This reads the proxy's envelope first and says what it said.

import { humanError } from "../connections/google/humanError";

const MAX = 140;

function upstreamMessage(detail: string): string | null {
  // The proxy answers { error, detail } where detail is the upstream body,
  // itself usually JSON: { type: "error", error: { type, message } }.
  try {
    const env = JSON.parse(detail) as { error?: unknown; detail?: unknown };
    const inner = typeof env.detail === "string" ? env.detail : null;
    if (inner) {
      try {
        const up = JSON.parse(inner) as { error?: { type?: unknown; message?: unknown }; message?: unknown };
        const m = up.error && typeof up.error.message === "string" ? up.error.message
          : typeof up.message === "string" ? up.message : null;
        if (m) return m;
      } catch { /* not JSON: the body itself is the message */ }
      return inner.replace(/\s+/g, " ").trim() || null;
    }
    if (typeof env.error === "string") return env.error;
  } catch { /* not the proxy's envelope */ }
  return null;
}

/** One honest line for a failed AI call, with the upstream's own words. */
export function aiFailureLine(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const m = /^AI request failed \((\d{3})\)\.?\s*([\s\S]*)$/.exec(raw);
  if (!m) return humanError(e, fallback);
  const status = Number(m[1]);
  const said = upstreamMessage(m[2] ?? "");
  const who = status === 401 ? "Sign in again" : status === 429 ? "Rate limited, try again in a minute" : `Server said ${status}`;
  const line = said ? `${who} · ${said}` : who;
  return (fallback + " · " + line).slice(0, MAX + fallback.length + 3);
}
