// THE DRAFT CHAT WROTE, WAITING FOR A TAP (UP-MIND-22, A23 "can draft but
// never send").
//
// Chat writes the words; the Email tab opens them in the composer; the user
// hits Send. The words have to survive the tab switch, and a prop cannot
// carry them: the shell's one-shot intents deliberately carry an ID and
// nothing else, because an intent is a pointer to something, not a payload.
//
// So this is the smallest possible store: ONE pending compose, on this
// device, read once and gone. Not an outbox, not a second draft store, and
// nothing sends from here. If it is never read (the user goes somewhere
// else), it expires on its own rather than opening a stale composer days
// later over their name.
const KEY = "jarvis.chat.compose.v1";
const MAX_AGE_MS = 10 * 60e3;

export interface ComposeDraft {
  to: string;
  subject: string;
  body: string;
  ts: number;
}

export function putComposeDraft(d: Omit<ComposeDraft, "ts">, now = Date.now()): void {
  try { localStorage.setItem(KEY, JSON.stringify({ ...d, ts: now })); } catch { /* private mode: the bubble still shows the words */ }
}

/** Reads and CLEARS. A draft opens once; a second visit to the tab must not
 *  reopen the composer over a message already sent. */
export function takeComposeDraft(now = Date.now()): ComposeDraft | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<ComposeDraft>;
    if (typeof d.body !== "string" || !d.body.trim()) return null;
    if (typeof d.ts !== "number" || now - d.ts > MAX_AGE_MS) return null;
    return { to: typeof d.to === "string" ? d.to : "", subject: typeof d.subject === "string" ? d.subject : "", body: d.body, ts: d.ts };
  } catch {
    return null;
  }
}
