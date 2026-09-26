import { describe, it, expect } from "vitest";
import { centerSquare, AVATAR_PX, AVATAR_QUALITY } from "./avatarPhoto";

// The crop a round avatar shows (Dave's pick, 2026-09-26). jsdom has no
// canvas to draw with, so the pure half is what is tested: the square is the
// largest one that fits, and it is centred, so a face in the middle of a
// portrait stays in the middle of the disc.
describe("centerSquare", () => {
  it("cuts a portrait's top and bottom equally", () => {
    expect(centerSquare(3000, 4000)).toEqual({ sx: 0, sy: 500, side: 3000 });
  });
  it("cuts a landscape's sides equally", () => {
    expect(centerSquare(4032, 3024)).toEqual({ sx: 504, sy: 0, side: 3024 });
  });
  it("leaves a square alone", () => {
    expect(centerSquare(256, 256)).toEqual({ sx: 0, sy: 0, side: 256 });
  });
  it("rounds an odd margin to a whole pixel", () => {
    expect(centerSquare(101, 100)).toEqual({ sx: 1, sy: 0, side: 100 });
  });
  it("gives an empty square for an empty image, never a negative one", () => {
    expect(centerSquare(0, 400)).toEqual({ sx: 0, sy: 200, side: 0 });
  });
  it("draws at 256px, JPEG at 0.85", () => {
    expect(AVATAR_PX).toBe(256);
    expect(AVATAR_QUALITY).toBe(0.85);
  });
});
