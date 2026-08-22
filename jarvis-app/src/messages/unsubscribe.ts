// One-tap unsubscribe.
//
// Most marketing mail carries a List-Unsubscribe header, which is the sender's
// own machine-readable way of saying "here is how to stop". Using it beats
// filing to Noise, because filing hides the mail and unsubscribing ends it.
//
// Two forms exist and they are not equally safe:
//   - mailto: the sender wants an email. We can send it, on a tap, and it is
//     unambiguous.
//   - https: a web endpoint. RFC 8058 senders also set List-Unsubscribe-Post,
//     which promises a bare POST is enough. Without that header a URL may be a
//     page needing a click, so we OPEN it rather than pretending it worked.
//
// LAW: never claim it worked. "Asked them to stop" is the truth. Some senders
// ignore it, and a false receipt is worse than no receipt.

export interface Unsub {
  kind: "mailto" | "http";
  target: string;   // the address, or the url
  subject?: string; // mailto subject when the sender specified one
  oneClick: boolean; // List-Unsubscribe-Post: List-Unsubscribe=One-Click
}

// The header looks like: <mailto:x@y.com?subject=unsub>, <https://a/b>
export function parseUnsub(listUnsubscribe: string, listUnsubscribePost = ""): Unsub | null {
  const raw = (listUnsubscribe || "").trim();
  if (!raw) return null;
  const oneClick = /one-?click/i.test(listUnsubscribePost || "");
  const parts = [...raw.matchAll(/<([^>]+)>/g)].map((m) => m[1]!.trim());
  const candidates = parts.length ? parts : [raw];
  // mailto wins when both are offered: it is the unambiguous one.
  const mail = candidates.find((c) => /^mailto:/i.test(c));
  if (mail) {
    const url = mail.slice(7);
    const [addr, query = ""] = url.split("?");
    const sub = /(?:^|&)subject=([^&]*)/i.exec(query);
    const out: Unsub = { kind: "mailto", target: decodeURIComponent(addr || "").trim(), oneClick };
    if (sub) out.subject = decodeURIComponent(sub[1]!.replace(/\+/g, " "));
    if (!out.target || !out.target.includes("@")) return null;
    return out;
  }
  const web = candidates.find((c) => /^https?:\/\//i.test(c));
  if (web) return { kind: "http", target: web, oneClick };
  return null;
}

// The button. Names the sender so he knows who he is telling to stop.
export function unsubLabel(from: string): string {
  return "Unsubscribe from " + from;
}

// The receipt. Never claims success, because we cannot know it.
export function unsubLine(from: string): string {
  return "Asked " + from + " to stop · Takes a few days";
}

export const UNSUB_SUBJECT = "unsubscribe";
export const UNSUB_BODY = "unsubscribe";
