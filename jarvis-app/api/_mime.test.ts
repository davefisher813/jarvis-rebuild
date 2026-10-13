import { describe, it, expect } from "vitest";
import { buildRawMessage, decodeRaw, encodeWord, pictureKind, rfc2822Date, sha256Hex, type ExactSend } from "./_mime";
import { composeSignatureText, pictureSize, signatureBodyHtml, signatureCid, SIGNATURE_DELIM, type SignatureImage } from "../src/email/signature";

const exact = (o: Partial<ExactSend> = {}): ExactSend => ({
  account_id: "acct-dave", from_identity: "dave@example.test", to: ["coach@example.test"], cc: [], bcc: [], subject: "Re: Transcript", body_text: "On it.\nSending tonight.",
  attachments: [], reply_headers: { in_reply_to: "<m2@example.test>", references: ["<m1@example.test>", "<m2@example.test>"], thread_id: "t-a2" },
  draft_id: "54ce5ab6-a6bf-4466-bb04-ac7d1b1ad346", draft_revision: 3, client_message_id: "<54ce5ab6-a6bf-4466-bb04-ac7d1b1ad346.3@jarvis.local>", ...o,
});
const NOW = new Date("2026-10-03T16:05:09Z");
const headersOf = (raw: string) => Object.fromEntries(raw.split("\r\n\r\n")[0]!.split(/\r\n(?! )/).map((l) => { const i = l.indexOf(": "); return [l.slice(0, i), l.slice(i + 2)]; }));

describe("the message as it leaves", () => {
  it("carries From, To, Subject, Date, the deterministic Message-ID and the reply headers, with CRLF endings and a plain body", () => {
    const raw = decodeRaw(buildRawMessage(exact(), [], NOW));
    const h = headersOf(raw);
    expect(h.From).toBe("dave@example.test");
    expect(h.To).toBe("coach@example.test");
    expect(h.Subject).toBe("Re: Transcript");
    expect(h.Date).toBe("Sat, 03 Oct 2026 16:05:09 +0000");
    expect(h["Message-ID"]).toBe("<54ce5ab6-a6bf-4466-bb04-ac7d1b1ad346.3@jarvis.local>");
    expect(h["In-Reply-To"]).toBe("<m2@example.test>");
    expect(h.References).toBe("<m1@example.test>\r\n <m2@example.test>");
    expect(h["Content-Type"]).toBe("text/plain; charset=UTF-8");
    expect(raw.endsWith("\r\n\r\nOn it.\r\nSending tonight.")).toBe(true);
    expect(raw).not.toMatch(/[^\r]\n/);
  });

  it("Bcc is in the raw message (Gmail reads it there and strips it), and Cc too", () => {
    const h = headersOf(decodeRaw(buildRawMessage(exact({ cc: ["one@example.test"], bcc: ["me@example.test", "two@example.test"] }), [], NOW)));
    expect(h.Cc).toBe("one@example.test");
    expect(h.Bcc).toBe("me@example.test, two@example.test");
  });

  it("a header can never carry a second header: a line break in a subject, an address or a reply header throws", () => {
    expect(() => buildRawMessage(exact({ subject: "Hi\r\nBcc: x@y.test" }), [], NOW)).toThrow(/Subject/);
    expect(() => buildRawMessage(exact({ to: ["a@b.test\nCc: c@d.test"] }), [], NOW)).toThrow(/To/);
    expect(() => buildRawMessage(exact({ reply_headers: { in_reply_to: "<x>\r\nX: y", references: [], thread_id: null } }), [], NOW)).toThrow(/In-Reply-To/);
    expect(() => buildRawMessage(exact({ to: [] }), [], NOW)).toThrow(/recipient/);
  });

  it("a non-ASCII subject is an encoded word; the body stays UTF-8 as written", () => {
    const raw = decodeRaw(buildRawMessage(exact({ subject: "Nächste Schritte für Peña", body_text: "Peña's transcript: ✓" }), [], NOW));
    expect(headersOf(raw).Subject).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(encodeWord("plain ascii")).toBe("plain ascii");
    expect(raw.endsWith("Peña's transcript: ✓")).toBe(true);
  });

  it("an attachment rides as a base64 part under multipart/mixed, named and typed from the snapshot", () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 fake");
    const raw = decodeRaw(buildRawMessage(exact({ attachments: [{ storage_id: "u/d/f.pdf", filename: "September-expenses.pdf", size_bytes: bytes.length, sha256: "a".repeat(64), mime_type: "application/pdf" }] }), [{ filename: "September-expenses.pdf", mime: "application/pdf", bytes }], NOW));
    const h = headersOf(raw);
    expect(h["Content-Type"]).toMatch(/^multipart\/mixed; boundary="=_jarvis_54ce5ab6a6bf4466_3"$/);
    expect(raw).toContain('Content-Disposition: attachment; filename="September-expenses.pdf"');
    expect(raw).toContain("Content-Type: application/pdf; name=\"September-expenses.pdf\"");
    expect(raw).toContain(btoa("%PDF-1.4 fake"));
    expect(raw).toContain("Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\nOn it.\r\nSending tonight.");
    expect(raw.trimEnd().endsWith("--=_jarvis_54ce5ab6a6bf4466_3--")).toBe(true);
  });

  it("the bytes must match the snapshot one for one", () => {
    expect(() => buildRawMessage(exact({ attachments: [{ storage_id: "u/d/f.pdf", filename: "f.pdf", size_bytes: 3, sha256: "a".repeat(64), mime_type: "application/pdf" }] }), [], NOW)).toThrow(/differ/);
  });

  it("the date and the hash helpers are exact", async () => {
    expect(rfc2822Date(new Date("2026-01-05T09:03:00Z"))).toBe("Mon, 05 Jan 2026 09:03:00 +0000");
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});


// ---- a built signature with its picture (issue 113) -------------------------------------------------------------------------

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const SIG_FIELDS = { name: "Dave Fisher", title: "Founder", organization: "Bridge & Co", email: "dave@bridge.example" };
const SIG_IMAGE: SignatureImage = { storage_id: "u/signature-a/sig.png", sha256: "ab".repeat(32), size_bytes: PNG.byteLength, mime_type: "image/png", width: 384, height: 256 };
const crlfText = (t: string) => t.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n");
const WORDS = "Hi Sam,\n\nThe transcript is below.\nThanks.";
const signed = (o: Partial<ExactSend> = {}): ExactSend => exact({ body_text: WORDS + SIGNATURE_DELIM + composeSignatureText(SIG_FIELDS), signature: { fields: SIG_FIELDS, image: SIG_IMAGE }, ...o });

interface Node { type: string; headers: Record<string, string>; body: string; children: Node[] }
/** A small MIME reader: headers, and for a multipart the parts between its boundary lines, recursively. */
function readEntity(text: string): Node {
  const cut = text.indexOf("\r\n\r\n");
  const head = cut < 0 ? text : text.slice(0, cut);
  const body = cut < 0 ? "" : text.slice(cut + 4);
  const headers = Object.fromEntries(head.split(/\r\n(?! )/).filter(Boolean).map((l) => { const i = l.indexOf(": "); return [l.slice(0, i).toLowerCase(), l.slice(i + 2)]; }));
  const type = (headers["content-type"] ?? "text/plain").split(";")[0]!.trim().toLowerCase();
  const m = /boundary="([^"]+)"/.exec(headers["content-type"] ?? "");
  if (!type.startsWith("multipart/") || !m) return { type, headers, body, children: [] };
  const b = m[1]!;
  const lines = body.split("\r\n");
  const children: Node[] = [];
  let cur: string[] | null = null;
  let closed = false;
  for (const line of lines) {
    if (line === `--${b}--`) { if (cur) children.push(readEntity(cur.join("\r\n"))); cur = null; closed = true; break; }
    if (line === `--${b}`) { if (cur) children.push(readEntity(cur.join("\r\n"))); cur = []; continue; }
    if (cur) cur.push(line);
  }
  if (!closed) throw new Error("multipart " + b + " was never closed");
  return { type, headers, body, children };
}
const shape = (n: Node): unknown => (n.children.length ? [n.type, n.children.map(shape)] : n.type);
const b64text = (n: Node): string => new TextDecoder().decode(Uint8Array.from(Buffer.from(n.body.replace(/\r\n/g, ""), "base64")));
const b64bytes = (n: Node): Uint8Array => Uint8Array.from(Buffer.from(n.body.replace(/\r\n/g, ""), "base64"));
/** The whole message read as one entity (the headers carry its Content-Type). */
const whole = (raw: string): Node => readEntity(raw);

describe("a built signature with a picture", () => {
  it("is plain text and HTML alternatives, the picture the HTML's own related part, referenced by Content-ID", () => {
    const raw = decodeRaw(buildRawMessage(signed(), [], NOW, PNG));
    const top = whole(raw);
    expect(shape(top)).toEqual(["multipart/alternative", ["text/plain", ["multipart/related", ["text/html", "image/png"]]]]);
    expect(top.headers["mime-version"]).toBe("1.0");
    expect(headersOf(raw).From).toBe("dave@example.test");
    const [plain, related] = top.children as [Node, Node];
    expect(related.headers["content-type"]).toMatch(/^multipart\/related; type="text\/html"; boundary="/);
    // the plain part is the words exactly as they were hashed, the signature lines in it once
    expect(plain.body).toBe(crlfText(signed().body_text));
    expect(plain.body.match(/Dave Fisher/g)).toHaveLength(1);
    const [html, img] = related.children as [Node, Node];
    expect(html.headers["content-transfer-encoding"]).toBe("base64");
    const cid = signatureCid(SIG_IMAGE.sha256);
    expect(b64text(html)).toBe(signatureBodyHtml(signed().body_text, SIG_FIELDS, { src: "cid:" + cid, ...pictureSize(SIG_IMAGE) }));
    expect(b64text(html)).toContain(`src="cid:${cid}"`);
    expect(img.headers["content-id"]).toBe(`<${cid}>`);
    expect(img.headers["content-disposition"]).toBe("inline");
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["content-transfer-encoding"]).toBe("base64");
    expect(Buffer.from(b64bytes(img)).equals(Buffer.from(PNG))).toBe(true);
  });

  it("the picture part has no file name: a mail app draws it in the signature and lists nothing as an attachment", () => {
    const raw = decodeRaw(buildRawMessage(signed(), [], NOW, PNG));
    expect(raw).not.toMatch(/filename=|name=/i);
  });

  it("with attachments, the words (both alternatives) are the first part of multipart/mixed and the files follow", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4 fake");
    const att = { storage_id: "u/d/f.pdf", filename: "Transcript.pdf", size_bytes: pdf.length, sha256: "c".repeat(64), mime_type: "application/pdf" };
    const raw = decodeRaw(buildRawMessage(signed({ attachments: [att] }), [{ filename: "Transcript.pdf", mime: "application/pdf", bytes: pdf }], NOW, PNG));
    const top = whole(raw);
    expect(shape(top)).toEqual(["multipart/mixed", [["multipart/alternative", ["text/plain", ["multipart/related", ["text/html", "image/png"]]]], "application/pdf"]]);
    expect(top.children[1]!.headers["content-disposition"]).toBe('attachment; filename="Transcript.pdf"');
    expect(Buffer.from(b64bytes(top.children[1]!)).toString()).toBe("%PDF-1.4 fake");
    expect(raw.trimEnd().endsWith("--=_jarvis_54ce5ab6a6bf4466_3--")).toBe(true);
  });

  it("uses three boundaries and none begins another", () => {
    const raw = decodeRaw(buildRawMessage(signed({ attachments: [{ storage_id: "u/d/f.pdf", filename: "a.pdf", size_bytes: 1, sha256: "c".repeat(64), mime_type: "application/pdf" }] }), [{ filename: "a.pdf", mime: "application/pdf", bytes: new Uint8Array([1]) }], NOW, PNG));
    const bs = [...new Set([...raw.matchAll(/boundary="([^"]+)"/g)].map((m) => m[1]!))];
    expect(bs).toHaveLength(3);
    for (const a of bs) for (const b of bs) if (a !== b) expect(b.startsWith(a)).toBe(false);
  });

  it("is plain text exactly as before when the snapshot has no signature, whatever picture bytes are offered", () => {
    const plain = buildRawMessage(exact(), [], NOW);
    expect(buildRawMessage(exact(), [], NOW, PNG)).toBe(plain);
    expect(headersOf(decodeRaw(plain))["Content-Type"]).toBe("text/plain; charset=UTF-8");
  });

  it("is plain text when the picture was not fetched: never HTML that points at a picture that is not there", () => {
    const raw = decodeRaw(buildRawMessage(signed(), [], NOW));
    expect(headersOf(raw)["Content-Type"]).toBe("text/plain; charset=UTF-8");
    expect(raw).not.toContain("cid:");
  });

  it("is plain text when the body no longer ends with the signature block: a picture never rides beside changed words", () => {
    for (const body of [WORDS, WORDS + SIGNATURE_DELIM + composeSignatureText(SIG_FIELDS) + "\nP.S. one more thing", WORDS + SIGNATURE_DELIM + "Dave Fisher\nFounder"]) {
      const raw = decodeRaw(buildRawMessage(signed({ body_text: body }), [], NOW, PNG));
      expect(headersOf(raw)["Content-Type"]).toBe("text/plain; charset=UTF-8");
      expect(raw).not.toContain("cid:");
    }
  });

  it("refuses a picture type that is not PNG or JPEG, and a content id that could carry a line break", () => {
    expect(() => buildRawMessage(signed({ signature: { fields: SIG_FIELDS, image: { ...SIG_IMAGE, mime_type: "image/gif" as never } } }), [], NOW, PNG)).toThrow(/picture type/);
    expect(() => buildRawMessage(signed({ signature: { fields: SIG_FIELDS, image: { ...SIG_IMAGE, sha256: "ab\r\nBcc: x@y.test" } } }), [], NOW, PNG)).toThrow(/Content-ID/);
  });

  it("refuses words that hold one of its boundary lines instead of cutting the message in two", () => {
    const d = "54ce5ab6a6bf4466_3";
    expect(() => buildRawMessage(signed({ body_text: `Hello\n--=_jarvis_alt_${d}\n` + SIGNATURE_DELIM + composeSignatureText(SIG_FIELDS) }), [], NOW, PNG)).toThrow(/boundary/);
    expect(() => buildRawMessage(exact({ body_text: `Hello\n--=_jarvis_${d}\nmore`, attachments: [{ storage_id: "u/d/f.pdf", filename: "a.pdf", size_bytes: 1, sha256: "c".repeat(64), mime_type: "application/pdf" }] }), [{ filename: "a.pdf", mime: "application/pdf", bytes: new Uint8Array([1]) }], NOW)).toThrow(/boundary/);
  });

  it("a JPEG goes out as image/jpeg", () => {
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
    const raw = decodeRaw(buildRawMessage(signed({ signature: { fields: SIG_FIELDS, image: { ...SIG_IMAGE, mime_type: "image/jpeg", size_bytes: jpg.length } } }), [], NOW, jpg));
    expect(whole(raw).children[1]!.children[1]!.headers["content-type"]).toBe("image/jpeg");
  });
});

describe("pictureKind", () => {
  it("knows a PNG and a JPEG by their first bytes, and nothing else", () => {
    expect(pictureKind(PNG)).toBe("image/png");
    expect(pictureKind(Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0, 0]))).toBe("image/jpeg");
    expect(pictureKind(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(pictureKind(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(pictureKind(new TextEncoder().encode("%PDF-1.4"))).toBeNull();
    expect(pictureKind(Uint8Array.from([0x89, 0x50]))).toBeNull();
    expect(pictureKind(new Uint8Array(0))).toBeNull();
  });
});
