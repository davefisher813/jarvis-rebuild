// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import type { KeyboardEvent } from "react";
import { pressable, onPressKey } from "./pressable";

// The three props a div that takes a tap owes a keyboard, a switch control and
// a screen reader. 60 rows across the app had two of the three (2026-09-05
// browser walk): role and tabIndex copied from the first ruled row, no key
// handler. VoiceOver never noticed, because it dispatches a real click.

const key = (k: string) => {
  const preventDefault = vi.fn();
  return { e: { key: k, preventDefault } as unknown as KeyboardEvent, preventDefault };
};

describe("pressable", () => {
  it("declares the row a button and puts it in the tab order", () => {
    const p = pressable(() => {});
    expect(p.role).toBe("button");
    expect(p.tabIndex).toBe(0);
  });

  it("fires on Enter and on Space, and swallows Space's page scroll", () => {
    for (const k of ["Enter", " "]) {
      const hit = vi.fn();
      const { e, preventDefault } = key(k);
      pressable(hit).onKeyDown(e);
      expect(hit, `${k} activates the row`).toHaveBeenCalledTimes(1);
      expect(preventDefault, `${k} does not also scroll the page`).toHaveBeenCalled();
    }
  });

  it("ignores every other key, so typing in a row does not fire it", () => {
    for (const k of ["a", "Tab", "Escape", "ArrowDown", "Shift"]) {
      const hit = vi.fn();
      pressable(hit).onKeyDown(key(k).e);
      expect(hit, `${k} must not activate the row`).not.toHaveBeenCalled();
    }
  });

  it("a disabled cell keeps its role, leaves the tab order, and does nothing", () => {
    const hit = vi.fn();
    const p = pressable(hit, { disabled: true });
    expect(p.tabIndex).toBe(-1);
    p.onClick();
    p.onKeyDown(key("Enter").e);
    expect(hit).not.toHaveBeenCalled();
  });

  it("onPressKey is the same keys for an element that owns its own role", () => {
    const hit = vi.fn();
    const h = onPressKey(hit);
    h(key("Enter").e);
    h(key(" ").e);
    h(key("x").e);
    expect(hit).toHaveBeenCalledTimes(2);
  });
});
