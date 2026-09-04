import { describe, it, expect } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_TOO_BIG_MESSAGE,
  validateUpload,
  buildStoragePath,
  uploadUniquifier,
  stripJpegMetadata,
  stripPngMetadata,
  jpegHasGps,
} from "./fileStorage";

// --- synthetic JPEG with a GPS-bearing EXIF block ---------------------------

function jpegSegment(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
}

// Minimal EXIF APP1 payload: "Exif\0\0" + TIFF header + one IFD entry whose
// tag is 0x8825 (the GPS IFD pointer). Enough structure for a byte scan.
const EXIF_GPS_PAYLOAD = [
  0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
  0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF big-endian header
  0x00, 0x01, // one IFD entry
  0x88, 0x25, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, // GPS pointer tag
  0x00, 0x00, 0x00, 0x00,
];

function buildJpegWithGps(): Uint8Array {
  const app0 = jpegSegment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const app1 = jpegSegment(0xe1, EXIF_GPS_PAYLOAD);
  const com = jpegSegment(0xfe, [0x68, 0x69]); // COM "hi"
  const dqt = jpegSegment(0xdb, new Array(65).fill(0x10));
  const sos = [0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9]; // fake entropy data + EOI
  return new Uint8Array([0xff, 0xd8, ...app0, ...app1, ...com, ...dqt, ...sos]);
}

// --- synthetic PNG with eXIf and tEXt chunks --------------------------------

function pngChunk(type: string, data: number[]): number[] {
  const t = [...type].map((c) => c.charCodeAt(0));
  const len = data.length;
  return [(len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...t, ...data, 0, 0, 0, 0];
}

function buildPngWithMetadata(): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]);
  const exif = pngChunk("eXIf", [0x88, 0x25, 1, 2, 3]);
  const text = pngChunk("tEXt", [...("GPS 1.23,4.56")].map((c) => c.charCodeAt(0)));
  const idat = pngChunk("IDAT", [1, 2, 3, 4]);
  const iend = pngChunk("IEND", []);
  return new Uint8Array([...sig, ...ihdr, ...exif, ...text, ...idat, ...iend]);
}

describe("upload size gate", () => {
  it("rejects files over 10MB with the standard message, before any network call", () => {
    expect(validateUpload(MAX_UPLOAD_BYTES + 1, "image/jpeg")).toBe(UPLOAD_TOO_BIG_MESSAGE);
  });
  it("accepts files at the limit", () => {
    expect(validateUpload(MAX_UPLOAD_BYTES, "image/jpeg")).toBeNull();
  });
  it("rejects types the bucket does not allow", () => {
    expect(validateUpload(100, "application/zip")).not.toBeNull();
  });
  it("accepts every bucket-allowed type", () => {
    for (const t of ["image/jpeg", "image/png", "image/heic", "image/webp", "application/pdf"]) {
      expect(validateUpload(100, t)).toBeNull();
    }
  });
});

describe("EXIF strip: no GPS tags survive the pipeline", () => {
  it("source JPEG demonstrably carries a GPS pointer", () => {
    expect(jpegHasGps(buildJpegWithGps())).toBe(true);
  });
  it("stripped JPEG has no GPS pointer and no APP1 or COM segments", () => {
    const stripped = stripJpegMetadata(buildJpegWithGps());
    expect(jpegHasGps(stripped)).toBe(false);
    for (let i = 0; i + 1 < stripped.length; i++) {
      const isSegStart = stripped[i] === 0xff && (stripped[i + 1] === 0xe1 || stripped[i + 1] === 0xfe);
      expect(isSegStart).toBe(false);
    }
  });
  it("keeps JFIF, quantization tables, and the entropy-coded data intact", () => {
    const src = buildJpegWithGps();
    const stripped = stripJpegMetadata(src);
    expect(stripped[0]).toBe(0xff);
    expect(stripped[1]).toBe(0xd8);
    const hex = Buffer.from(stripped).toString("hex");
    expect(hex).toContain("ffe0"); // JFIF stays
    expect(hex).toContain("ffdb"); // DQT stays
    expect(hex).toContain("ffda000211223"); // SOS + data verbatim
    expect(stripped[stripped.length - 1]).toBe(0xd9); // EOI intact
  });
  it("passes non-JPEG bytes through untouched", () => {
    const junk = new Uint8Array([1, 2, 3]);
    expect(stripJpegMetadata(junk)).toBe(junk);
  });
});

describe("PNG metadata strip", () => {
  it("drops eXIf and text chunks, keeps IHDR/IDAT/IEND", () => {
    const stripped = stripPngMetadata(buildPngWithMetadata());
    const ascii = Buffer.from(stripped).toString("latin1");
    expect(ascii).not.toContain("eXIf");
    expect(ascii).not.toContain("tEXt");
    expect(ascii).not.toContain("GPS 1.23");
    expect(ascii).toContain("IHDR");
    expect(ascii).toContain("IDAT");
    expect(ascii).toContain("IEND");
  });
});

describe("storage path convention", () => {
  it("builds user-files/{uid}/{entityId}/{uniq}-{filename} with the uid first", () => {
    expect(buildStoragePath("u1", "e1", "receipt.pdf", "a1b2c3")).toBe("u1/e1/a1b2c3-receipt.pdf");
  });
  it("sanitizes hostile filenames so they cannot escape the tree", () => {
    const p = buildStoragePath("u1", "e1", "../../etc/passwd", "a1b2c3");
    expect(p.startsWith("u1/e1/")).toBe(true);
    expect(p).not.toContain("..");
  });
  // B1-6 (2026-09-04): two photos with the same filename used to overwrite
  // each other in storage, silently, because the path had nothing but the
  // filename to tell them apart. The uniquifier is what stops that.
  it("gives two uploads of the same filename different paths", () => {
    const a = buildStoragePath("u1", "e1", "IMG_0001.jpg", uploadUniquifier());
    const b = buildStoragePath("u1", "e1", "IMG_0001.jpg", uploadUniquifier());
    expect(a).not.toBe(b);
  });
  it("the uniquifier itself is different call to call", () => {
    expect(uploadUniquifier()).not.toBe(uploadUniquifier());
  });
});
