// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { trackVisualViewport } from "./viewport";

// The keyboard, as iOS reports it: the visual viewport shrinks and slides down
// the page, and nothing about window.innerHeight or the layout changes.
function fakeViewport(height: number, offsetTop: number) {
  const vv = new EventTarget() as EventTarget & { height: number; offsetTop: number };
  Object.defineProperties(vv, {
    height: { get: () => height, configurable: true },
    offsetTop: { get: () => offsetTop, configurable: true },
  });
  return {
    vv,
    move(h: number, top: number) {
      height = h;
      offsetTop = top;
      vv.dispatchEvent(new Event("resize"));
    },
  };
}

const install = (vv: EventTarget | undefined) =>
  Object.defineProperty(window, "visualViewport", { configurable: true, get: () => vv });

const read = () => ({
  h: document.documentElement.style.getPropertyValue("--vv-h"),
  top: document.documentElement.style.getPropertyValue("--vv-top"),
});

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("the sheet's visible band", () => {
  it("states the band as soon as it starts, before any keyboard", () => {
    const k = fakeViewport(844, 0);
    install(k.vv);
    const stop = trackVisualViewport();
    expect(read()).toEqual({ h: "844px", top: "0px" });
    stop();
  });

  it("follows the keyboard: 508 tall, 310 down the page", () => {
    const k = fakeViewport(844, 0);
    install(k.vv);
    const stop = trackVisualViewport();
    k.move(508, 310);
    // The write is queued to a frame; jsdom's rAF is a timer, so wait one.
    return new Promise<void>((done) => {
      setTimeout(() => {
        expect(read()).toEqual({ h: "508px", top: "310px" });
        stop();
        done();
      }, 40);
    });
  });

  it("stops listening when it is stopped", () => {
    const k = fakeViewport(844, 0);
    install(k.vv);
    trackVisualViewport()();
    k.move(508, 310);
    return new Promise<void>((done) => {
      setTimeout(() => {
        expect(read()).toEqual({ h: "844px", top: "0px" });
        done();
      }, 40);
    });
  });

  // The half that keeps every other browser on the layout it ships with: no
  // visualViewport means no properties, and the CSS falls back to 100dvh / 0.
  it("writes nothing at all where there is no visual viewport", () => {
    install(undefined);
    const stop = trackVisualViewport();
    expect(read()).toEqual({ h: "", top: "" });
    expect(document.documentElement.style.getPropertyValue("--vv-bot")).toBe("");
    stop();
  });

  // --vv-bot: the band read from the other end, which is what a bar anchored
  // to the bottom needs. Dave 2026-09-16: the Log button sat under the keys
  // the moment he typed a weight into a set.
  it("says how much of the layout the keyboard has taken", () => {
    const k = fakeViewport(844, 0);
    install(k.vv);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    const stop = trackVisualViewport();
    expect(document.documentElement.style.getPropertyValue("--vv-bot")).toBe("0px");
    k.move(508, 0);
    return new Promise<void>((done) => {
      setTimeout(() => {
        expect(document.documentElement.style.getPropertyValue("--vv-bot")).toBe("336px");
        stop();
        done();
      }, 40);
    });
  });

  // A band that has been scrolled PAST the layout floor (iOS does this: the
  // 508-tall band sits 310 down an 844 page, 818 of 844 used) must not report
  // a negative inset, which in CSS would push the bar off the bottom.
  it("never reports a negative inset", () => {
    const k = fakeViewport(508, 310);
    install(k.vv);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
    const stop = trackVisualViewport();
    expect(document.documentElement.style.getPropertyValue("--vv-bot")).toBe("0px");
    stop();
  });
});
