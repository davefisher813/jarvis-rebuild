// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { hideKeyboardAccessoryBar } from "./keyboard";

// 2026-10-05: the native shell hides iOS's accessory pill and the writing bar
// goes compact, but only once the pill is really gone.
describe("hiding the keyboard's accessory bar", () => {
  it("does nothing off iOS, and marks nothing", async () => {
    const root = document.createElement("html");
    const setVisible = vi.fn(async () => {});
    expect(await hideKeyboardAccessoryBar({ isIos: () => false, setVisible, root })).toBe(false);
    expect(setVisible).not.toHaveBeenCalled();
    expect(root.hasAttribute("data-kbar")).toBe(false);
  });

  it("on iOS hides the bar and then, and only then, marks the page compact", async () => {
    const root = document.createElement("html");
    const calls: boolean[] = [];
    expect(await hideKeyboardAccessoryBar({ isIos: () => true, setVisible: async (v) => { calls.push(v); }, root })).toBe(true);
    expect(calls).toEqual([false]);
    expect(root.getAttribute("data-kbar")).toBe("compact");
  });

  it("when the plugin refuses, the full bar stays: nothing is marked", async () => {
    const root = document.createElement("html");
    expect(await hideKeyboardAccessoryBar({ isIos: () => true, setVisible: async () => { throw new Error("not implemented"); }, root })).toBe(false);
    expect(root.hasAttribute("data-kbar")).toBe(false);
  });
});
