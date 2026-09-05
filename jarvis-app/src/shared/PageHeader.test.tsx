// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, act } from "@testing-library/react";
import PageHeader from "./PageHeader";

// SHARED-F-01 (2026-09-05). The page bar earns its glass from a `scrolled`
// signal that read window.scrollY and listened on window. The app scrolls
// .app-scroll, a fixed-height box inside .app-shell, so window.scrollY is 0
// forever and a scroll event on an element does not bubble to window: the
// signal has never been true inside the app, and the large title slid up under
// the iOS clock with the bar still fully transparent.
//
// jsdom has no layout, so scrollTop has to be planted the way useChipInView's
// test plants offsetWidth. What this holds is the WIRING, which is the whole
// bug: which box is listened to, and which box is read.

function Shell() {
  return (
    <div className="app-shell">
      <div className="app-scroll" style={{ overflowY: "auto" }}>
        <PageHeader title="Today" />
      </div>
    </div>
  );
}

const plant = (el: Element, top: number) =>
  Object.defineProperty(el, "scrollTop", { value: top, configurable: true });

describe("SHARED-F-01: the page bar glass follows the box that actually scrolls", () => {
  it("turns the glass on when .app-scroll moves, not when window does", () => {
    const { container } = render(<Shell />);
    const bar = container.querySelector(".pagebar")!;
    const scroller = container.querySelector(".app-scroll")!;
    expect(bar.className, "transparent at rest").not.toMatch(/\bsolid\b/);

    plant(scroller, 120);
    act(() => { scroller.dispatchEvent(new Event("scroll")); });
    expect(bar.className, "glass the moment the page moves").toMatch(/\bsolid\b/);
  });

  it("turns it back off when the page returns to the top", () => {
    const { container } = render(<Shell />);
    const bar = container.querySelector(".pagebar")!;
    const scroller = container.querySelector(".app-scroll")!;
    plant(scroller, 120);
    act(() => { scroller.dispatchEvent(new Event("scroll")); });
    expect(bar.className).toMatch(/\bsolid\b/);
    plant(scroller, 0);
    act(() => { scroller.dispatchEvent(new Event("scroll")); });
    expect(bar.className).not.toMatch(/\bsolid\b/);
  });

  // The bug, stated as a test: a window scroll event carries no information
  // about a box that scrolls itself, and this is what used to be listened for.
  it("a scroll on window alone does not turn the glass on", () => {
    const { container } = render(<Shell />);
    const bar = container.querySelector(".pagebar")!;
    plant(container.querySelector(".app-scroll")!, 0);
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(bar.className).not.toMatch(/\bsolid\b/);
  });

  // The fallback has to survive: a page whose document really is the scroller
  // (the preview harness, a test) still gets its glass.
  it("falls back to window when nothing above the probe scrolls", () => {
    const { container } = render(<PageHeader title="Today" />);
    const bar = container.querySelector(".pagebar")!;
    const spy = Object.getOwnPropertyDescriptor(window, "scrollY");
    Object.defineProperty(window, "scrollY", { value: 200, configurable: true });
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(bar.className).toMatch(/\bsolid\b/);
    if (spy) Object.defineProperty(window, "scrollY", spy);
  });
});
