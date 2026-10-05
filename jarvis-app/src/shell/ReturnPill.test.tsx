// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NavOriginProvider, type NavOrigin } from "./navOrigin";
import ReturnPill from "./ReturnPill";

// THE PILL NEVER COVERS A ROW (Dave 2026-10-05, decision D6: floating chrome never covers content). It used to be
// position: fixed over the foot of the scroll box ("ean Out", the foot of the Health goal card, "SUN 11" lost under
// "< Today"). It is a row of the shell's own column between the scroll box and the capture bar now, so the scroll box is
// shorter by the pill's height while a jump is live and nothing is ever under it.

const LIFE: NavOrigin = { key: "life", label: "Life" };
const css = () => readFileSync(join(process.cwd(), "src/styles/components.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (sel: string) => css().match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}"))![1]!;

function mount(origin: NavOrigin | null, claimed = false) {
  return render(
    <NavOriginProvider value={{ origin, back: () => true, claim: () => () => {}, claimed, clear: () => {} }}>
      <ReturnPill />
    </NavOriginProvider>,
  );
}

afterEach(() => cleanup());

describe("the return pill takes its own room", () => {
  it("is drawn while a jump is live, labelled with where it returns to", () => {
    mount(LIFE);
    const pill = document.querySelector(".return-pill")!;
    expect(pill).not.toBeNull();
    expect(pill.textContent).toBe("Life");
  });

  it("is a row in the shell's column: relative, never fixed, so nothing can sit under it", () => {
    const r = rule(".return-pill");
    expect(r).toMatch(/position:\s*relative/);
    expect(r).not.toMatch(/position:\s*fixed/);
    expect(r, "and 44px to the finger").toMatch(/min-height:\s*44px/);
  });

  it("publishes nothing and the scroll box carries no clearance for it (the clearance machinery is gone)", () => {
    mount(LIFE);
    expect(document.documentElement.style.getPropertyValue("--return-pad")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--return-clear")).toBe("");
    expect(css().match(/\.app-scroll\s*\{([^}]*)\}/)![1]).not.toMatch(/return-pad/);
  });

  it("a page that claims the origin has no pill, and no origin has none", () => {
    mount(LIFE, true);
    expect(document.querySelector(".return-pill")).toBeNull();
    cleanup();
    mount(null);
    expect(document.querySelector(".return-pill")).toBeNull();
  });
});
