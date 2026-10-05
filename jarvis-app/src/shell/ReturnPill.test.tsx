// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NavOriginProvider, type NavOrigin } from "./navOrigin";
import ReturnPill from "./ReturnPill";

// CLEARANCE AT THE FOOT OF THE SCROLL BOX (Alfred 2026-10-04: "< Life" over the last rows of the Health page and
// the gym screens). The pill floats inside the scroll box's bottom edge, so the last row scrolled to the end sat
// under it. While the pill is drawn the shell publishes --return-pad, the room the pill takes, and .app-scroll pads
// its foot by it. jsdom has no layout, so the rects are given.

const LIFE: NavOrigin = { key: "life", label: "Life" };
const root = document.documentElement;

function rect(bottom: number, top: number): DOMRect {
  return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON() {} } as DOMRect;
}

function mount(origin: NavOrigin | null, claimed = false) {
  const scroll = document.createElement("div");
  scroll.className = "app-scroll";
  scroll.getBoundingClientRect = () => rect(689, 0);
  document.body.appendChild(scroll);
  const real = HTMLElement.prototype.getBoundingClientRect;
  // The pill sits 8px above the scroll box's foot and is 44 tall: top 637 in a 689 box.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.classList.contains("return-pill") ? rect(681, 637) : real.call(this);
  };
  const view = render(
    <NavOriginProvider value={{ origin, back: () => true, claim: () => () => {}, claimed, clear: () => {} }}>
      <ReturnPill />
    </NavOriginProvider>,
  );
  return { view, scroll, restore: () => { HTMLElement.prototype.getBoundingClientRect = real; scroll.remove(); } };
}

afterEach(() => { cleanup(); root.style.removeProperty("--return-pad"); root.style.removeProperty("--return-clear"); });

describe("the return pill leaves the foot of the scroll box clear", () => {
  it("publishes the room it takes (its height, the gap under it and a gap above it) while it is drawn", () => {
    const m = mount(LIFE);
    // 689 - 637 + 8: the last row ends 8px above the pill's top edge.
    expect(root.style.getPropertyValue("--return-pad")).toBe("60px");
    m.restore();
  });

  it("publishes nothing, and takes it back, when no pill is drawn", () => {
    const m = mount(LIFE);
    m.view.unmount();
    expect(root.style.getPropertyValue("--return-pad")).toBe("");
    const n = mount(null);
    expect(root.style.getPropertyValue("--return-pad")).toBe("");
    n.restore(); m.restore();
  });

  it("a page that claims the origin has no pill and so no padding", () => {
    const m = mount(LIFE, true);
    expect(document.querySelector(".return-pill")).toBeNull();
    expect(root.style.getPropertyValue("--return-pad")).toBe("");
    m.restore();
  });

  it("the scroll box actually reads the property (a published value nothing reads is not clearance)", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/components.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = css.match(/\.app-scroll\s*\{([^}]*)\}/)![1]!;
    expect(rule).toMatch(/padding-bottom:\s*var\(--return-pad,\s*0px\)/);
  });
});
