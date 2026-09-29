// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { usePickFile } from "./usePickFile";

// CLICK-THROUGH AUDIT 2026-09-29: the shared file input was display:none, which
// some iOS and WebView builds will not raise a file sheet for, so a button that
// opens it reads as dead. It is off screen with a 1px box instead.
describe("the hidden file input", () => {
  it("is not display:none, and is out of the tab order and the accessibility tree", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/components.css"), "utf8");
    const rule = css.match(/\.visually-hidden-input\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).not.toBe("");
    expect(rule).not.toMatch(/display\s*:\s*none/);
    expect(rule).toMatch(/position\s*:\s*absolute/);
    function Host() { const p = usePickFile(() => {}); return <>{p.input}</>; }
    const { container } = render(<Host />);
    const input = container.querySelector("input")!;
    expect(input.type).toBe("file");
    expect(input.tabIndex).toBe(-1);
    expect(input.getAttribute("aria-hidden")).toBe("true");
  });
});
