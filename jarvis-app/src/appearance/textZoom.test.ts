// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { clampScale, MIN_TYPE_SCALE, MAX_TYPE_SCALE } from "./textZoom";
import { TEXT_SCALE } from "./AppearanceProvider";

// UP-PLAT-09 (2026-09-06): "Text size follows the phone." The whole type ramp
// was fixed pixels, so a parent over 45 with Larger Text on, or anyone who
// simply wants bigger text, met a 15px app.

describe("the scale is bounded", () => {
  it("never goes below the shipped size", () => {
    expect(clampScale(0.5)).toBe(MIN_TYPE_SCALE);
    expect(clampScale(-3)).toBe(MIN_TYPE_SCALE);
  });

  it("stops at the size the layout was checked to", () => {
    // Past 1.4 the tab bar loses its labels, which is a worse answer than
    // "as big as this app goes".
    expect(clampScale(3)).toBe(MAX_TYPE_SCALE);
    expect(MAX_TYPE_SCALE).toBe(1.4);
  });

  it("anything that is not a real number is the shipped size, never NaN", () => {
    // Not the maximum: an unreadable answer is not a request for the biggest
    // text in the app, it is no answer at all.
    expect(clampScale(NaN)).toBe(MIN_TYPE_SCALE);
    expect(clampScale(Infinity)).toBe(MIN_TYPE_SCALE);
  });

  it("every offered step is inside the bounds, and Default really is 1", () => {
    expect(TEXT_SCALE.default).toBe(1);
    for (const v of Object.values(TEXT_SCALE)) {
      expect(clampScale(v)).toBe(v);
    }
  });
});

// 2026-10-05: the plugin is installed, so the system half answers on the phone.
import { vi } from "vitest";
import { readSystemTextScale } from "./textZoom";

describe("the phone's own text size", () => {
  it("is null on the web: a browser has its own zoom", async () => {
    expect(await readSystemTextScale({ getPreferred: async () => ({ value: 1.3 }) })).toBeNull();
  });

  describe("on the phone", () => {
    it("reads the plugin's answer", async () => {
      vi.resetModules();
      vi.doMock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true }, registerPlugin: () => ({}) }));
      const m = await import("./textZoom");
      expect(await m.readSystemTextScale({ getPreferred: async () => ({ value: 1.3 }) })).toBe(1.3);
      vi.doUnmock("@capacitor/core");
    });

    it("an answer that is not a real size is no answer, and a failure is not a crash", async () => {
      vi.resetModules();
      vi.doMock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true }, registerPlugin: () => ({}) }));
      const m = await import("./textZoom");
      expect(await m.readSystemTextScale({ getPreferred: async () => ({ value: NaN }) })).toBeNull();
      expect(await m.readSystemTextScale({ getPreferred: async () => ({ value: 0 }) })).toBeNull();
      expect(await m.readSystemTextScale({ getPreferred: async () => { throw new Error("no plugin"); } })).toBeNull();
      vi.doUnmock("@capacitor/core");
    });
  });
});
