// MAIL ARRIVES ENCODED. IT MUST NOT BE READ THAT WAY (Dave 2026-08-25, from
// the email audit).
//
// Two separate transports leave machine text on the screen, and this repo had
// no decoder for either one:
//
//   RFC 2047 encoded words. Any header carrying a non-ASCII character, or a
//   long subject, is sent as =?UTF-8?B?TsOkY2hzdGUgU2Nocml0dGU=?=. Every
//   surface in the app printed that verbatim: the list, the thread header, the
//   deck, the waiting rows. Worse, buildReply prepended "Re: " to the still
//   encoded subject and sent it back out, so the recipient got the gibberish
//   too, doubly wrapped.
//
//   HTML entities. An HTML-only message is stripped of its tags and shown as
//   text, and the stripper decoded &nbsp; and nothing else. "Don&#39;t miss
//   Sarah &amp; Co&mdash;RSVP" is what a perfectly ordinary marketing email
//   looks like on the way through.
//
// Both are decoded HERE, at the boundary, rather than at the twenty places
// that render a subject. A decoder that has to be remembered is a decoder that
// gets forgotten, which is how the encoded subject reached the reply path.

// --- RFC 2047 -------------------------------------------------------------

// =?charset?encoding?text?=  with encoding B (base64) or Q (quoted-printable).
// The charset may carry a language tag (=?utf-8*en?Q?...?=), which is ignored.
const WORD = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;

function bytesToString(bytes: Uint8Array, charset: string): string {
  const cs = charset.split("*")[0]!.toLowerCase();
  try {
    // TextDecoder handles utf-8, iso-8859-*, windows-125*, koi8, big5, shift_jis
    // and the rest of the encodings that turn up in real mail.
    return new TextDecoder(cs).decode(bytes);
  } catch {
    // An unknown label is not a reason to show base64. Latin-1 is the
    // historical default and never throws.
    try { return new TextDecoder("iso-8859-1").decode(bytes); } catch { return ""; }
  }
}

function b64(text: string): Uint8Array | null {
  try {
    const bin = atob(text.replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function qEncoded(text: string): Uint8Array {
  // In a Q-encoded WORD, underscore means space (RFC 2047 §4.2), which is the
  // one place Q differs from ordinary quoted-printable.
  const src = text.replace(/_/g, " ");
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === "=" && i + 2 < src.length) {
      const hex = src.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) { out.push(parseInt(hex, 16)); i += 2; continue; }
    }
    out.push(c.charCodeAt(0) & 0xff);
  }
  return new Uint8Array(out);
}

/**
 * Decode every encoded word in a header value.
 *
 * Anything it cannot decode is left EXACTLY as it was rather than blanked:
 * a subject that reads as gibberish is bad, and a subject that reads as
 * nothing is worse, because it looks like the sender wrote nothing.
 *
 * Adjacent encoded words separated only by whitespace are joined without it,
 * per RFC 2047 §6.2, which is how a long subject is split; keeping the
 * space inserts one in the middle of a word.
 */
export function decodeWords(raw: string): string {
  if (!raw || !raw.includes("=?")) return raw;
  // Mark the gaps between adjacent encoded words so they can be dropped after
  // decoding, without also dropping real spaces around ordinary text.
  // A sentinel, not a space: marking these gaps with a real space and then
  // stripping every space in the string would turn "Next steps" into
  // "Nextsteps". Written as an escape, never as a literal control byte, which
  // is its own law in this repo.
  const GAP = "\u0000";
  const marked = raw.replace(/(\?=)\s+(=\?)/g, "$1" + GAP + "$2");
  const decoded = marked.replace(WORD, (whole, charset: string, enc: string, text: string) => {
    const bytes = enc.toUpperCase() === "B" ? b64(text) : qEncoded(text);
    if (!bytes) return whole;
    const out = bytesToString(bytes, charset);
    return out || whole;
  });
  return decoded.split(GAP).join("");
}

/** Does this string need encoding on the way back out? */
export const needsEncoding = (s: string): boolean => /[^\x20-\x7E]/.test(s);

/**
 * Encode a header value for sending, when and only when it has to be.
 *
 * The reply path used to pass a subject straight into the Subject: header. For
 * an ASCII subject that is correct and this returns it untouched; for a
 * decoded non-ASCII one it would have put raw UTF-8 into a header, which is
 * not legal and which some servers mangle.
 */
export function encodeWord(s: string): string {
  if (!s || !needsEncoding(s)) return s;
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "=?UTF-8?B?" + btoa(bin) + "?=";
}

// --- HTML entities --------------------------------------------------------

// The named entities that actually appear in mail. A full table is 2,231
// entries and none of the rest have ever been seen in a marketing email.
// Written as escapes, not as the characters themselves. This app has a law
// against a literal em dash in any source file, and it caught this table on
// the first run: the law is about PROSE, and a lookup table of entity values
// is data, but a carve-out is a hole and an escape is not.
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "\u2014", ndash: "\u2013", hellip: "\u2026", rsquo: "\u2019",
  lsquo: "\u2018", rdquo: "\u201D", ldquo: "\u201C", trade: "\u2122",
  copy: "\u00A9", reg: "\u00AE", deg: "\u00B0", eacute: "\u00E9",
  middot: "\u00B7", bull: "\u2022", euro: "\u20AC", pound: "\u00A3",
  yen: "\u00A5", cent: "\u00A2", times: "\u00D7", frac12: "\u00BD",
};

/**
 * Decode HTML entities in text that has already had its tags stripped.
 *
 * `&amp;` is resolved LAST and in one pass with everything else, deliberately:
 * decoding it first turns "&amp;lt;" into "<", which is a different string
 * from the one the sender wrote.
 */
export function decodeEntities(raw: string): string {
  if (!raw || !raw.includes("&")) return raw;
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (whole, body: string) => {
    if (body[0] === "#") {
      const n = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      // Surrogates and out-of-range values are left alone rather than turned
      // into a replacement character nobody can interpret.
      if (!Number.isFinite(n) || n <= 0 || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF)) return whole;
      try { return String.fromCodePoint(n); } catch { return whole; }
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}
