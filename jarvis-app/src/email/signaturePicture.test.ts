// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { fitBox, fitPicture, PictureUnreadable, type Decoded, type Drawable, type PictureIO, type PictureMime, type Surface } from "./signaturePicture";
import { SIGNATURE_PICTURE_BOX, SIGNATURE_PICTURE_MAX_BYTES } from "./signature";

describe("fitBox", () => {
  it("fits the whole picture inside the box, keeping its shape", () => {
    expect(fitBox(4032, 3024, 192)).toEqual({ width: 192, height: 144 });
    expect(fitBox(3024, 4032, 192)).toEqual({ width: 144, height: 192 });
    expect(fitBox(1000, 1000, 192)).toEqual({ width: 192, height: 192 });
  });
  it("never makes a picture bigger than it is", () => {
    expect(fitBox(100, 50, 192)).toEqual({ width: 100, height: 50 });
    expect(fitBox(192, 192, 192)).toEqual({ width: 192, height: 192 });
  });
  it("keeps a very wide or very tall logo at least one pixel thick", () => {
    expect(fitBox(3000, 100, 192)).toEqual({ width: 192, height: 6 });
    expect(fitBox(100000, 10, 192)).toEqual({ width: 192, height: 1 });
  });
  it("treats a picture with no size of its own (an SVG) as the box", () => {
    expect(fitBox(0, 0, 192)).toEqual({ width: 192, height: 192 });
  });
});

interface Spy {
  surfaces: FakeSurface[];
  released: number;
}
class FakeSurface implements Surface {
  readonly drawable: Drawable = {};
  drawn: Drawable[] = [];
  flattened = false;
  encodes: Array<[PictureMime, number]> = [];
  constructor(readonly width: number, readonly height: number, private o: Opts) {}
  drawFill(from: Drawable) { this.drawn.push(from); }
  hasTransparency() { return !!this.o.alpha && !this.flattened; }
  flattenOnWhite() { this.flattened = true; }
  async encode(mime: PictureMime, quality: number) {
    this.encodes.push([mime, quality]);
    if (mime === "image/jpeg" && this.o.jpegFails) return null;
    return new Blob([new Uint8Array(this.o.size(mime, this.width, this.flattened))], { type: mime });
  }
}
interface Opts {
  w: number;
  h: number;
  alpha?: boolean;
  jpegFails?: boolean;
  decodeFails?: boolean;
  /** The encoded file's size for a type at a width, so a test can say "this one is too heavy". */
  size: (mime: PictureMime, width: number, flattened: boolean) => number;
}
function fakeIO(o: Opts): { io: PictureIO; spy: Spy; source: Drawable } {
  const spy: Spy = { surfaces: [], released: 0 };
  const source: Drawable = { the: "decoded picture" };
  const io: PictureIO = {
    async decode(): Promise<Decoded> {
      if (o.decodeFails) throw new PictureUnreadable();
      return { width: o.w, height: o.h, drawable: source, release: () => { spy.released += 1; } };
    },
    surface(width, height) { const s = new FakeSurface(width, height, o); spy.surfaces.push(s); return s; },
  };
  return { io, spy, source };
}
const file = (type: string, name = "pick") => new File([new Uint8Array([1, 2, 3])], name, { type });
const light = () => 8000;

describe("fitPicture: the format", () => {
  it("keeps a transparent logo a PNG, and never paints white behind it", async () => {
    const { io, spy } = fakeIO({ w: 800, h: 400, alpha: true, size: light });
    const r = await fitPicture(file("image/png"), io);
    expect(r.mime).toBe("image/png");
    expect(r.file.type).toBe("image/png");
    expect(r.file.name).toBe("signature.png");
    expect(spy.surfaces.every((s) => !s.flattened)).toBe(true);
  });
  it("saves a photograph as a JPEG, flattened onto white first so no corner is black", async () => {
    const { io, spy } = fakeIO({ w: 4032, h: 3024, size: (m) => (m === "image/png" ? 400000 : 12000) });
    const r = await fitPicture(file("image/jpeg"), io);
    expect(r.mime).toBe("image/jpeg");
    expect(r.file.name).toBe("signature.jpg");
    const last = spy.surfaces[spy.surfaces.length - 1]!;
    expect(last.flattened).toBe(true);
    expect(last.encodes.at(-1)).toEqual(["image/jpeg", 0.88]);
  });
  it("keeps a flat, opaque PNG logo a PNG while it is light, and makes a heavy one a JPEG", async () => {
    const flat = fakeIO({ w: 600, h: 600, size: (m) => (m === "image/png" ? 9000 : 5000) });
    expect((await fitPicture(file("image/png"), flat.io)).mime).toBe("image/png");
    const heavy = fakeIO({ w: 600, h: 600, size: (m) => (m === "image/png" ? 50000 : 14000) });
    expect((await fitPicture(file("image/png"), heavy.io)).mime).toBe("image/jpeg");
  });
});

describe("fitPicture: the size", () => {
  it("fits the whole picture in the box without cropping, and draws the decoded picture into it", async () => {
    const { io, spy, source } = fakeIO({ w: 3000, h: 1000, alpha: true, size: light });
    const r = await fitPicture(file("image/png"), io);
    expect([r.width, r.height]).toEqual([SIGNATURE_PICTURE_BOX, 64]);
    const final = spy.surfaces.at(-1)!;
    expect([final.width, final.height]).toEqual([192, 64]);
    expect(spy.surfaces.some((s) => s.drawn.includes(source))).toBe(true);
  });
  it("steps a big photograph down in halves, not in one jump", async () => {
    const { io, spy } = fakeIO({ w: 4032, h: 3024, size: () => 9000 });
    await fitPicture(file("image/jpeg"), io);
    // 4032 to 192 is more than four halvings: intermediate surfaces, each about half the last, then the final one
    const widths = spy.surfaces.map((s) => s.width);
    expect(widths.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < widths.length - 1; i++) expect(widths[i]).toBeLessThan(widths[i - 1]!);
    expect(widths.at(-1)).toBe(192);
    // each surface draws the one before it, never the original but for the first
    spy.surfaces.slice(1).forEach((s, i) => expect(s.drawn).toEqual([spy.surfaces[i]!.drawable]));
  });
  it("never makes a small picture bigger, and does not halve it", async () => {
    const { io, spy } = fakeIO({ w: 100, h: 50, size: light });
    const r = await fitPicture(file("image/png"), io);
    expect([r.width, r.height]).toEqual([100, 50]);
    expect(spy.surfaces).toHaveLength(1);
  });
  it("draws a picture with no size of its own at the box", async () => {
    const { io } = fakeIO({ w: 0, h: 0, size: light });
    const r = await fitPicture(file("image/svg+xml"), io);
    expect([r.width, r.height]).toEqual([192, 192]);
  });
});

describe("fitPicture: the weight", () => {
  it("steps the size and quality down until the file is light enough, and never refuses for size", async () => {
    const { io } = fakeIO({ w: 2000, h: 2000, size: (_m, width) => (width > 150 ? SIGNATURE_PICTURE_MAX_BYTES + 5000 : 20000) });
    const r = await fitPicture(file("image/jpeg"), io);
    expect(r.width).toBeLessThanOrEqual(150);
    expect(r.file.size).toBeLessThanOrEqual(SIGNATURE_PICTURE_MAX_BYTES);
  });
  it("flattens a heavy transparent picture onto white as a last resort", async () => {
    const { io } = fakeIO({ w: 2000, h: 2000, alpha: true, size: (m, _w, flattened) => (m === "image/png" || !flattened ? 90000 : 30000) });
    const r = await fitPicture(file("image/png"), io);
    expect(r.mime).toBe("image/jpeg");
    expect(r.file.size).toBeLessThanOrEqual(SIGNATURE_PICTURE_MAX_BYTES);
    expect(r.width).toBe(Math.round(SIGNATURE_PICTURE_BOX * 0.5));
  });
});

describe("fitPicture: what it does refuse", () => {
  it("rejects only a file that is not a picture, and says so with its own error", async () => {
    const { io } = fakeIO({ w: 1, h: 1, decodeFails: true, size: light });
    await expect(fitPicture(file("image/png"), io)).rejects.toBeInstanceOf(PictureUnreadable);
  });
  it("rejects when the browser cannot write a JPEG at all", async () => {
    const { io } = fakeIO({ w: 800, h: 800, jpegFails: true, size: light });
    await expect(fitPicture(file("image/jpeg"), io)).rejects.toBeInstanceOf(PictureUnreadable);
  });
  it("lets go of the decoded picture every time, whether it worked or not", async () => {
    const ok = fakeIO({ w: 800, h: 800, size: light });
    await fitPicture(file("image/jpeg"), ok.io);
    expect(ok.spy.released).toBe(1);
    const bad = fakeIO({ w: 800, h: 800, jpegFails: true, size: light });
    await fitPicture(file("image/jpeg"), bad.io).catch(() => undefined);
    expect(bad.spy.released).toBe(1);
  });
});
