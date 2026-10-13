// THE MESSAGE AS IT LEAVES (docs/jarvis-unified, slice 07; IMPLEMENTATION-SPEC.md
// 07.3; API-AND-VALIDATION.md "Canonical hashes": CRLF line endings for MIME,
// never a rewritten body). One function turns the reviewed snapshot into the
// RFC 822 text Gmail's send takes, base64url encoded. Every header line is
// checked for a line break before it is written, so no field can smuggle a
// second header; non-ASCII headers are RFC 2047 encoded words; Bcc is a header
// here because Gmail reads it from the raw message and strips it from what the
// recipients receive. Attachments ride as base64 parts under multipart/mixed,
// with the bytes the worker fetched and hashed, never bytes from the browser.
//
// A BUILT SIGNATURE WITH A PICTURE (issue 113) is the one case where the message is
// not plain text only: the same words go out as the text/plain part (every client
// can read it, and it is what the hash bound) and as an HTML part in which the
// signature's lines sit beside the picture. The picture is the message's own part,
// referenced by Content-ID (cid:), so the recipient needs no remote address and
// nothing loads from outside. Every piece of that HTML comes from
// src/email/signature.ts, the same functions that draw the builder's preview.

import { b64urlEncode } from "../src/connections/google/map";
import { signatureBodyHtml, signatureCid, pictureSize, type SignatureFields, type SignatureImage } from "../src/email/signature";

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
  /** Present only when send_review saw an untouched built signature with a picture at the end of the body (migration 0072). */
  signature?: { fields: SignatureFields; image: SignatureImage };
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

/** What the first bytes say a picture is: PNG or JPEG, or null. A signature picture is trusted only when its bytes are what its reference claims. */
export function pictureKind(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** One MIME entity: its header lines and its body. */
interface Entity { headers: string[]; body: string }

/** A boundary line inside the text it is meant to separate would cut the message in two; none ever should, and one never leaves. */
function clearOf(boundaries: string[], text: string): void {
  const lines = text.split("\n");
  for (const b of boundaries) if (lines.some((l) => l.startsWith("--" + b))) throw new Error("boundary inside the text");
}

/** The three boundaries a message can need. None is the start of another (a parser that matches only the start of a line would take it for the outer one). */
function boundariesFor(exact: ExactSend): { mixed: string; alt: string; rel: string } {
  const tail = exact.draft_id.replace(/-/g, "").slice(0, 16) + "_" + exact.draft_revision.toString(36);
  return { mixed: "=_jarvis_" + tail, alt: "=_jarvis_alt_" + tail, rel: "=_jarvis_rel_" + tail };
}

/**
 * The person's words as one entity. Plain text, with the text itself untouched, unless the snapshot carries a built signature
 * with its picture and the body still ends with exactly that signature's block: then the same text is the first alternative
 * and the second is the HTML (the words, then the signature table beside its picture) with the picture as the HTML's own
 * related part, referenced by Content-ID. Anything short of all of that is plain text, never a picture beside changed words.
 */
function wordsEntity(exact: ExactSend, plain: string, picture: Uint8Array | undefined, alt: string, rel: string): Entity {
  const sig = exact.signature;
  const asText: Entity = { headers: ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit"], body: plain };
  if (!sig || !picture) return asText;
  const mime = sig.image.mime_type;
  if (mime !== "image/png" && mime !== "image/jpeg") throw new Error("signature picture type");
  const cid = signatureCid(sig.image.sha256);
  const html = signatureBodyHtml(exact.body_text, sig.fields, { src: "cid:" + cid, ...pictureSize(sig.image) });
  if (html === null) return asText;
  clearOf([alt, rel], plain);
  const related = [
    `--${rel}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(new TextEncoder().encode(html)),
    `--${rel}`,
    `Content-Type: ${mime}`,
    "Content-Transfer-Encoding: base64",
    `Content-ID: <${headerValue("Content-ID", cid)}>`,
    "Content-Disposition: inline",
    "",
    base64Lines(picture),
    `--${rel}--`,
  ].join("\r\n");
  const body = [
    `--${alt}`,
    ...asText.headers,
    "",
    plain,
    `--${alt}`,
    `Content-Type: multipart/related; type="text/html"; boundary="${rel}"`,
    "",
    related,
    `--${alt}--`,
  ].join("\r\n");
  return { headers: [`Content-Type: multipart/alternative; boundary="${alt}"`], body };
}

/**
 * The raw message, as base64url, for Gmail's messages.send. `parts` are the attachments' bytes in the snapshot's order.
 * `signaturePicture` is the built signature's picture, fetched and verified by the worker (api/_send.ts); without it, or
 * without a signature in the snapshot, the message is exactly what it was before the builder existed.
 */
export function buildRawMessage(exact: ExactSend, parts: AttachmentBytes[], now: Date = new Date(), signaturePicture?: Uint8Array): string {
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

  const { mixed: boundary, alt, rel } = boundariesFor(exact);
  const plain = crlf(exact.body_text);
  const words = wordsEntity(exact, plain, signaturePicture, alt, rel);
  if (parts.length === 0) {
    headers.push(...words.headers);
    return b64urlEncode(headers.join("\r\n") + "\r\n\r\n" + words.body);
  }
  clearOf([boundary], plain);
  const sections = [
    `--${boundary}`,
    ...words.headers,
    "",
    words.body,
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
