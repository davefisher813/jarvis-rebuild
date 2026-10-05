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
  const cases: Array<[number, string]> = [[0, "burst"], [1, "burst-ring"], [2, "burst-spark"]];
  for (const [form, cls] of cases) {
    it(`form ${form} draws ${cls}, always with the eight directions the stylesheet knows`, () => {
      html.dataset.cv = String(form);
      const { container } = render(<FeedbackProvider><Probe forms /></FeedbackProvider>);
      fireEvent.click(screen.getByText("expressive"));
      const b = container.querySelector(".burst")!;
      expect(b).not.toBeNull();
      expect(b.classList.contains(cls), cls).toBe(true);
      // exactly one form modifier, and none for the dots
      expect([...b.classList].filter((c) => c === "burst-ring" || c === "burst-spark").length).toBe(form === 0 ? 0 : 1);
      expect(b.querySelectorAll("i").length, "nth-child 1 to 8 are the directions").toBe(8);
      // nothing but the eight sits inside, so the nth-child directions are 1 to 8
      expect(b.children.length).toBe(8);
      expect(b).toHaveAttribute("aria-hidden", "true");
    });
  }

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

  it("every form is under a second", () => {
    const ms = [...forms.matchAll(/animation:[^;]*?(\d+(?:\.\d+)?)(m?s)\b/g)].map((m) => Number(m[1]) * (m[2] === "s" ? 1000 : 1));
    expect(ms.length).toBeGreaterThanOrEqual(6);
    for (const d of ms) { expect(d).toBeGreaterThan(0); expect(d).toBeLessThan(1000); }
  });

  it("every animation that MOVES lives inside prefers-reduced-motion: no-preference, and the reduced query collapses the rest", () => {
    const open = forms.indexOf("@media (prefers-reduced-motion: no-preference)");
    const reduce = forms.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(open).toBeGreaterThan(-1);
    expect(reduce).toBeGreaterThan(open);
    const moving = forms.slice(0, open).replace(/@keyframes[^{]+\{(?:[^{}]|\{[^}]*\})*\}/g, "");
    expect(moving, "only the resting look is declared outside the query").not.toMatch(/animation\s*:\s*(?!none)/);
    const inside = forms.slice(open, reduce);
    expect(inside).toContain("cvRing"); expect(inside).toContain("cvSpark");
    expect(inside).toContain("cvLift"); expect(inside).toContain("cvTick"); expect(inside).toContain("cvHalo");
    expect(inside, "the app's own Reduce Motion setting is honoured as well as the phone's").toContain('[data-motion="reduce"]');
    expect(forms.slice(reduce)).toMatch(/animation: none/);
  });

  it("the card lift uses the translate property, so a swiped row's inline transform is never overwritten", () => {
    const lift = /@keyframes cvLift \{(?:[^{}]|\{[^}]*\})*\}/.exec(forms)?.[0] ?? "";
    expect(lift).toMatch(/translate: 0 -2px/);
    expect(lift).not.toMatch(/transform/);
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
