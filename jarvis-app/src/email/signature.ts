// THE SIGNATURE BUILDER'S ONE COMPOSER (issue 113; Dave 2026-10-13: "Upload a pic. It auto scales. Enter your info and it
// creates a perfect signature." and "It should be super simple.").
//
// A built signature is six info fields and one small picture. Everything that draws it or sends it comes from the
// functions in this file, so what the preview shows is what the draft holds is what the recipient gets:
//
//   composeSignatureText   the lines that go into the draft body (the managed block, src/email/drafts.ts), the plain-text
//                          part of the sent message, and the account's saved signature_text. The server composes the same
//                          text from the same fields (migration 0072, jarvis_signature_text); signature.test.ts holds the
//                          two together.
//   signatureHtml          the picture and the lines as the HTML part of the sent message AND as the builder's live
//                          preview. One function, so the preview cannot drift from the email.
//   signatureBodyHtml      the whole HTML part: the person's words, then the signature in place of the plain-text block.
//
// Pure: no React, no DOM, no clock. The API imports it too (api/_mime.ts builds the message from it).

/** The classic RFC 3676 sig-dashes convention: a distinct block, never baked into the words above it. The draft's managed block is this plus the signature text. */
export const SIGNATURE_DELIM = "\n\n-- \n";

export const SIGNATURE_FIELDS = ["name", "title", "organization", "phone", "email", "website"] as const;
export type SignatureField = (typeof SIGNATURE_FIELDS)[number];
export type SignatureFields = Partial<Record<SignatureField, string>>;

/** The longest each field may be; migration 0072 refuses more (an email address has its own, longer, limit). */
export const SIGNATURE_FIELD_MAX: Record<SignatureField, number> = { name: 200, title: 200, organization: 200, phone: 200, email: 254, website: 200 };

/** A picture the browser scaled to fit and stored in the person's own folder: a reference, never the bytes. */
export interface SignatureImage {
  storage_id: string;
  sha256: string;
  size_bytes: number;
  mime_type: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

/** The scaled picture is stored at twice the size it is drawn at (a sharp picture on a retina screen). */
export const SIGNATURE_PICTURE_SCALE = 2;
/** The box the browser fits the picture into, in stored pixels: 96pt drawn, 192 stored. */
export const SIGNATURE_PICTURE_BOX = 192;
/** The most the stored picture may weigh; migration 0072 refuses more, and a message stays small. */
export const SIGNATURE_PICTURE_MAX_BYTES = 60000;

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * The fields as the server will accept them: only the six known keys, control characters and runs of spaces turned into one
 * space, trimmed, cut at the field's limit, and a blank field left out entirely ("blank fields simply do not appear").
 */
export function cleanFields(fields: SignatureFields | null | undefined): SignatureFields {
  const out: SignatureFields = {};
  if (!fields) return out;
  for (const key of SIGNATURE_FIELDS) {
    const raw = fields[key];
    if (typeof raw !== "string") continue;
    // Cut by characters, as the database counts them, never through the middle of an emoji (a lone half would not save).
    const v = [...raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim()].slice(0, SIGNATURE_FIELD_MAX[key]).join("").trim();
    if (v) out[key] = v;
  }
  return out;
}

/** The filled lines in their fixed order: name, title, organization, phone, email, website. */
export function signatureLines(fields: SignatureFields | null | undefined): Array<{ key: SignatureField; text: string }> {
  const c = cleanFields(fields);
  return SIGNATURE_FIELDS.filter((k) => c[k]).map((k) => ({ key: k, text: c[k]! }));
}

/** The lines, one to a line. This is the account's signature_text and the managed block the draft holds. "" when nothing is filled. */
export function composeSignatureText(fields: SignatureFields | null | undefined): string {
  return signatureLines(fields).map((l) => l.text).join("\n");
}

/** A builder signature has something to save only when at least one field is filled (the picture alone has no lines to carry it). */
export const hasSignatureContent = (fields: SignatureFields | null | undefined): boolean => composeSignatureText(fields) !== "";

// ---- the HTML ------------------------------------------------------------------------------------------------------

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** What a recipient's mail app draws the message in when the sender sets nothing: a neutral system face and size. */
const FACE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const BASE = `font-family:${FACE};font-size:14px;line-height:1.45;color:#222222`;

/** A web address as a link target: http or https only, with https assumed when the person typed none. Null when it is not a link. */
export function websiteHref(raw: string): string | null {
  const v = raw.trim();
  if (!v || /\s/.test(v)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (scheme) return /^https?$/i.test(scheme[1]!) ? v : null;
  return /^[^\s/@]+\.[^\s/@]{2,}([/?#].*)?$/.test(v) ? "https://" + v : null;
}
const emailHref = (raw: string): string | null => (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(raw.trim()) ? "mailto:" + raw.trim() : null);
const phoneHref = (raw: string): string | null => {
  const digits = raw.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 5 ? "tel:" + digits : null;
};

/** The picture's cid: a name that is the same for the same picture, and never leaves the message. */
export const signatureCid = (sha256: string): string => "sig-" + sha256.slice(0, 16) + "@jarvis.local";

/** The size the stored picture is drawn at, in the message and in the preview. */
export function pictureSize(image: Pick<SignatureImage, "width" | "height">): { width: number; height: number } {
  return { width: Math.max(1, Math.round(image.width / SIGNATURE_PICTURE_SCALE)), height: Math.max(1, Math.round(image.height / SIGNATURE_PICTURE_SCALE)) };
}

/** The picture slot as the HTML draws it: `src` is "cid:..." in the message and a local address in the preview. */
export interface PictureSlot { src: string; width: number; height: number }

/**
 * The signature as HTML: the picture on the left (when there is one), the filled lines on the right, the name in bold.
 * Every value is escaped; a link is made only for a real address, phone or website (`links: false` draws plain text, for the
 * builder's preview). One table, no script, no remote address: the picture is the message's own part.
 */
export function signatureHtml(fields: SignatureFields | null | undefined, picture?: PictureSlot | null, opts: { links?: boolean } = {}): string {
  const links = opts.links !== false;
  const lines = signatureLines(fields);
  if (lines.length === 0) return "";
  const link = (href: string | null, text: string): string =>
    links && href ? `<a href="${escapeHtml(href)}" style="color:inherit;text-decoration:none">${escapeHtml(text)}</a>` : escapeHtml(text);
  const rows = lines.map(({ key, text }) => {
    const inner = key === "phone" ? link(phoneHref(text), text) : key === "email" ? link(emailHref(text), text) : key === "website" ? link(websiteHref(text), text) : escapeHtml(text);
    return key === "name" ? `<div style="font-weight:bold">${inner}</div>` : `<div>${inner}</div>`;
  });
  const img = picture
    ? `<td valign="top" style="padding:0 12px 0 0"><img src="${escapeHtml(picture.src)}" width="${picture.width}" height="${picture.height}" alt="" style="display:block;border:0;outline:none"></td>`
    : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${BASE}"><tr>${img}<td valign="top" style="padding:0">${rows.join("")}</td></tr></table>`;
}

/** A message's words as HTML: escaped, line breaks kept, runs of spaces kept. */
export function textToHtml(text: string): string {
  return escapeHtml(text.replace(/\r\n?/g, "\n"))
    .replace(/\t/g, "&nbsp;&nbsp;&nbsp;&nbsp;")
    .replace(/ {2,}/g, (run) => " " + "&nbsp;".repeat(run.length - 1))
    .replace(/(^|\n) /g, "$1&nbsp;")
    .replace(/\n/g, "<br>");
}

/**
 * The whole HTML part of a message that carries a built signature: the person's words, then the signature table in place
 * of the plain-text block at the end of the body. Null when the body does not end with exactly that block (the picture
 * only ever travels with an untouched block; the server checks the same thing before it lets the picture ride).
 */
export function signatureBodyHtml(bodyText: string, fields: SignatureFields, picture?: PictureSlot | null): string | null {
  const text = composeSignatureText(fields);
  if (!text) return null;
  const block = SIGNATURE_DELIM + text;
  if (!bodyText.endsWith(block)) return null;
  const lead = bodyText.slice(0, bodyText.length - block.length);
  const words = lead.trim() === "" ? "" : `<div>${textToHtml(lead)}</div><br>`;
  return `<div style="${BASE}">${words}${signatureHtml(fields, picture)}</div>`;
}

/** The parts of an account the picture's rule reads. */
export interface BuiltSignatureAccount {
  signature_text: string;
  signature_revision: number;
  signature_kind?: "text" | "built";
  signature_fields?: SignatureFields;
  signature_image?: SignatureImage | null;
}

/**
 * Whether the account's picture goes out with this draft: the signature is built and has a picture, the draft was made against its
 * current revision, and the body still ends with exactly its block. send_review (migration 0072) decides the same thing for the
 * message that leaves; this tells the draft and the composer what that decision will be. Null when it does not.
 */
export function travellingPicture(body: string, draftRevision: number | null, account: BuiltSignatureAccount | null | undefined): SignatureImage | null {
  if (!account || account.signature_kind !== "built" || !account.signature_image || account.signature_text === "") return null;
  if (draftRevision === null || draftRevision !== account.signature_revision) return null;
  // The sender draws the HTML from the details, so the details must say exactly the lines the draft holds (they always do for a
  // signature the builder saved; a row written another way that disagrees sends plain text, and the draft must not promise more).
  if (composeSignatureText(account.signature_fields) !== account.signature_text) return null;
  return body.endsWith(SIGNATURE_DELIM + account.signature_text) ? account.signature_image : null;
}
