// Encode a photo for the AI vision proxy so it can never silently 413.
//
// The proxy caps the WHOLE request body at AI_MAX_VISION_BYTES (default
// 600,000). The gym uploader guessed one downscale (1568px, quality 0.85) and
// never checked the result against that cap, so a dense/colorful screenshot
// could produce a base64 payload over the limit and fail with no retry and no
// useful error. This tries progressively smaller encodings and stops at the
// first one that actually fits, so the guess is verified, not assumed.
//
// BUDGET leaves headroom below the proxy's default cap for the JSON envelope
// and prompt text that travel alongside the image data in the same request.
export const IMAGE_BYTE_BUDGET = 480_000;

export interface EncodedImage { data: string; mediaType: string }

const DIMS = [1568, 1200, 900, 650, 480];
const QUALITIES = [0.85, 0.7, 0.55, 0.4];

function encodeAt(img: HTMLImageElement, maxDim: number, quality: number): string {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

// Downscale and re-encode a photo/screenshot until the base64 payload fits
// the size budget, trying smaller dimensions before dropping quality (a
// smaller-but-crisp read beats a full-size blurry one). Always returns
// something: if even the smallest/lowest-quality pass is still over budget,
// that smallest encoding is returned rather than throwing, so the caller
// gets a clear 413 from the server instead of a client-side dead end.
//
// SHARED-F-23 (2026-09-05): the loops used to be nested the other way round,
// quality inside dimension, which does the OPPOSITE of the sentence above:
// an over-budget photo was pushed to quality 0.4 at a full 1568px, blurry and
// still large, before a single downscale was tried. Quality is the outer loop
// now, so every dimension is tried at 0.85 first and the drop to 0.7 only
// happens once even 480px will not fit at 0.85. Same passes, same worst case,
// the order the policy actually asks for.
export async function encodeImageForVision(file: File): Promise<EncodedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("unreadable image"));
      i.src = url;
    });
    let smallest = "";
    for (const q of QUALITIES) {
      for (const maxDim of DIMS) {
        const dataUrl = encodeAt(img, maxDim, q);
        const data = dataUrl.split(",")[1] ?? "";
        smallest = data;
        if (data.length <= IMAGE_BYTE_BUDGET) return { data, mediaType: "image/jpeg" };
      }
    }
    return { data: smallest, mediaType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}
