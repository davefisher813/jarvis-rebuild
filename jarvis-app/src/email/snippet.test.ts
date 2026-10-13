// THE GEICO INBOX LINE (Dave 2026-10-13, issue 103): a snippet is shown as the
// words the sender wrote, not as the plumbing around them. Every invisible and
// typographic character below is an escape, never a literal byte.
import { describe, it, expect } from "vitest";
import { cleanSnippet } from "./snippet";

// What an insurer's preheader looks like on the way out of Gmail: a tracking
// line, then the real words, then padding made of combining joiners, zero-width
// non-joiners, zero-width spaces (numeric and as characters) and nbsp runs.
const PAD = "&#847;&zwnj;&nbsp;&#8203;&nbsp;\u034f\u200c \u034f\u200c &#847; &zwnj;&nbsp;\u2060\ufeff\u00ad ";
const GEICO =
  "View in browser ( https://click.geico.com/ls/click?upn=u001.3Dx8f2Qv9aWm1ZpL0nQ7rT4yK6hB2sD5gJ8cV1eN3bM ) " +
  "Your GEICO auto policy renews on Nov 4. Here&#39;s what you owe &amp; how to pay " + PAD + PAD + PAD;

const TABLE: Array<[string, string, string]> = [
  ["GEICO marketing preview: padding, nbsp runs and a leading View in browser line", GEICO,
    "Your GEICO auto policy renews on Nov 4. Here's what you owe & how to pay"],
  ["plain text passes through untouched", "Can we meet at 10?", "Can we meet at 10?"],
  ["apostrophe and ampersand", "Don&#39;t miss Tom &amp; Jerry", "Don't miss Tom & Jerry"],
  ["named typographic entities", "Your policy&rsquo;s renewal&hellip; &mdash; see you", "Your policy\u2019s renewal\u2026 \u2014 see you"],
  ["zero-width entities, named and numeric, decode to nothing visible", "Pay&zwnj;&#8203;&#x200B;&#847;now", "Paynow"],
  ["invisible characters between words leave one space", "bill\u034f \u200c \u034f \u200c due\u200b\u00ad", "bill due"],
  ["nbsp, tab, CR and LF runs collapse to one space", "Hello\u00a0\u00a0\u00a0\t\r\n\r\n  there&nbsp;&nbsp;now", "Hello there now"],
  ["quoted-printable multi-byte and equals sign", "Don=E2=80=99t pay a=3D5", "Don\u2019t pay a=5"],
  ["a quoted-printable soft line break", "Your poli=\r\ncy renews", "Your policy renews"],
  ["an ambiguous equals-hex is left as typed", "Total=20 and x=AB and =ZZ", "Total=20 and x=AB and =ZZ"],
  ["mojibake from UTF-8 read as Windows-1252", "Don\u00e2\u20ac\u2122t miss caf\u00c3\u00a9 \u00e2\u20ac\u201c today", "Don\u2019t miss caf\u00e9 \u2013 today"],
  ["real accented text is not repaired", "Caf\u00e9 menu, se\u00f1or, \u00dcber, na\u00efve", "Caf\u00e9 menu, se\u00f1or, \u00dcber, na\u00efve"],
  ["a bare tracking URL is dropped", "https://click.geico.com/ls/click?upn=abc123 Your bill is ready", "Your bill is ready"],
  ["a labelled link keeps its label", "Call (267) 332-4101 ( tel:2673324101 ) today", "Call (267) 332-4101 today"],
  ["a scheme-less tracking link is dropped, a domain in a sentence is not", "click.geico.com/ls/click?upn=abc See geico.com for details", "See geico.com for details"],
  ["a long junk token at the start is dropped", "aGVsbG8gd29ybGQ0aGVsbG8gd29ybGQ1aGVsbG8 Your statement is ready", "Your statement is ready"],
  ["a long plain word is not junk", "Pneumonoultramicroscopicsilicovolcanoconiosis is long", "Pneumonoultramicroscopicsilicovolcanoconiosis is long"],
  ["view in browser variants lead and go", "View this email in your browser | Your statement is ready", "Your statement is ready"],
  ["an image placeholder goes", "[image: GEICO] Your card is attached [cid:ab12]", "Your card is attached"],
  ["a cut numeric entity at the end", "Your total is $82. Tom &#82", "Your total is $82. Tom"],
  ["a cut hex entity at the end", "Hours: 9 to 5 &#x2", "Hours: 9 to 5"],
  ["a cut named entity at the end", "Tom &am", "Tom"],
  ["a lone ampersand at the end", "Terms &", "Terms"],
  ["names that look like entities are never cut", "AT&T, Q&A and R&D", "AT&T, Q&A and R&D"],
  ["an escaped ampersand is not a cut entity", "Tom &amp; Jerry", "Tom & Jerry"],
  ["decoding is one pass: &amp;lt; is a literal &lt;", "a &amp;lt; b", "a &lt; b"],
  ["a family emoji keeps its joiners", "Hi \ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67 there", "Hi \ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67 there"],
  ["a stray joiner between letters goes", "ab\u200dcd", "abcd"],
  ["a flag keeps its pair", "Go \ud83c\uddfa\ud83c\uddf8 now", "Go \ud83c\uddfa\ud83c\uddf8 now"],
  ["leading separators go", " | : Welcome back", "Welcome back"],
];

describe("cleanSnippet", () => {
  it.each(TABLE)("%s", (_name, raw, want) => {
    expect(cleanSnippet(raw)).toBe(want);
  });

  it("returns nothing when only plumbing is left, so the row draws no line", () => {
    expect(cleanSnippet(PAD + PAD)).toBe("");
    expect(cleanSnippet("View in browser")).toBe("");
    expect(cleanSnippet("View in browser ( https://click.geico.com/ls/click?upn=abc )")).toBe("");
    expect(cleanSnippet("https://click.geico.com/ls/click?upn=abc")).toBe("");
    expect(cleanSnippet("   \u00a0\u200b  ")).toBe("");
    expect(cleanSnippet("")).toBe("");
    expect(cleanSnippet(null)).toBe("");
    expect(cleanSnippet(undefined)).toBe("");
  });

  it("is idempotent over every fixture that is not double-encoded", () => {
    for (const [name, raw] of TABLE) {
      if (name.startsWith("decoding is one pass")) continue;
      const once = cleanSnippet(raw);
      expect(cleanSnippet(once), name).toBe(once);
    }
  });

  it("never leaves an invisible character or a half entity in what it returns", () => {
    for (const [, raw] of TABLE) {
      const out = cleanSnippet(raw);
      expect(out).not.toMatch(/[\u034f\u200b\u200c\u00ad\ufeff\u2060\u00a0]/);
      expect(out).not.toMatch(/&#[0-9xX]*$/);
      expect(out).not.toMatch(/\s{2}/);
    }
  });
});
