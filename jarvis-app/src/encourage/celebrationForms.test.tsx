// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FeedbackProvider, useFeedback } from "./FeedbackProvider";
import { setLiveFeedback } from "./prefs";
import { CELEBRATION_FORMS, chooseCelebrationForm, currentCelebrationForm, nextCelebrationForm, playCompletion } from "./effects";
import { Burst } from "../shared/Burst";

// COMPLETION CELEBRATIONS THAT VARY (Dave 2026-10-05, the craft playbook).
// The reward is always certain; only its FORM changes, so the same one does
// not play every time. The rotation is fixed (laws/feedback: nothing is
// random), the one that just played never plays twice running, each form is a
// different shape, each is under a second, and every one of them is gone under
// Reduce Motion.

const html = document.documentElement;
beforeEach(() => {
  localStorage.clear();
  setLiveFeedback(null);
  delete html.dataset.cv; delete html.dataset.celebrate; delete html.dataset.motion;
});

describe("which form plays", () => {
  it("there are several, and they take turns without ever repeating back to back", () => {
    expect(CELEBRATION_FORMS).toBeGreaterThanOrEqual(3);
    const seen: number[] = [];
    for (let i = 0; i < CELEBRATION_FORMS * 4; i++) seen.push(nextCelebrationForm());
    for (let i = 1; i < seen.length; i++) expect(seen[i], "the same one twice in a row at step " + i).not.toBe(seen[i - 1]);
    expect(new Set(seen).size, "every form gets its turn").toBe(CELEBRATION_FORMS);
    for (const f of seen) { expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThan(CELEBRATION_FORMS); }
  });

  it("a completion publishes its form on the page for the stylesheet and the Burst to read", () => {
    expect(currentCelebrationForm(), "before any completion the first form is the answer").toBe(0);
    playCompletion();
    const first = Number(html.dataset.cv);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(currentCelebrationForm()).toBe(first);
    playCompletion();
    expect(Number(html.dataset.cv), "the next completion plays a different one").not.toBe(first);
  });

  it("a stale or hostile attribute never selects a form that does not exist", () => {
    html.dataset.cv = "99"; expect(currentCelebrationForm()).toBe(0);
    html.dataset.cv = "-1"; expect(currentCelebrationForm()).toBe(0);
    html.dataset.cv = "two"; expect(currentCelebrationForm()).toBe(0);
    expect(chooseCelebrationForm()).toBeLessThan(CELEBRATION_FORMS);
  });
});

function Probe({ forms }: { forms?: boolean }) {
  const f = useFeedback();
  return (
    <div>
      <button onClick={() => f.apply({ celebration: "expressive" })}>expressive</button>
      {forms ? <Burst show /> : null}
    </div>
  );
}

describe("the Burst wears the form that was chosen", () => {
  // PREMIUM FEEL (Dave 2026-10-09): no confetti. Each form is ONE quiet accent
  // drawn by the stylesheet on an empty span: a ring, a bloom, or a wash.
  const cases: Array<[number, string]> = [[0, "burst-ring"], [1, "burst-bloom"], [2, "burst-wash"]];
  for (const [form, cls] of cases) {
    it(`form ${form} draws ${cls}, one accent and no thrown pieces`, () => {
      html.dataset.cv = String(form);
      const { container } = render(<FeedbackProvider><Probe forms /></FeedbackProvider>);
      fireEvent.click(screen.getByText("expressive"));
      const b = container.querySelector(".burst")!;
      expect(b).not.toBeNull();
      expect(b.classList.contains(cls), cls).toBe(true);
      // exactly one form modifier
      expect([...b.classList].filter((c) => /^burst-(ring|bloom|wash)$/.test(c)).length).toBe(1);
      // the eight confetti dots are gone for good: the span is empty
      expect(b.children.length, "no dots, no diamonds").toBe(0);
      expect(b).toHaveAttribute("aria-hidden", "true");
    });
  }

  it("a big moment reaches further with the same form", () => {
    html.dataset.cv = "0";
    function Big() {
      const f = useFeedback();
      return <div><button onClick={() => f.apply({ celebration: "expressive" })}>expressive</button><Burst show size="big" /></div>;
    }
    const { container } = render(<FeedbackProvider><Big /></FeedbackProvider>);
    fireEvent.click(screen.getByText("expressive"));
    expect(container.querySelector(".burst")).toHaveClass("burst-ring", "burst-big");
  });

  it("under Reduce Motion there is no Burst at all, whatever the form", () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes("reduce"), media: q, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      for (const form of [0, 1, 2]) {
        html.dataset.cv = String(form);
        const { container, unmount } = render(<FeedbackProvider><Probe forms /></FeedbackProvider>);
        fireEvent.click(screen.getByText("expressive"));
        expect(container.querySelector(".burst"), "form " + form).toBeNull();
        unmount();
      }
    } finally { window.matchMedia = real; }
  });
});

// THE STYLESHEET HALF. Read as written, comments out.
const css = readFileSync(join(__dirname, "..", "styles", "components.css"), "utf8");
const start = css.indexOf("/* === CELEBRATION FORMS");
const end = css.indexOf("/* === END CELEBRATION FORMS === */");
const forms = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");

describe("the celebration forms stylesheet block", () => {
  it("is found", () => { expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start); });

  // Every duration in the block, a token resolved through the design system.
  const DS = readFileSync(join(__dirname, "..", "styles", "jarvis-design-system.css"), "utf8");
  const ms = (v: string): number => {
    const tok = /^var\((--[a-z-]+)\)$/.exec(v);
    if (tok) { const m = new RegExp(tok[1]! + ":\\s*([\\d.]+m?s)").exec(DS); return m ? ms(m[1]!) : NaN; }
    const m = /^([\d.]+)(m?s)$/.exec(v);
    return m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : NaN;
  };

  it("every form is over by 500 ms (Dave 2026-10-09: nothing over 500 ms)", () => {
    const durs = [...forms.matchAll(/animation:\s*([^;]+);/g)]
      .flatMap((m) => m[1]!.split(",").map((part) => part.trim().split(/\s+/)))
      .filter((w) => w[0] !== "none")
      .map((w) => w.slice(1).filter((x) => /^(var\(--dur-[a-z-]+\)|[\d.]+m?s)$/.test(x)).reduce((t, x) => t + ms(x), 0));
    expect(durs.length).toBeGreaterThanOrEqual(6);
    for (const d of durs) { expect(d).toBeGreaterThan(0); expect(d).toBeLessThanOrEqual(500); }
  });

  it("every animation that MOVES lives inside prefers-reduced-motion: no-preference, and the reduced query collapses the rest", () => {
    const open = forms.indexOf("@media (prefers-reduced-motion: no-preference)");
    const reduce = forms.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(open).toBeGreaterThan(-1);
    expect(reduce).toBeGreaterThan(open);
    const moving = forms.slice(0, open).replace(/@keyframes[^{]+\{(?:[^{}]|\{[^}]*\})*\}/g, "");
    expect(moving, "only the resting look is declared outside the query").not.toMatch(/animation\s*:\s*(?!none)/);
    const inside = forms.slice(open, reduce);
    for (const k of ["cvRing", "cvBloom", "cvHalo", "cvWash"]) expect(inside).toContain(k);
    expect(inside, "the app's own Reduce Motion setting is honoured as well as the phone's").toContain('[data-motion="reduce"]');
    expect(forms.slice(reduce)).toMatch(/animation: none/);
  });

  it("nothing in the forms swells, spins or is thrown: the ring and the bloom only open outward from the box and fade", () => {
    for (const k of ["cvSpark", "cvLift", "burstFly", "checkPop", "rotate("]) expect(forms, k).not.toContain(k);
    const kf = [...forms.matchAll(/@keyframes (\w+) \{((?:[^{}]|\{[^}]*\})*)\}/g)];
    expect(kf.length).toBeGreaterThanOrEqual(4);
    for (const [, name, body] of kf) {
      // a keyframe that scales starts no bigger than the box and ends faded out
      if (/scale\(/.test(body!)) {
        expect(body, name).toMatch(/100% \{[^}]*opacity: 0/);
        expect(body, name).toMatch(/0% \{ transform: scale\((1|0\.\d+)\)/);
      }
      // the row itself never moves
      expect(body, name).not.toMatch(/translate/);
    }
  });

  it("Gentle has its own forms too, so the default also varies", () => {
    expect(forms).toContain('html[data-celebrate="gentle"][data-cv="1"]');
    expect(forms).toContain('html[data-celebrate="gentle"][data-cv="2"]');
  });

  it("the Feedback Style laws still hold: no timer, no randomness in the form code", () => {
    const src = readFileSync(join(__dirname, "effects.ts"), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/Math\.random|crypto\.|setTimeout|setInterval|requestAnimationFrame/);
  });
});
