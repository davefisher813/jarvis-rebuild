// THE MESSAGE AS IT LEAVES (docs/jarvis-unified, slice 07; IMPLEMENTATION-SPEC.md
// 07.3; API-AND-VALIDATION.md "Canonical hashes": CRLF line endings for MIME,
// never a rewritten body). One function turns the reviewed snapshot into the
// RFC 822 text Gmail's send takes, base64url encoded. Every header line is
// checked for a line break before it is written, so no field can smuggle a
// second header; non-ASCII headers are RFC 2047 encoded words; Bcc is a header
// here because Gmail reads it from the raw message and strips it from what the
// recipients receive. Attachments ride as base64 parts under multipart/mixed,
// with the bytes the worker fetched and hashed, never bytes from the browser.

import { b64urlEncode } from "../src/connections/google/map";

export interface ExactAttachment { storage_id: string; filename: string; size_bytes: number; sha256: string; mime_type: string }
export interface ExactSend {
  account_id: string;
  from_identity: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body_text: string;
  attachments: ExactAttachment[];
  reply_headers: { in_reply_to: string | null; references: string[]; thread_id: string | null };
  draft_id: string;
  draft_revision: number;
  client_message_id: string;
}

export interface AttachmentBytes { filename: string; mime: string; bytes: Uint8Array }

const BREAK = /[\r\n]/;

/** A header value with no line break in it, or a throw: a value that could become a second header never leaves. */
function headerValue(name: string, value: string): string {
  if (BREAK.test(value)) throw new Error(`header ${name} holds a line break`);
  return value;
}

/** RFC 2047 B-encoding for a header that is not plain ASCII; ASCII goes as it is. */
export function encodeWord(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const bytes = new TextEncoder().encode(s);
  const words: string[] = [];
  // 45 bytes a word keeps every encoded word under the 75-character limit.
  for (let i = 0; i < bytes.length; i += 45) words.push("=?UTF-8?B?" + base64Of(bytes.subarray(i, i + 45)) + "?=");
  return words.join("\r\n ");
}

export function base64Of(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Base64 wrapped at 76 columns, the RFC 2045 rule for a body part. */
function base64Lines(bytes: Uint8Array): string {
  return base64Of(bytes).match(/.{1,76}/g)?.join("\r\n") ?? "";
}

/** An address list header, folded at commas so no line passes 900 characters. */
function addressHeader(name: string, addresses: string[]): string {
  const lines: string[] = [];
  let cur = "";
  for (const a of addresses.map((x) => headerValue(name, x.trim())).filter(Boolean)) {
    const piece = cur ? ", " + a : a;
    if (cur && cur.length + piece.length > 900) { lines.push(cur + ","); cur = " " + a; } else cur += piece;
  }
  if (cur) lines.push(cur);
  return `${name}: ${lines.join("\r\n")}`;
}

/** RFC 2822 date in UTC. */
export function rfc2822Date(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

/** The message's text with CRLF line endings and no bare CR. */
export function crlf(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n");
}

/** The raw message, as base64url, for Gmail's messages.send. `parts` are the attachments' bytes in the snapshot's order. */
export function buildRawMessage(exact: ExactSend, parts: AttachmentBytes[], now: Date = new Date()): string {
  if (parts.length !== exact.attachments.length) throw new Error("attachments and bytes differ");
  if (exact.to.length === 0) throw new Error("no recipient");
  const headers: string[] = [];
  headers.push(`From: ${headerValue("From", exact.from_identity.trim())}`);
  headers.push(addressHeader("To", exact.to));
  if (exact.cc.length) headers.push(addressHeader("Cc", exact.cc));
  if (exact.bcc.length) headers.push(addressHeader("Bcc", exact.bcc));
  headers.push(`Subject: ${encodeWord(headerValue("Subject", exact.subject))}`);
  headers.push(`Date: ${rfc2822Date(now)}`);
  headers.push(`Message-ID: ${headerValue("Message-ID", exact.client_message_id)}`);
  const rh = exact.reply_headers;
  if (rh.in_reply_to) headers.push(`In-Reply-To: ${headerValue("In-Reply-To", rh.in_reply_to)}`);
  const refs = [...rh.references.map((r) => headerValue("References", r)), ...(rh.in_reply_to && !rh.references.includes(rh.in_reply_to) ? [rh.in_reply_to] : [])];
  if (refs.length) headers.push(`References: ${refs.join("\r\n ")}`);
  headers.push("MIME-Version: 1.0");

  const body = crlf(exact.body_text);
  if (parts.length === 0) {
    headers.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit");
    return b64urlEncode(headers.join("\r\n") + "\r\n\r\n" + body);
  }
  const boundary = "=_jarvis_" + exact.draft_id.replace(/-/g, "").slice(0, 16) + "_" + exact.draft_revision.toString(36);
  const sections = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ];
  parts.forEach((p, i) => {
    const meta = exact.attachments[i]!;
    const name = encodeWord(headerValue("filename", meta.filename).replace(/"/g, ""));
    sections.push(
      `--${boundary}`,
      `Content-Type: ${headerValue("Content-Type", p.mime || meta.mime_type || "application/octet-stream")}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(p.bytes),
    );
  });
  sections.push(`--${boundary}--`);
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  return b64urlEncode(headers.join("\r\n") + "\r\n\r\n" + sections.join("\r\n"));
}

/** The raw text back from base64url, for a test or a receipt's evidence. */
export function decodeRaw(raw: string): string {
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** SHA-256 of bytes as lowercase hex, the hash an attachment ref carries. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = new Uint8Array(bytes.byteLength);
  buf.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
