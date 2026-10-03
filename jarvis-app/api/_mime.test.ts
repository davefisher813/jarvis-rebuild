import { describe, it, expect } from "vitest";
import { buildRawMessage, decodeRaw, encodeWord, rfc2822Date, sha256Hex, type ExactSend } from "./_mime";

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
