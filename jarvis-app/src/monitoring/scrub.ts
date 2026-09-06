import type { ErrorReport } from "./monitor";

// UP-LAUNCH-07 (2026-09-05): what a crash report is allowed to carry off the
// phone.
//
// The report shape was already careful about the obvious leaks: no query
// string, no URL hash (the OAuth code and the Supabase token live there), a
// cap on every field. What it was not careful about is the one that matters
// once strangers are on the app: an error MESSAGE and a context VALUE are
// arbitrary strings, and plenty of them are built by interpolating the thing
// that failed. "Couldn't parse note: <the whole note>" is a real shape, and
// under the old caps that shipped 2,000 characters of somebody's writing to a
// server, and now to a third party.
//
// So the rule is a length rule, because a length rule needs no judgment about
// what a string contains: anything longer than a label is not a label. Over
// 200 characters, a string is replaced by how long it was. Nothing is
// truncated to 200, because half of a note is still a note.
//
// The stack is exempt, and deliberately: it is function names and file paths,
// it is the entire reason a crash report exists, and it is the one field that
// cannot contain what the user typed.

export const MAX_TEXT = 200;
// React component names in a render crash: code, so it earns a longer cap.
export const MAX_STACK = 2000;

export function scrubText(s: string): string {
  return s.length <= MAX_TEXT ? s : `[dropped ${s.length} chars]`;
}

function scrubValue(v: unknown): unknown {
  if (typeof v === "string") return scrubText(v);
  if (Array.isArray(v)) return v.map(scrubValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = scrubValue(val);
    return out;
  }
  return v;
}

/**
 * The last thing every report passes through before it leaves the device.
 * Applied inside the sinks rather than at the call site, so a future sink
 * cannot forget it.
 */
export function scrubReport(r: ErrorReport): ErrorReport {
  const out: ErrorReport = { ...r, message: scrubText(r.message) };
  // UP-LAUNCH-16 found this one by testing it: a JavaScript stack begins
  // "Error: <message>", so dropping a long message from the message field and
  // keeping the stack put the whole thing straight back. The stack stays
  // exempt as a whole, and the dropped message is removed from inside it.
  if (r.stack && out.message !== r.message) out.stack = r.stack.split(r.message).join(out.message);
  if (r.context) {
    const ctx = scrubValue(r.context) as Record<string, unknown>;
    // componentStack is the one long value that is unambiguously code: React
    // writes it, and it is a list of component names. Dropping it would throw
    // away the most useful line in a render crash, so it is truncated at its
    // own ceiling instead. Truncating is only safe because of what is in it.
    const cs = r.context["componentStack"];
    if (typeof cs === "string") ctx["componentStack"] = cs.length <= MAX_STACK ? cs : cs.slice(0, MAX_STACK);
    out.context = ctx;
  }
  return out;
}
