// THE PICTURE, FITTED (issue 113; Dave 2026-10-13: "Upload a pic. It auto scales."). The person picks any photo or logo and
// this makes the one small picture the signature carries: no cropping tool, no size error, no instructions. It reads the
// picture the way the phone drew it (a photo taken sideways stands up), fits the whole of it inside the signature's picture
// box without cutting anything off or stretching it (a wide logo stays wide), never makes it bigger than it was, keeps a
// transparent logo transparent, and saves a photograph as a JPEG on white so no black corners appear. The box is
// SIGNATURE_PICTURE_BOX stored pixels, drawn at half that (signature.ts), so a retina screen gets a sharp one; the file stays
// under SIGNATURE_PICTURE_MAX_BYTES by stepping the size and quality down, never by refusing. The only thing it ever rejects is
// a file that is not a picture this browser can read.
//
// The browser's canvas sits behind PictureIO so the decisions (the fit, the format, the steps) are tested without one;
// the real thing is checked in a real browser.

import { SIGNATURE_PICTURE_BOX, SIGNATURE_PICTURE_MAX_BYTES } from "./signature";

export type PictureMime = "image/png" | "image/jpeg";
export interface FittedPicture { file: File; mime: PictureMime; width: number; height: number }

/** The file is not a picture this browser can read (a HEIC on a browser that cannot draw one, a text file renamed .png). */
export class PictureUnreadable extends Error {
  constructor() { super("unreadable picture"); this.name = "PictureUnreadable"; }
}

/** The largest size that fits inside a square box with the picture's own shape; never larger than the picture itself, never under one pixel. */
export function fitBox(width: number, height: number, box: number): { width: number; height: number } {
  const w = width > 0 ? width : box;
  const h = height > 0 ? height : box;
  const scale = Math.min(1, box / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

// ---- the browser, behind one seam ------------------------------------------------------------------------------------------

/** Something that can be drawn: the decoded picture, or an earlier surface. Opaque to the algorithm. */
export type Drawable = object;
export interface Surface {
  readonly width: number;
  readonly height: number;
  /** What a later draw reads from. */
  readonly drawable: Drawable;
  /** Draws `from` scaled to fill the whole surface, with the best resampling the browser has. */
  drawFill(from: Drawable): void;
  /** True when any pixel is not fully opaque. */
  hasTransparency(): boolean;
  /** Paints white behind everything already drawn (a transparent corner becomes white, not black). */
  flattenOnWhite(): void;
  /** Null when the browser cannot encode this type. */
  encode(mime: PictureMime, quality: number): Promise<Blob | null>;
}
export interface Decoded { width: number; height: number; drawable: Drawable; release: () => void }
export interface PictureIO {
  decode(file: File): Promise<Decoded>;
  surface(width: number, height: number): Surface;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new PictureUnreadable());
    img.src = url;
  });
}

export const browserIO: PictureIO = {
  async decode(file) {
    // createImageBitmap stands a sideways phone photo up when told to; where it is missing or refuses (older Safari, an SVG),
    // an <img> does the same for the file's own orientation.
    if (typeof createImageBitmap === "function" && file.type !== "image/svg+xml") {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
        return { width: bmp.width, height: bmp.height, drawable: bmp, release: () => bmp.close() };
      } catch { /* the <img> below tries */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      return { width: img.naturalWidth, height: img.naturalHeight, drawable: img, release: () => URL.revokeObjectURL(url) };
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e instanceof PictureUnreadable ? e : new PictureUnreadable();
    }
  },
  surface(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new PictureUnreadable();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    return {
      width, height, drawable: canvas,
      drawFill: (from) => ctx.drawImage(from as CanvasImageSource, 0, 0, width, height),
      hasTransparency: () => {
        const px = ctx.getImageData(0, 0, width, height).data;
        for (let i = 3; i < px.length; i += 4) if (px[i]! < 255) return true;
        return false;
      },
      flattenOnWhite: () => {
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = "source-over";
      },
      encode: (mime, quality) => new Promise((resolve) => canvas.toBlob(resolve, mime, quality)),
    };
  },
};

// ---- the fit -----------------------------------------------------------------------------------------------------------------

/** Each step is a smaller box and a lower JPEG quality, tried in turn until the file is light enough. The first is the normal case. */
const STEPS: ReadonlyArray<{ box: number; quality: number }> = [
  { box: SIGNATURE_PICTURE_BOX, quality: 0.88 },
  { box: Math.round(SIGNATURE_PICTURE_BOX * 0.83), quality: 0.8 },
  { box: Math.round(SIGNATURE_PICTURE_BOX * 0.67), quality: 0.72 },
  { box: Math.round(SIGNATURE_PICTURE_BOX * 0.5), quality: 0.64 },
];
/** A flat logo saved as PNG stays crisp; past this it is a photograph in a PNG and a JPEG is the right file. */
const PNG_PREFERRED_BYTES = 30000;
/** Source types that are usually flat artwork rather than photographs. */
const FLAT_TYPES = new Set(["image/png", "image/gif", "image/svg+xml", "image/webp"]);

/** Draws `from` down to width by height in halves, so a 4000 pixel photograph is not squeezed into 192 in one jump (which aliases). */
function scaleDown(io: PictureIO, from: Decoded, width: number, height: number): Surface {
  let src: Drawable = from.drawable;
  let w = from.width > 0 ? from.width : width;
  let h = from.height > 0 ? from.height : height;
  while (w / 2 >= width && h / 2 >= height) {
    const nw = Math.max(width, Math.round(w / 2));
    const nh = Math.max(height, Math.round(h / 2));
    const half = io.surface(nw, nh);
    half.drawFill(src);
    src = half.drawable;
    w = nw;
    h = nh;
  }
  const out = io.surface(width, height);
  out.drawFill(src);
  return out;
}

async function encodeOnce(s: Surface, sourceType: string, quality: number): Promise<{ blob: Blob; mime: PictureMime }> {
  if (s.hasTransparency()) {
    const png = await s.encode("image/png", 1);
    if (png) return { blob: png, mime: "image/png" };
  } else if (FLAT_TYPES.has(sourceType)) {
    const png = await s.encode("image/png", 1);
    if (png && png.size <= PNG_PREFERRED_BYTES) return { blob: png, mime: "image/png" };
  }
  s.flattenOnWhite();
  const jpeg = await s.encode("image/jpeg", quality);
  if (!jpeg) throw new PictureUnreadable();
  return { blob: jpeg, mime: "image/jpeg" };
}

const nameFor = (mime: PictureMime): string => (mime === "image/png" ? "signature.png" : "signature.jpg");

/**
 * The signature's picture from whatever the person picked. Always resolves for a picture the browser can read; the file it
 * returns is a PNG or a JPEG of at most SIGNATURE_PICTURE_MAX_BYTES, inside the picture box, with the picture's own shape.
 */
export async function fitPicture(file: File, io: PictureIO = browserIO): Promise<FittedPicture> {
  const decoded = await io.decode(file);
  try {
    let last: { blob: Blob; mime: PictureMime; width: number; height: number } | null = null;
    for (const step of STEPS) {
      const { width, height } = fitBox(decoded.width, decoded.height, step.box);
      const surface = scaleDown(io, decoded, width, height);
      const enc = await encodeOnce(surface, file.type, step.quality);
      last = { ...enc, width, height };
      if (enc.blob.size <= SIGNATURE_PICTURE_MAX_BYTES) break;
    }
    if (!last) throw new PictureUnreadable();
    if (last.blob.size > SIGNATURE_PICTURE_MAX_BYTES) {
      // Heavier than the cap even at the smallest step (a transparent picture full of fine detail): flatten it onto white as a JPEG.
      const floor = STEPS[STEPS.length - 1]!;
      const { width, height } = fitBox(decoded.width, decoded.height, floor.box);
      const surface = scaleDown(io, decoded, width, height);
      surface.flattenOnWhite();
      const jpeg = await surface.encode("image/jpeg", 0.5);
      if (jpeg) last = { blob: jpeg, mime: "image/jpeg", width, height };
    }
    return { file: new File([last.blob], nameFor(last.mime), { type: last.mime }), mime: last.mime, width: last.width, height: last.height };
  } finally {
    decoded.release();
  }
}
