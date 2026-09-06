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
    stop();
  });
});
