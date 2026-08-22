// Shared file-upload pipeline for Supabase Storage (bucket: user-files,
// migration 0020). Every upload path in the app goes through prepareUpload;
// nothing calls storage directly with a raw File. Guarantees, in order:
//
//   1. Size gate: anything over MAX_UPLOAD_BYTES is rejected client-side
//      with the standard error toast message, before any network call.
//   2. Privacy gate: EXIF metadata (including GPS) is stripped from images
//      BEFORE upload. JPEG and PNG are stripped losslessly at the byte level
//      (pure functions below, unit-tested). HEIC and WebP are re-encoded to
//      JPEG through a canvas, which drops all metadata by construction.
//      PDFs pass through untouched.
//   3. Path convention: user-files/{uid}/{entityId}/{filename}. The bucket
//      policies pin the first folder segment to auth.uid, so a wrong path
//      fails loudly at the server rather than landing in someone else's tree.
//
// The byte-level strippers are pure so vitest can prove no GPS tag survives
// without needing a browser.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_TOO_BIG_MESSAGE = "Over 10MB · Pick a smaller file";

export const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/pdf",
];

// Returns an error message for the standard toast, or null when the file is
// acceptable. Runs before any processing or network work.
export function validateUpload(size: number, mimeType: string): string | null {
  if (size > MAX_UPLOAD_BYTES) return UPLOAD_TOO_BIG_MESSAGE;
  if (!ALLOWED_UPLOAD_TYPES.includes(mimeType)) return "That file type is not supported.";
  return null;
}

// user-files/{uid}/{entityId}/{filename}, with the filename reduced to a
// safe character set so a pasted name can never break the path.
export function buildStoragePath(uid: string, entityId: string, filename: string): string {
  const safe = filename
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .slice(0, 120) || "file";
  return `${uid}/${entityId}/${safe}`;
}

// ---------------------------------------------------------------------------
// JPEG: drop the metadata segments (APP1 carries EXIF and with it GPS; APP2
// through APP13 carry ICC/IPTC/Photoshop blocks; COM is free text). APP0
// (JFIF) and APP14 (Adobe color transform) stay because decoders use them.
// Pixel data is untouched: from SOS onward the stream copies verbatim.
// ---------------------------------------------------------------------------
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i]! !== 0xff) break; // corrupt stream; keep the rest as-is
    const marker = bytes[i + 1]!;
    if (marker === 0xda) break; // SOS: entropy-coded data starts, copy the rest
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    const segEnd = i + 2 + len;
    if (len < 2 || segEnd > bytes.length) break;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keepApp = marker === 0xe0 || marker === 0xee; // JFIF, Adobe
    const drop = (isApp && !keepApp) || marker === 0xfe; // metadata APPn, COM
    if (!drop) for (let j = i; j < segEnd; j++) out.push(bytes[j]!);
    i = segEnd;
  }
  const head = new Uint8Array(out);
  const tail = bytes.subarray(i);
  const result = new Uint8Array(head.length + tail.length);
  result.set(head, 0);
  result.set(tail, head.length);
  return result;
}

// ---------------------------------------------------------------------------
// PNG: drop the metadata chunks (eXIf can carry GPS; tEXt/zTXt/iTXt carry
// free text and XMP, which can also embed location). Everything else,
// critical or ancillary, passes through untouched.
// ---------------------------------------------------------------------------
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);

export function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8 || !PNG_SIG.every((b, i) => bytes[i] === b)) return bytes;
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const len = (bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!;
    const type = String.fromCharCode(bytes[i + 4]!, bytes[i + 5]!, bytes[i + 6]!, bytes[i + 7]!);
    const chunkEnd = i + 12 + len;
    if (len < 0 || chunkEnd > bytes.length) break;
    if (!PNG_DROP.has(type)) kept.push(bytes.subarray(i, chunkEnd));
    i = chunkEnd;
    if (type === "IEND") break;
  }
  const total = kept.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const c of kept) { result.set(c, off); off += c.length; }
  return result;
}

// True when any JPEG APP1 EXIF block contains a GPS IFD pointer (tag 0x8825).
// Test helper and belt-and-braces check; not used to decide whether to strip
// (stripping is unconditional).
export function jpegHasGps(bytes: Uint8Array): boolean {
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i]! === 0xff) {
    const marker = bytes[i + 1]!;
    if (marker === 0xda) return false;
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    const segEnd = i + 2 + len;
    if (len < 2 || segEnd > bytes.length) return false;
    if (marker === 0xe1) {
      const seg = bytes.subarray(i + 4, segEnd);
      for (let j = 0; j + 1 < seg.length; j++) {
        if ((seg[j] === 0x88 && seg[j + 1] === 0x25) || (seg[j] === 0x25 && seg[j + 1] === 0x88)) return true;
      }
    }
    i = segEnd;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Browser entry point: returns upload-ready bytes with metadata removed, or
// throws with a user-facing message (callers surface it via the standard
// error toast). HEIC/WebP go through a canvas re-encode, which cannot carry
// metadata into the output.
// ---------------------------------------------------------------------------
export interface PreparedUpload { bytes: Uint8Array; mimeType: string; filename: string }

export async function prepareUpload(file: File): Promise<PreparedUpload> {
  const invalid = validateUpload(file.size, file.type);
  if (invalid) throw new Error(invalid);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.type === "image/jpeg") {
    return { bytes: stripJpegMetadata(bytes), mimeType: file.type, filename: file.name };
  }
  if (file.type === "image/png") {
    return { bytes: stripPngMetadata(bytes), mimeType: file.type, filename: file.name };
  }
  if (file.type === "image/heic" || file.type === "image/webp") {
    const jpeg = await reencodeToJpeg(file);
    const stem = file.name.replace(/\.[^.]*$/, "") || "image";
    return { bytes: jpeg, mimeType: "image/jpeg", filename: `${stem}.jpg` };
  }
  return { bytes, mimeType: file.type, filename: file.name }; // pdf
}

async function reencodeToJpeg(file: File): Promise<Uint8Array> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Couldn't read that image."));
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) throw new Error("Couldn't read that image.");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
