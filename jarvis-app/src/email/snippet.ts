// THE FIRST WORDS OF A MESSAGE, READ AS WORDS (Dave 2026-10-13, the GEICO
// line in the inbox, issue 103: "the preview must render the message preview
// only").
//
// Gmail hands back a snippet that is already HTML-escaped, and a marketing or
// insurer sender fills the start of it with plumbing: a "View in browser"
// line, a tracking link, and a preheader padded out with invisible characters
// (&zwnj;, &#8203;, &#847;, runs of &nbsp;) so the mail app has nothing else
// to show. The inbox drew all of it. The server's own decoder knows six
// entities and no invisible character, so the padding arrived as long visible
// gaps and pushed the real words out of the one-line row.
//
// This is DISPLAY ONLY. What is stored, what search matches and what the rules
// read stay exactly as the server wrote them; the same snippet is simply
// shown as the reader would have seen it. It is pure, has no browser or React
// dependency, and returns "" when nothing readable is left, so the row draws
// no line at all (a row with nothing to say shows nothing).
//
// Every invisible and typographic character below is written as an escape.
// A literal one is invisible in review and is its own law in this repo.

import { decodeEntities, ENTITY_NAMES } from "../connections/google/decode";

// --- quoted-printable leftovers -------------------------------------------

// A soft line break ("=" at the end of a line) is never text.
const QP_SOFT_BREAK = /=\r?\n/g;
// =E2=80=99 and friends. Decoded only when it is unambiguous: the bytes form
// valid UTF-8 that includes a multi-byte character, or the run is nothing but
// "=3D" (an equals sign). "Total=20" or "x=AB" are left as they are, because
// they could be what the sender typed.
const QP_RUN = /(?:=[0-9A-F]{2})+/g;

function utf8(bytes: number[]): string | null {
  if (typeof TextDecoder === "undefined") return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes)); } catch { return null; }
}

function unQuotePrintable(s: string): string {
  if (!s.includes("=")) return s;
  return s.replace(QP_SOFT_BREAK, "").replace(QP_RUN, (run) => {
    const bytes: number[] = [];
    for (let i = 0; i < run.length; i += 3) bytes.push(parseInt(run.slice(i + 1, i + 3), 16));
    if (bytes.every((b) => b === 0x3d)) return "=".repeat(bytes.length);
    if (!bytes.some((b) => b >= 0x80)) return run;
    return utf8(bytes) ?? run;
  });
}

// --- a cut-off entity at the very end -------------------------------------

// Gmail cuts a snippet at about 200 characters, and it can cut inside an
// entity: "...Tom &am", "...&#82", "...&#". The tail is removed before
// decoding, so it can never be shown as text. A named tail is removed only
// when it is the start of an entity this app knows, so "AT&T", "Q&A" and
// "R&D" (no lowercase letters after the ampersand) are never touched.
const TAIL_NUMERIC = /&#(?:[xX][0-9a-fA-F]*|[0-9]*)$/;
const TAIL_NAMED = /&([a-z][a-z0-9]+)$/;

function dropCutEntity(s: string): string {
  if (!s.includes("&")) return s;
  const t = s.trimEnd();
  if (TAIL_NUMERIC.test(t)) return t.replace(TAIL_NUMERIC, "");
  const named = TAIL_NAMED.exec(t);
  if (named && ENTITY_NAMES.some((n) => n.startsWith(named[1]!))) return t.slice(0, named.index);
  if (t.endsWith("&")) return t.slice(0, -1);
  return s;
}

// --- mojibake ---------------------------------------------------------------

// UTF-8 read as Windows-1252 ("Don\u00e2\u20ac\u2122t" for "Don\u2019t"). Each
// sequence is turned back into bytes and decoded as strict UTF-8; if it is
// not valid UTF-8 it was real text and stays.
const CP1252_BYTE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
// A continuation byte (0x80 to 0xBF) as Windows-1252 shows it. Built from the
// table above, so no character is typed twice.
const CONT = "[\\u0080-\\u00bf" + Object.keys(CP1252_BYTE).map((k) => "\\u" + Number(k).toString(16).padStart(4, "0")).join("") + "]";
const MOJIBAKE = new RegExp(`[\\u00c2-\\u00df]${CONT}|[\\u00e0-\\u00ef]${CONT}{2}|[\\u00f0-\\u00f4]${CONT}{3}`, "g");

function byteOf(ch: string): number | null {
  const cp = ch.codePointAt(0)!;
  if (cp <= 0xff) return cp;
  return CP1252_BYTE[cp] ?? null;
}

function unMojibake(s: string): string {
  if (!/[\u00c2-\u00f4]/.test(s)) return s;
  return s.replace(MOJIBAKE, (seq) => {
    const bytes: number[] = [];
    for (const ch of seq) {
      const b = byteOf(ch);
      if (b === null) return seq;
      bytes.push(b);
    }
    return utf8(bytes) ?? seq;
  });
}

// --- invisible padding ------------------------------------------------------

// Characters that draw nothing and exist to pad a preheader or to steer text:
// soft hyphen, combining grapheme joiner, Arabic letter mark, Hangul and Khmer
// fillers, Mongolian vowel separator, zero-width space / non-joiner / marks
// (U+200B to U+200F except the joiner, handled below), bidi controls, the
// invisible math and format run, braille blank, Hangul filler, BOM, text
// variation selectors and the C0/C1 controls. U+FE0F stays (it makes an
// emoji an emoji).
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u206f\u2800\u3164\ufeff\uffa0\ufe00-\ufe0e]/g;
// The joiner glues emoji into one picture (family, flag, profession); it is
// kept only between two pictographs and dropped everywhere else.
function dropStrayJoiners(s: string): string {
  if (!s.includes("\u200d")) return s;
  return s.replace(/\u200d/g, (_m, at: number) =>
    /[\p{Extended_Pictographic}\ufe0f]$/u.test(s.slice(0, at)) && /^\p{Extended_Pictographic}/u.test(s.slice(at + 1)) ? "\u200d" : "");
}

// --- links and plumbing -----------------------------------------------------

// Every scheme, not only http (the same rule messages/bodyText.ts keeps for a
// message body). "Call (267) 332-4101 ( tel:2673324101 )" must not survive.
const URL_RE = /\b(?:https?|mailto|tel|sms|ftp|callto):[^\s<>)\]]+/gi;
// A link with no scheme: "www.x.com/..." and "click.geico.com/ls/click?upn=...".
// The path is required for the second form, so "geico.com" in a sentence stays.
const BARE_LINK_RE = /\bwww\.[^\s<>)\]]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>)\]]*/gi;
// What a removed link leaves behind: "( )", "< >", "[ ]".
const EMPTY_BRACKETS = /[([<{]\s*[)\]>}]/g;
// "[image: GEICO logo]" and "[cid:abc123]" stand for pictures, not words.
const PLACEHOLDER = /\[\s*(?:image|cid)\s*:[^\]]*\]/gi;
// A tracking blob: a long unbroken token holding a digit or a URL character.
const isBlob = (t: string, min: number): boolean => t.length >= min && /[0-9/?=&%~_]/.test(t);
// The line every bulk sender starts with.
const VIEW_IN_BROWSER = /^(?:(?:click|tap) here to )?(?:view|open|read)(?: this| the| your)?(?: email| message| newsletter| mail)?(?: in (?:your |a |the )?(?:web )?browser| online| on the web)\b/i;
const LEADING_SEPARATORS = /^[\s|:;,.\p{Pd}\u2022\u00b7>]+/u;

function stripLeadingPlumbing(s: string): string {
  let out = s;
  for (let i = 0; i < 8; i++) {
    const before = out;
    out = out.replace(LEADING_SEPARATORS, "").replace(VIEW_IN_BROWSER, "");
    const first = /^\S+/.exec(out)?.[0];
    if (first && isBlob(first, 28)) out = out.slice(first.length);
    if (out === before) break;
  }
  return out;
}

const SOMETHING_READABLE = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;

/**
 * A Gmail snippet as the reader should see it: entities decoded, invisible
 * padding and quoted-printable or mojibake leftovers gone, one space between
 * words, links and "View in browser" plumbing dropped, and no cut-off entity at
 * the end. "" when nothing readable is left.
 */
export function cleanSnippet(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw === "") return "";
  let s = dropCutEntity(unQuotePrintable(raw));
  s = decodeEntities(s);
  s = unMojibake(s);
  s = dropStrayJoiners(s.replace(INVISIBLE, ""));
  s = s.replace(/\s+/g, " ");
  s = s.replace(URL_RE, " ").replace(BARE_LINK_RE, " ").replace(PLACEHOLDER, " ").replace(EMPTY_BRACKETS, " ");
  s = s.split(/\s+/).filter((t) => t !== "" && !isBlob(t, 40)).join(" ");
  s = stripLeadingPlumbing(s).trim();
  return SOMETHING_READABLE.test(s) ? s : "";
}
