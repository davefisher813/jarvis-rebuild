import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE FIRST STEP CARD SAYS WHAT IT IS (Dave 2026-08-31: "the big task up top
// actually doesn't render as such. The user has no idea what it is and why
// it's like that."). Source-pinned because the flow needs a provider stack to
// mount; the rendered look is verified by the screen renders. What must stay
// true: both states open with an eyebrow naming the card, the payload wears
// the wrapping .fs-title (never .conn-name, the nowrap ROW class that
// ellipsized his task into a mystery), and the quoted-sentence form is gone.
describe("First Step card anatomy", () => {
  const src = readFileSync(join(__dirname, "TasksFlow.tsx"), "utf8");
  const banner = src.slice(src.indexOf("const fsBanner"), src.indexOf(") : null;", src.indexOf("const fsBanner")));

  it("both states open with a kicker, payloads wrap as fs-title", () => {
    expect(banner).toContain(">First Step</div>");
    expect(banner).toContain(">Keeps Sliding</div>");
    expect(banner.match(/className="eyebrow"/g)?.length).toBe(2);
    expect(banner).toContain('<div className="fs-title">{fsStep.step}</div>');
    expect(banner).toContain('<div className="fs-title">{fsCandidate.data.text}</div>');
    expect(banner).toContain("For: {fsCandidate.data.text}");
  });

  it("the row classes and the quoted sentence stay gone", () => {
    expect(banner).not.toContain("conn-name");
    expect(banner).not.toContain("conn-meta");
    expect(banner).not.toContain("ldquo");
    expect(banner).not.toContain("keeps sliding.");
  });

  it("the styles it names exist, and the title actually wraps", () => {
    const css = readFileSync(join(__dirname, "..", "styles", "components.css"), "utf8");
    const title = css.match(/\.fs-title\s*\{[^}]*\}/)?.[0] ?? "";
    expect(title).toContain("overflow-wrap: anywhere");
    expect(title).not.toContain("nowrap");
    expect(css).toMatch(/\.fs-for\s*\{/);
    expect(css).toMatch(/\.fs-card \.eyebrow\s*\{/);
  });
});
