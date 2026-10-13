// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Templates from "./Templates";
import type { TemplateKey } from "../types";

// THE NEW NOTE PICKER ANSWERS AT ONCE (issue 106, V3; Dave 2026-10-13:
// "Pressed state plus a spinner the moment a template is tapped, while the
// editor loads. No more silent multi-second dead feel (which also causes
// duplicate notes from repeat taps)").
//
// The picker is told which template is being made (`pending`). That row is
// the pressed one and carries the ring where its chevron was; every row
// stands down, because a second tap would make a second note. The back link
// is never locked: a person who changed their mind is not trapped.
const KEYS: TemplateKey[] = ["blank", "meeting", "todo", "tracker", "brief", "journal"];
const rowsOf = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".lib-row")];

describe("the New Note picker with nothing pending", () => {
  it("every row takes its tap and its key, shows its chevron, and carries no busy or disabled state", () => {
    const onSelect = vi.fn();
    const { container } = render(<Templates onSelect={onSelect} />);
    const rows = rowsOf(container);
    expect(rows).toHaveLength(6);
    rows.forEach((r) => fireEvent.click(r));
    expect(onSelect.mock.calls.map((c) => c[0])).toEqual(KEYS);
    onSelect.mockClear();
    fireEvent.keyDown(rows[1]!, { key: "Enter" });
    fireEvent.keyDown(rows[2]!, { key: " " });
    expect(onSelect.mock.calls.map((c) => c[0])).toEqual(["meeting", "todo"]);
    expect(container.querySelectorAll(".chev")).toHaveLength(6);
    expect(container.querySelector(".spinner")).toBeNull();
    expect(container.querySelector("[aria-busy], [aria-disabled]")).toBeNull();
    rows.forEach((r) => expect(r).toHaveAttribute("tabindex", "0"));
  });
});

describe("the New Note picker with a template pending", () => {
  it("the pending row is busy and holds the ring where its chevron was; the other five are unavailable and keep their chevrons", () => {
    const { container } = render(<Templates pending="meeting" onSelect={vi.fn()} />);
    const rows = rowsOf(container);
    const busy = rows[1]!;
    expect(busy).toHaveTextContent("Meeting Notes");
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).not.toHaveAttribute("aria-disabled");
    // The ring is the app's own spinner, named for a screen reader, in the chevron's place.
    const ring = within(busy).getByRole("status", { name: "Opening" });
    expect(ring).toHaveClass("spinner");
    expect(busy.querySelector(".chev")).toBeNull();
    expect(container.querySelectorAll(".spinner")).toHaveLength(1);
    const others = rows.filter((r) => r !== busy);
    expect(others).toHaveLength(5);
    for (const o of others) {
      expect(o).toHaveAttribute("aria-disabled", "true");
      expect(o).not.toHaveAttribute("aria-busy");
      expect(o.querySelector(".chev")).not.toBeNull();
      expect(o.querySelector(".spinner")).toBeNull();
    }
  });

  it("no row answers a tap or a key while one is pending, the busy one included", () => {
    const onSelect = vi.fn();
    const { container } = render(<Templates pending="brief" onSelect={onSelect} />);
    for (const r of rowsOf(container)) {
      fireEvent.click(r);
      fireEvent.keyDown(r, { key: "Enter" });
      fireEvent.keyDown(r, { key: " " });
      // Out of the tab order too: a keyboard cannot reach a row that will not answer.
      expect(r).toHaveAttribute("tabindex", "-1");
    }
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("the back link stays live, so nobody is trapped on a slow create", () => {
    const onBack = vi.fn();
    render(<Templates pending="todo" onSelect={vi.fn()} onBack={onBack} />);
    fireEvent.click(screen.getByText("Notes", { selector: ".nav-back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("every row keeps its name and its line while pending (the state adds, it never rewrites)", () => {
    const { container } = render(<Templates pending="journal" />);
    expect(container.querySelectorAll(".lib-name")).toHaveLength(6);
    expect(container.querySelectorAll(".lib-sub")).toHaveLength(6);
    expect(container.querySelector(".lib-name")).toHaveTextContent("Blank");
    expect(rowsOf(container)[5]).toHaveTextContent("Log / Journal");
  });

  it("settling back to nothing pending restores every row (the lock is a prop, not a latch)", () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(<Templates pending="tracker" onSelect={onSelect} />);
    rerender(<Templates pending={null} onSelect={onSelect} />);
    expect(container.querySelector("[aria-busy], [aria-disabled]")).toBeNull();
    expect(container.querySelectorAll(".chev")).toHaveLength(6);
    fireEvent.click(rowsOf(container)[3]!);
    expect(onSelect).toHaveBeenCalledWith("tracker");
  });
});

// WHAT THE ROW LOOKS LIKE IS THE WHOLE POINT. jsdom draws nothing, so the
// look is pinned in the stylesheet: the busy row holds the press tint, the
// others dim the way every unavailable row does, and the ring wears neutral
// ink on its track. Press tokens only; no new surface colour (Dave, #102).
describe("the busy state is drawn, in press tokens, in both themes", () => {
  const CSS = readFileSync(join(__dirname, "..", "..", "styles", "components.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const ruleBody = (selector: string) => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(?:^|[}\\s])" + esc + "\\s*\\{([^}]*)\\}").exec(CSS)?.[1] ?? "";
  };
  // A class or an attribute is one part of a selector's weight; these selectors use no other kind.
  const weight = (sel: string) => (sel.match(/\.[a-z][\w-]*|\[[^\]]+\]/g) ?? []).length;
  const BUSY = '.lib-row[role="button"][aria-busy="true"]';
  const OFF = '.lib-row[role="button"][aria-disabled="true"]';

  it("the busy row holds the press tint, and nothing else about its surface", () => {
    const body = ruleBody(BUSY);
    expect(body, "the busy row has a rule").not.toBe("");
    expect(body).toMatch(/background-color:\s*var\(--press-3\)/);
    expect(body, "a tint and nothing more: no colour literal, no brand red, no size, no weight").not.toMatch(/#[0-9a-f]{3}|rgb|--tint|--accent|font|padding|margin|width|height/i);
  });

  it("the busy fill outranks the light theme's white row fill, so it shows in light as it does in dark", () => {
    // components.css: [data-theme="light"] .lib-row { background: var(--surface-1) }, two parts.
    // A busy rule of two parts ties with it and loses on order, and the pressed row then shows
    // in dark and not in light.
    expect(weight(BUSY)).toBeGreaterThan(weight('[data-theme="light"] .lib-row'));
  });

  it("the other rows stand down the way every unavailable row does, and the ring wears neutral ink", () => {
    expect(ruleBody(OFF)).toMatch(/opacity:\s*0\.5/);
    const ring = ruleBody(".lib-row .spinner");
    expect(ring, "the ring has a rule inside the row").not.toBe("");
    expect(ring).toMatch(/border-top-color:\s*var\(--tx-2\)/);
    expect(ring, "brand red is for what can be tapped; the ring is not").not.toMatch(/--tint|--accent|#[0-9a-f]{3}|rgb/i);
  });

  it("the ring takes the chevron's footprint, so a long line does not re-wrap when the tap lands", () => {
    const ring = ruleBody(".lib-row .spinner");
    const px = (prop: string) => Number(new RegExp("(?:^|[;\\s])" + prop + ":\\s*(-?[\\d.]+)px").exec(ring)?.[1]);
    const margin = /margin:\s*0\s+(-?[\d.]+)px/.exec(ring);
    expect(margin, "a side margin that pays the ring back").not.toBeNull();
    const sides = Number(margin![1]) * 2;
    // The chevron is a 7px box (jarvis-design-system.css .chev); width less the pulled-back margins is the slot the ring really takes.
    expect(px("width") + sides).toBeCloseTo(7, 5);
    expect(px("height")).toBeLessThanOrEqual(24);
  });
});
