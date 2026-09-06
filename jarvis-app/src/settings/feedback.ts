// UP-LAUNCH-16 (2026-09-05): Send Feedback, the client half.
//
// The rules a message has to obey live here rather than in the sheet, for the
// usual reason: the endpoint enforces them anyway, and a UI that lets someone
// type 5,000 characters and then fails on send has wasted their message. The
// sheet reads the same constants the server checks against.

/** The endpoint's cap, in bytes of UTF-8 (api/feedback.ts rejects more). */
export const MAX_FEEDBACK_BYTES = 2048;

export interface FeedbackDraft {
  text: string;
  /** The newest crash, when the person ticked the switch. */
  lastError?: string | null;
  build: string;
  device: string;
  template: string;
}

/** UTF-8 length, because the cap is bytes and an emoji is four of them. */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function tooLong(text: string): boolean {
  return byteLength(text) > MAX_FEEDBACK_BYTES;
}

export type SendResult = "sent" | "empty" | "too-long" | "rate-limited" | "failed" | "signed-out";

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number }>;

/**
 * One POST, one answer. Never throws: the caller renders the result, and
 * "Sent" is only ever said for a 2xx, never for a request that left.
 */
export async function sendFeedback(
  draft: FeedbackDraft,
  token: string | undefined,
  url: string,
  doFetch: FetchLike = fetch as unknown as FetchLike,
): Promise<SendResult> {
  const text = draft.text.trim();
  if (!text) return "empty";
  if (tooLong(text)) return "too-long";
  if (!token) return "signed-out";
  try {
    const r = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({
        text,
        build: draft.build,
        device: draft.device,
        template: draft.template,
        // Absent, not null: the endpoint stores what it is given, and "the
        // switch was off" and "there was nothing to attach" are the same
        // thing from its side.
        ...(draft.lastError ? { lastError: draft.lastError } : {}),
      }),
    });
    if (r.ok) return "sent";
    return r.status === 429 ? "rate-limited" : "failed";
  } catch {
    return "failed";
  }
}

// The line after a failure. Sentence case fragments joined by a middle dot,
// the same shape every other failure line in the app wears (guard.ts's
// WRITE_FAILED_MESSAGE is the pattern), because a paragraph under a text box
// is not read.
export const FEEDBACK_MESSAGE: Record<Exclude<SendResult, "sent">, string> = {
  empty: "Write something first",
  "too-long": "Too long to send \u00b7 Trim it and try again",
  "rate-limited": "That's a few messages already \u00b7 Try again in an hour",
  failed: "Couldn't send \u00b7 Check your connection",
  "signed-out": "Sign in first, then send this",
};
