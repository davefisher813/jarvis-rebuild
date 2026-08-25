import { describe, it, expect } from "vitest";
import { decodeWords, decodeEntities, encodeWord, needsEncoding } from "./decode";

describe("RFC 2047: the header a human is supposed to read", () => {
  it("decodes a base64 word", () => {
    expect(decodeWords("=?UTF-8?B?TsOkY2hzdGUgU2Nocml0dGU=?=")).toBe("Nächste Schritte");
  });

  it("decodes a quoted-printable word, where underscore means space", () => {
    expect(decodeWords("=?utf-8?Q?No=C3=ABl_Berger?=")).toBe("Noël Berger");
  });

  it("joins adjacent words WITHOUT the whitespace between them", () => {
    // RFC 2047 §6.2. This is how a long subject is split, and keeping the
    // space puts one in the middle of a word.
    expect(decodeWords("=?UTF-8?Q?Appoint?= =?UTF-8?Q?ment?=")).toBe("Appointment");
  });

  it("keeps the real spaces around ordinary text", () => {
    // The bug that made me write this test: a first cut marked the gaps with
    // a space and then stripped every space in the string.
    expect(decodeWords("Re: =?UTF-8?B?TsOkY2hzdGU=?= next steps")).toBe("Re: Nächste next steps");
    expect(decodeWords("Next steps for you")).toBe("Next steps for you");
  });

  it("leaves a word it cannot decode exactly as it was", () => {
    // Gibberish is bad. A blank subject is worse: it reads as though the
    // sender wrote nothing.
    const broken = "=?UTF-8?B?!!!not-base64!!!?=";
    expect(decodeWords(broken)).toBe(broken);
  });

  it("falls back to latin-1 for a charset nobody has heard of", () => {
    const out = decodeWords("=?x-made-up-9000?Q?Caf=E9?=");
    expect(out).toBe("Café");
  });

  it("handles a latin-1 word, which plenty of older senders still send", () => {
    expect(decodeWords("=?ISO-8859-1?Q?Caf=E9_Rouge?=")).toBe("Café Rouge");
  });

  it("ignores the language tag some senders attach to the charset", () => {
    expect(decodeWords("=?utf-8*en?Q?Hello?=")).toBe("Hello");
  });

  it("does nothing at all to a plain header, and cheaply", () => {
    expect(decodeWords("Marcus - waiver for Saturday")).toBe("Marcus - waiver for Saturday");
    expect(decodeWords("")).toBe("");
  });

  it("decodes a word embedded in a display name with an address after it", () => {
    expect(decodeWords("=?UTF-8?B?Tm/Dq2wgQmVyZ2Vy?= <noel@bruxelles.be>"))
      .toBe("Noël Berger <noel@bruxelles.be>");
  });
});

describe("encoding on the way back out", () => {
  it("leaves an ASCII subject alone, because most subjects are ASCII", () => {
    expect(encodeWord("Re: Marcus - waiver")).toBe("Re: Marcus - waiver");
    expect(needsEncoding("Re: Marcus - waiver")).toBe(false);
  });

  it("encodes a subject that cannot legally sit raw in a header", () => {
    const out = encodeWord("Re: Nächste Schritte");
    expect(out.startsWith("=?UTF-8?B?")).toBe(true);
    // And it round-trips, which is the only test that matters.
    expect(decodeWords(out)).toBe("Re: Nächste Schritte");
  });
});

describe("HTML entities", () => {
  it("decodes the ones marketing mail is made of", () => {
    expect(decodeEntities("Don&#39;t miss Sarah &amp; Co&mdash;RSVP"))
      .toBe("Don't miss Sarah & Co—RSVP");
  });

  it("decodes hex and decimal numeric references", () => {
    expect(decodeEntities("caf&#233; &#x2014; open")).toBe("café — open");
  });

  it("does not double-decode: &amp;lt; is a literal &lt;", () => {
    // Resolving &amp; first would turn this into "<", which is a different
    // string from the one the sender wrote.
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
  });

  it("leaves an unknown entity visible rather than eating it", () => {
    expect(decodeEntities("a &notarealentity; b")).toBe("a &notarealentity; b");
  });

  it("refuses a code point that is not a character", () => {
    expect(decodeEntities("&#xD800;")).toBe("&#xD800;");
    expect(decodeEntities("&#0;")).toBe("&#0;");
    expect(decodeEntities("&#99999999;")).toBe("&#99999999;");
  });

  it("costs nothing on text with no entities in it", () => {
    expect(decodeEntities("plain words")).toBe("plain words");
  });
});
