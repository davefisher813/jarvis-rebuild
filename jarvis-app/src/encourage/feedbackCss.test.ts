import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE FEEDBACK STYLE STYLESHEET BLOCK AGAINST THE CATALOG (Dave 2026-10-05, "I
// am sick of this"). The block between FEEDBACK STYLE (v1) and END FEEDBACK
// STYLE is read as written, comments out, and held to what the catalog says a
// custom class may and may not do.

const css = readFileSync(join(__dirname, "..", "styles", "components.css"), "utf8");
const start = css.indexOf("/* === FEEDBACK STYLE (v1)");
const end = css.indexOf("/* === END FEEDBACK STYLE === */");
const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ sel: m[1]!.trim().replace(/\s+/g, " "), body: m[2]! }))
  .filter((r) => !r.sel.startsWith("@") && !/^\d|^from|^to/.test(r.sel));

describe("the Feedback Style stylesheet block", () => {
  it("is found, and has rules to judge", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(rules.filter((r) => r.sel.startsWith(".fb-")).length).toBeGreaterThan(5);
  });

  it("R3: no raw hex or rgb colour in any rule", () => {
    for (const r of rules) expect(r.body, r.sel).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });

  it("R1: no .fb-* or .start-* class sets a grey ink, so none is a second grey beside a fact", () => {
    for (const r of rules) {
      if (!/\.(fb|start)-/.test(r.sel)) continue;
      expect(r.body, r.sel).not.toMatch(/(^|;)\s*color:\s*var\(--(tx-2|tx-3|tx-quiet)\)/);
    }
  });

  it("R7: a size is a token, never a raw number, and never a subtext size beside a facts line", () => {
    for (const r of rules) {
      const size = /font-size:\s*([^;]+)/.exec(r.body)?.[1]?.trim();
      if (!size) continue;
      expect(size, r.sel).toMatch(/^var\(--t-[a-z0-9]+\)$/);
    }
  });

  it("weights come from the token ladder, never a raw number", () => {
    for (const r of rules) {
      const w = /font-weight:\s*([^;]+)/.exec(r.body)?.[1]?.trim();
      if (w) expect(w, r.sel).toMatch(/^var\(--w-[a-z]+\)$/);
    }
  });

  it("the ways out wrap, so no action sits past the screen edge", () => {
    const row = rules.find((r) => r.sel === ".fb-support");
    expect(row?.body, "a one-line flex row of five actions ran to 713px at 390px").toMatch(/flex-wrap:\s*wrap/);
  });

  it("the count draws no size, weight or ink of its own: the facts primitives do", () => {
    const count = rules.find((r) => r.sel === ".fb-count")!;
    expect(count.body).not.toMatch(/font-size|font-weight|color/);
  });

  it("the class the header used for its second grey is gone", () => {
    expect(block).not.toMatch(/\.start-last\b/);
  });
});
