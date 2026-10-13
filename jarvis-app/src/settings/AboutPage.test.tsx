// @vitest-environment jsdom
// SHELL-F-26 (2026-09-05): About said "Version 1.0" on every build ever made,
// while Settings > Advanced showed the real build stamp two taps away. The
// row is also the door to the test bench, so it had to keep taking taps.
//
// Issue 106 V5 (Dave, 2026-10-13): "the Build line must not look like a button.
// Render as plain text." Slice 09 QA (2026-10-04) had made the line a full
// control (role="button", a tab stop, Enter and Space, a pointer cursor) so the
// five taps would land, and the live audit then read a plain build stamp as a
// button. It is text again. The hidden door is a click handler and nothing else.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import AboutPage from "./AboutPage";

afterEach(() => { vi.unstubAllGlobals(); });

describe("AboutPage", () => {
  it("names the build it is actually running, not a frozen 1.0", () => {
    render(<AboutPage onBack={() => {}} />);
    expect(screen.queryByText("Version 1.0")).not.toBeInTheDocument();
    expect(screen.getByText(/^Build /)).toBeInTheDocument();
  });

  it("still opens the test bench on the fifth tap", () => {
    const onSecret = vi.fn();
    render(<AboutPage onBack={() => {}} onSecret={onSecret} />);
    const stamp = screen.getByText(/^Build /);
    for (let i = 0; i < 5; i++) fireEvent.click(stamp);
    expect(onSecret).toHaveBeenCalledTimes(1);
  });

  it("does not open the test bench on the fourth tap", () => {
    const onSecret = vi.fn();
    render(<AboutPage onBack={() => {}} onSecret={onSecret} />);
    const stamp = screen.getByText(/^Build /);
    for (let i = 0; i < 4; i++) fireEvent.click(stamp);
    expect(onSecret).not.toHaveBeenCalled();
  });

  // Issue 106 V5: the stamp is text. Nothing in the accessibility tree calls it
  // a button, Tab does not stop on it, and no key presses it.
  describe("the build line is plain text, not a control", () => {
    it("has no role, no tab stop, and is not in the button list", () => {
      const { container } = render(<AboutPage onBack={() => {}} onSecret={() => {}} />);
      const line = container.querySelector<HTMLElement>(".about-build")!;
      expect(line).not.toBeNull();
      expect(line.hasAttribute("role")).toBe(false);
      expect(line.hasAttribute("tabindex")).toBe(false);
      expect(screen.queryByRole("button", { name: /^Build / })).toBeNull();
      // Tab cannot land on it: a plain div refuses focus.
      line.focus();
      expect(document.activeElement).not.toBe(line);
      // Nothing inside it is a control either.
      expect(line.querySelector("button, a, input, [role], [tabindex]")).toBeNull();
    });

    it("keeps the stamp's words exactly: Build, the sha, the date, as two facts", () => {
      vi.stubGlobal("__BUILD_ID__", "b375567");
      vi.stubGlobal("__BUILD_DATE__", "2026-09-29");
      const { container } = render(<AboutPage onBack={() => {}} />);
      const line = container.querySelector(".about-build")!;
      // QA reads this line live, so its text is a contract.
      expect(line.textContent).toBe("Build b375567 2026-09-29");
      const facts = [...line.querySelectorAll(":scope > .fact")];
      expect(facts.map((f) => f.textContent)).toEqual(["Build b375567", "2026-09-29"]);
      expect(facts[1]).toHaveClass("date");
      // The dot between the two facts is the stylesheet's, never a character in the markup.
      expect(line.textContent).not.toContain("·");
    });

    it("is not opened from the keyboard (the accepted loss), and still opens on the fifth click", () => {
      const onSecret = vi.fn();
      const { container } = render(<AboutPage onBack={() => {}} onSecret={onSecret} />);
      const line = container.querySelector(".about-build")!;
      for (let i = 0; i < 5; i++) fireEvent.keyDown(line, { key: "Enter" });
      for (let i = 0; i < 5; i++) fireEvent.keyDown(line, { key: " " });
      for (let i = 0; i < 5; i++) fireEvent.keyUp(line, { key: "Enter" });
      expect(onSecret).not.toHaveBeenCalled();
      for (let i = 0; i < 5; i++) fireEvent.click(line);
      expect(onSecret).toHaveBeenCalledTimes(1);
    });
  });

  // The stylesheet half of "does not look like a button": every rule, in every
  // stylesheet, that names the build line.
  describe("the stylesheet draws no button on the build line", () => {
    const STYLES = join(__dirname, "..", "styles");
    const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = readdirSync(STYLES)
      .filter((f) => f.endsWith(".css"))
      .flatMap((f) =>
        [...strip(readFileSync(join(STYLES, f), "utf8")).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
          .filter((m) => /\.about-build\b/.test(m[1]!))
          .map((m) => ({ where: `${f}: ${m[1]!.trim()}`, body: m[2]! })));

    it("finds the rule (a selector that stopped matching would pass the checks below for the wrong reason)", () => {
      expect(rules.length).toBeGreaterThan(0);
    });

    it("gives it no pointer cursor, fill, border, ring or lift", () => {
      for (const r of rules) {
        expect(r.body, r.where).not.toMatch(/(^|[;\s])(cursor|background[a-z-]*|border[a-z-]*|box-shadow|outline[a-z-]*|transform|scale)\s*:/);
      }
    });

    it("leaves the stamp selectable, so a long press copies it natively", () => {
      const body = rules.map((r) => r.body).join(";");
      expect(body).toMatch(/-webkit-user-select:\s*text/);
      expect(body).toMatch(/(^|[;\s])user-select:\s*text/);
    });
  });
});
