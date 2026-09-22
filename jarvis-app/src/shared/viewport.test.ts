// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
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

// A KEYBOARD IMPLIES A FOCUSED FIELD (2026-09-21). These tests used to move
// the visual viewport with nothing focused at all, which is a state iOS never
// produces: the keys come up BECAUSE something took focus. The band now
// trusts that -- with no field focused it reports the layout viewport, so a
// stale keyboard-up measurement cannot outlive the keyboard (see viewport.ts).
// So the tests that mean "the keyboard is up" now say so.
const focusAField = () => {
  const input = document.createElement("input");
  input.id = "kb";
  document.body.appendChild(input);
  input.focus();
  return input;
};

// jsdom's own innerHeight is 768, so a fixture that says the visual viewport
// is 844 tall with no keyboard was describing a device that cannot exist. It
// never mattered while the band read vv.height alone; it matters now that an
// unfocused band reports the LAYOUT viewport, so the two agree here and the
// tests that want them to differ say so themselves.
beforeEach(() => {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
});

// innerHeight is redefined by the tests that measure --vv-bot, and the
// unfocused band reads it, so it is put back or one test's 768 becomes the
// next one's answer.
afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.body.innerHTML = "";
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
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
    focusAField();
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
    focusAField();
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
    focusAField();
    const k = fakeViewport(508, 310);
    install(k.vv);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
    const stop = trackVisualViewport();
    expect(document.documentElement.style.getPropertyValue("--vv-bot")).toBe("0px");
    stop();
  });
});

// Dave, 2026-09-21, on a live Push Day: "The log another set and next
// exercise buttons are in the middle of the screen." They were. The Log bar
// sits at the foot of the VISIBLE band, and the band was still the one iOS
// reported while the keyboard was up -- minutes after it had gone, because
// there is no event for "the keyboard you measured is gone now".
describe("a band cannot outlive the keyboard that made it", () => {
  it("reports the whole viewport when nothing is focused, whatever the viewport remembers", () => {
    const k = fakeViewport(508, 310);   // the stale keyboard-up measurement
    install(k.vv);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    const stop = trackVisualViewport();
    expect(read(), "nothing is focused, so there is no keyboard").toEqual({ h: "844px", top: "0px" });
    expect(document.documentElement.style.getPropertyValue("--vv-bot")).toBe("0px");
    stop();
  });

  it("goes back to the whole viewport the moment the field is blurred", () => {
    const input = focusAField();
    const k = fakeViewport(508, 0);
    install(k.vv);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    const stop = trackVisualViewport();
    expect(read().h, "focused: the keys really are up").toBe("508px");
    input.blur();
    return new Promise<void>((done) => {
      setTimeout(() => {
        expect(read().h, "blurred: the bar comes back to the floor").toBe("844px");
        stop();
        done();
      }, 60);
    });
  });

  it("watches the moments the visual viewport does not speak for", () => {
    const k = fakeViewport(844, 0);
    install(k.vv);
    const seen: string[] = [];
    const realDoc = document.addEventListener.bind(document);
    const realWin = window.addEventListener.bind(window);
    document.addEventListener = ((t: string, ...rest: unknown[]) => { seen.push("doc:" + t); return realDoc(t, ...(rest as [EventListener])); }) as typeof document.addEventListener;
    window.addEventListener = ((t: string, ...rest: unknown[]) => { seen.push("win:" + t); return realWin(t, ...(rest as [EventListener])); }) as typeof window.addEventListener;
    const stop = trackVisualViewport();
    document.addEventListener = realDoc as typeof document.addEventListener;
    window.addEventListener = realWin as typeof window.addEventListener;
    // The blur that dismisses the keys, and the resumes that fire no resize
    // at all -- the same shape of gap main.tsx documents for the build check.
    expect(seen).toContain("doc:focusout");
    expect(seen).toContain("doc:visibilitychange");
    expect(seen).toContain("win:pageshow");
    stop();
  });
});
