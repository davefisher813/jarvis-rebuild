// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { encodeImageForVision, IMAGE_BYTE_BUDGET } from "./imageEncode";

// SHARED-F-23 (2026-09-05): the encoder had no test at all, which is how its
// loops stayed nested the opposite way round from the policy in its own
// header for as long as they did. These record the ORDER it tries passes in,
// because that order is the whole point: a smaller-but-crisp read beats a
// full-size blurry one.

type Attempt = { maxDim: number; quality: number };

// Stubs the two browser things the encoder touches: an Image that loads
// immediately at a known size, and a canvas whose toDataURL records the pass
// it was asked for and returns a payload of whatever length `sizeFor` says.
function stubCanvas(sizeFor: (a: Attempt) => number): Attempt[] {
  const attempts: Attempt[] = [];
  const IMG_W = 4000;
  const IMG_H = 3000;

  class FakeImage {
    width = IMG_W;
    height = IMG_H;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  }
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });

  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "canvas") return realCreate(tag);
    const el = { width: 0, height: 0 } as unknown as HTMLCanvasElement & { width: number; height: number };
    el.getContext = (() => ({ drawImage: () => {} })) as unknown as HTMLCanvasElement["getContext"];
    el.toDataURL = ((_type: string, quality: number) => {
      // The encoder sets width/height from the scale it chose, so the long
      // edge it landed on IS the maxDim of this pass.
      const maxDim = Math.max(el.width, el.height);
      const a = { maxDim, quality };
      attempts.push(a);
      return "data:image/jpeg;base64," + "x".repeat(sizeFor(a));
    }) as unknown as HTMLCanvasElement["toDataURL"];
    return el;
  }) as typeof document.createElement);

  return attempts;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const file = () => new File([], "shot.jpg", { type: "image/jpeg" });

describe("encodeImageForVision", () => {
  it("takes the first pass when it already fits, without degrading anything", async () => {
    const attempts = stubCanvas(() => 10);
    const out = await encodeImageForVision(file());
    expect(out.mediaType).toBe("image/jpeg");
    expect(attempts).toEqual([{ maxDim: 1568, quality: 0.85 }]);
  });

  it("tries every DIMENSION at the top quality before dropping quality at all", async () => {
    // Nothing fits at 0.85; the first thing that fits is 1568px at 0.7.
    const attempts = stubCanvas((a) => (a.quality >= 0.85 ? IMAGE_BYTE_BUDGET + 1 : 10));
    await encodeImageForVision(file());
    const dropped = attempts.findIndex((a) => a.quality < 0.85);
    // Every pass before the first quality drop is a smaller dimension, and
    // the smallest dimension is reached before quality moves.
    expect(attempts.slice(0, dropped).every((a) => a.quality === 0.85)).toBe(true);
    expect(attempts.slice(0, dropped).map((a) => a.maxDim)).toEqual([1568, 1200, 900, 650, 480]);
    // The bug this pins: quality used to be the INNER loop, so an over-budget
    // photo reached 0.4 at a full 1568px, blurry and still large, before a
    // single downscale was tried.
    expect(attempts.find((a) => a.quality === 0.4 && a.maxDim === 1568)).toBeUndefined();
  });

  it("returns the smallest encoding rather than throwing when nothing fits", async () => {
    const attempts = stubCanvas(() => IMAGE_BYTE_BUDGET + 1);
    const out = await encodeImageForVision(file());
    expect(out.data.length).toBe(IMAGE_BYTE_BUDGET + 1);
    // Last resort really is the smallest and lowest: 480px at 0.4.
    expect(attempts[attempts.length - 1]).toEqual({ maxDim: 480, quality: 0.4 });
  });
});
