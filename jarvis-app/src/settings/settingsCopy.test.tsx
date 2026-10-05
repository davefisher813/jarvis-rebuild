// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { NotesProvider } from "../data/NotesProvider";
import { AuthProvider } from "../auth/AuthProvider";
import TrainingPage, { rackHint } from "./TrainingPage";
import AccountPage from "./AccountPage";
import AboutPage from "./AboutPage";
import NotificationsPage, { webNote } from "./NotificationsPage";
import { Capacitor } from "@capacitor/core";
import * as webPush from "../shared/webPush";
import BrainSettingsPage from "./BrainSettingsPage";
import { Switch } from "./kit";
import { notEnoughDaysLine } from "../brain/insightCopy";
import { readGymSettings, writeGymSettings } from "../gym/settings";

// SETTINGS COPY READS THE SAME TO EVERY READER (evening audit, 2026-09-29).
//
// The audit read production and got "Inlb.", "Personalplan", "Buildb375567",
// "Needs10emails handled, with one3-hour stretch...", "forBodyweightandRDLs
// (dumbbell),1of10paired". Chromium's innerText has the spaces; the DOM does
// not, at the seams. React renders `In {unit}. A lift...` as three text nodes
// and `<b>{n}</b> emails` as an element between two, and the whitespace sits
// only at the EDGES of those nodes. A reader that takes each node on its own
// and trims it (which is what an automation tool, a copy of a selection into
// some editors, and some screen-reader paths do) loses every space at every
// seam. It is not flex: the parents here are plain blocks.
//
// The rule these tests pin: a sentence the app writes is ONE text node in ONE
// element. Interpolate into a template string, never around JSX text.

/** What a reader that takes each text node and trims it sees. */
function perNode(el: Element): string {
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) { const t = (n.textContent ?? "").trim(); if (t) out.push(t); }
    else n.childNodes.forEach(walk);
  };
  walk(el);
  return out.join("");
}

/** The element is one text node, and so reads the same node by node. */
function expectOneNode(el: Element | null, words: string) {
  expect(el).not.toBeNull();
  expect(el!.textContent).toBe(words);
  expect(el!.childNodes.length).toBe(1);
  expect(el!.firstChild!.nodeType).toBe(3);
  expect(perNode(el!)).toBe(words);
}

describe("item 4: Training hint", () => {
  it("rackHint keeps its space in both units", () => {
    // 2026-10-05: no unit prefix and no dot typed in the line; the Rack Unit row above already says the unit.
    expect(rackHint("lb")).toBe("A lift logged in the other unit is converted both ways");
    expect(rackHint("kg")).toBe("A lift logged in the other unit is converted both ways");
  });

  it("renders as one text node, in a block, for lb and for kg", () => {
    localStorage.clear();
    const { container, unmount } = render(<TrainingPage onBack={() => {}} />);
    const hint = container.querySelector(".input-hint");
    expectOneNode(hint, rackHint("lb"));
    // The parents are plain blocks: no flex row is splitting the runs.
    expect(hint!.className).toBe("input-hint");
    expect(hint!.parentElement!.className).toBe("pad-x");
    unmount();
    writeGymSettings({ ...readGymSettings(), rackUnit: "kg" });
    const again = render(<TrainingPage onBack={() => {}} />);
    expectOneNode(again.container.querySelector(".input-hint"), rackHint("kg"));
  });
});

describe("item 7: Account, About, Brain", () => {
  it("Account: the plan line is one text node with its space", async () => {
    const { container } = render(
      <AuthProvider><NotesProvider userId="u-copy"><AccountPage onBack={() => {}} /></NotesProvider></AuthProvider>,
    );
    await waitFor(() => expect(container.querySelector(".account-sub")).not.toBeNull());
    expectOneNode(container.querySelector(".account-sub"), "Personal Plan");
  });

  it("About: the build label is one node and a real space stands between it and the date", () => {
    const { container } = render(<AboutPage onBack={() => {}} />);
    const sub = container.querySelector(".account-sub")!;
    // A build with no stamp (this test build) is the one plain string.
    const fact = sub.querySelector(".fact:not(.date)") ?? sub;
    expect(fact!.textContent).toMatch(/^Build \S+$/);
    expect(fact!.childNodes.length).toBe(1);
    if (sub.querySelector(".date")) {
      // Chromium's innerText and a copy of the line both get the space.
      expect(sub.textContent).toMatch(/^Build \S+ \S+$/);
    }
    // The label is never glued to the value, per node or whole.
    expect(perNode(fact!)).toMatch(/^Build \S+$/);
  });

  it("Brain: each danger-zone note is the whole sentence in one node", () => {
    const { container } = render(<NotesProvider userId="u-brain"><BrainSettingsPage onBack={() => {}} /></NotesProvider>);
    const notes = [...container.querySelectorAll(".input-hint")];
    expectOneNode(notes[0]!, "Decisions, principles, values, writing samples and facts are deleted");
    expectOneNode(notes[1]!, "Contacts stay, but their roles go back to Unsorted");
  });
});

describe("item 5: Notifications foot and switch names", () => {
  afterEach(() => vi.restoreAllMocks());

  it("the note for a browser that is not on the Home Screen is the whole instruction, in one node, and says only the steps", async () => {
    // The copy itself is whole in source.
    expect(webNote("not-standalone")).toMatch(/then open JARVIS from there$/);
    expect(webNote("not-standalone").length).toBeLessThan(100);
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(false);
    vi.spyOn(webPush, "currentStatus").mockResolvedValue("not-standalone");
    const { container } = render(<NotesProvider userId="u-n"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    await waitFor(() => expect(container.querySelector(".input-hint")).not.toBeNull());
    const foot = container.querySelector(".input-hint")!;
    expect(foot.textContent).toBe(webNote("not-standalone"));
    // Whatever state this browser is in, its note is one whole node.
    expectOneNode(foot, foot.textContent!);
  });

  it("a switch row is named once: the switch, described by its meta, and the row is not a second button", async () => {
    const { container } = render(<NotesProvider userId="u-n2"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    const sw = await screen.findByRole("switch", { name: "Overdue and Due Tasks" });
    // Exactly one control carries that name.
    expect(screen.getAllByRole("switch", { name: "Overdue and Due Tasks" })).toHaveLength(1);
    expect(screen.queryAllByRole("button", { name: /Overdue and Due Tasks/ })).toHaveLength(0);
    const row = sw.closest(".set-row")!;
    expect(row.getAttribute("role")).toBeNull();
    expect(row.getAttribute("tabindex")).toBeNull();
    // The description is the row's own meta line, by id, not a copy of it.
    const described = sw.getAttribute("aria-describedby")!;
    expect(container.ownerDocument.getElementById(described)!.textContent).toBe("On the Notifications Tab Only");
    // No accessible name in the whole page says the same words twice.
    for (const s of screen.getAllByRole("switch")) {
      const name = s.getAttribute("aria-label")!;
      const buttons = screen.queryAllByRole("button", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
      expect(buttons.filter((b) => b !== s)).toHaveLength(0);
    }
  });

  it("the kit Switch still flips from a tap on its row", () => {
    const onToggle = vi.fn();
    const { container } = render(<Switch label="Rest timer" meta="A buzz" on onToggle={onToggle} />);
    container.querySelector<HTMLElement>(".set-row")!.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

// ---- the source and the stylesheet -------------------------------------------

const SRC = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/** Every JSX element whose text sits beside an expression or an element: the
 *  construct that makes more than one text node out of one sentence. */
function seams(rel: string): string[] {
  const src = read(rel);
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
      n.children.forEach((k, i) => {
        if (!ts.isJsxText(k) || !k.text.trim()) return;
        const prev = n.children[i - 1]; const next = n.children[i + 1];
        if ((prev && !ts.isJsxText(prev)) || (next && !ts.isJsxText(next))) {
          found.push(`${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${JSON.stringify(k.text.replace(/\s+/g, " "))}`);
        }
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

describe("no Settings sentence is split across text nodes", () => {
  const pages = readdirSync(SRC + "/settings").filter((f) => f.endsWith(".tsx") && !f.includes(".test."));
  // Deliberate seams: the wordmark is one design (a red J beside ARVIS), and
  // the Lab's "7/10" is two numbers with a slash, not a sentence.
  const ALLOWED = [/settings\/AboutPage\.tsx:\d+ "ARVIS"/];
  it.each(pages)("%s", (f) => {
    const bad = seams("settings/" + f).filter((s) => !ALLOWED.some((a) => a.test(s)));
    expect(bad).toEqual([]);
  });

  it("the Learning Lab's why-lines and the readiness sheet are plain strings, not Nums", () => {
    for (const f of ["brain/strands/ReadinessPanel.tsx", "brain/strands/ReadinessSheet.tsx"]) {
      expect(read(f), f).not.toMatch(/<Nums\b/);
      const bad = seams(f).filter((s) => !/ "\/"$/.test(s));
      expect(bad, f).toEqual([]);
    }
  });

  it("Health Insights: the not-enough-days line and the volume note are built as one string", () => {
    const src = read("brain/CategoryDetail.tsx");
    expect(notEnoughDaysLine({ def: "Bodyweight", ex: "RDLs (dumbbell)", p: { paired: 1, needed: 10 } })).toBe("Not enough days yet for Bodyweight and RDLs (dumbbell), 1 of 10 paired sessions.");
    expect(src).toMatch(/\{notEnoughDaysLine\(nearest\)\}/);
    expect(src).not.toMatch(/Not enough days yet for \{/);
    expect(src).not.toMatch(/warm-ups excluded\. \{rangeRows/);
    expect(seams("brain/CategoryDetail.tsx").filter((s) => /Not enough days|paired sessions|warm-ups excluded/.test(s))).toEqual([]);
    expect(seams("brain/InsightEvidence.tsx")).toEqual([]);
  });

  it("Learning Lab detector sentences render as one node per line", async () => {
    const { default: LearningLabPage } = await import("./LearningLabPage");
    const { container } = render(<LearningLabPage onBack={() => {}} />);
    await screen.findByText("What JARVIS Is Watching");
    const whys = [...container.querySelectorAll(".rdy-why")];
    expect(whys.length).toBeGreaterThanOrEqual(10);
    for (const w of whys) expectOneNode(w, w.textContent!);
    const text = whys.map((w) => w.textContent).join("\n");
    expect(text).toMatch(/Needs 10 completions, with one 3-hour stretch holding 40 percent of them/);
    expect(text).toMatch(/Needs 3 corrections in one area, same way, 10 minutes or more, from this device's log/);
    expect(text).toMatch(/a quiet month looks the same/);
  });
});

describe("Settings copy is never clamped or cut by the stylesheet", () => {
  const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "");
  const css = stripComments(read("styles/ruled.css"));
  /** The last rule in ruled.css whose selector list contains `sel`. */
  function lastRule(sel: string): string {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.split(",").map((s) => s.trim()).includes(sel) && /line-clamp/.test(m[2]!));
    expect(rules.length, sel + " has no rule").toBeGreaterThan(0);
    return rules[rules.length - 1]![2]!;
  }

  it.each([
    ".ruled .set-card > .set-row .conn-meta",
    ".ruled .input-hint",
    ".ruled .rdy-why",
  ])("%s lifts the line-clamp and the nowrap", (sel) => {
    const body = lastRule(sel);
    expect(body).toMatch(/-webkit-line-clamp:\s*none/);
    expect(body).toMatch(/overflow:\s*visible/);
    expect(body).not.toMatch(/white-space:\s*nowrap/);
    expect(body).not.toMatch(/max-height:\s*[^n\s]/);
  });

  it("no rule later in any stylesheet re-clamps a Settings row's meta, foot or why-line", () => {
    for (const f of readdirSync(join(SRC, "styles")).filter((n) => n.endsWith(".css"))) {
      const text = stripComments(readFileSync(join(SRC, "styles", f), "utf8"));
      for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const sels = m[1]!.split(",").map((s) => s.trim());
        const targets = sels.filter((s) => /\.ruled\s+\.(set-card|input-hint|rdy-why)/.test(s) || /^\.(input-hint|rdy-why)$/.test(s));
        if (!targets.length) continue;
        if (/-webkit-line-clamp:\s*[1-9]/.test(m[2]!) || /white-space:\s*nowrap/.test(m[2]!)) {
          // The Settings name column and the value column may ellipsize; the
          // copy under them may not.
          expect(targets.every((t) => /\.(conn-name|row-value|dd|switch|chip|set-field)/.test(t)), `${f}: ${m[1]!.trim()}`).toBe(true);
        }
      }
    }
  });
});

// The evening audit reads at most 100 characters of an element and reported both of these
// as cut mid-word ("...from ther", "...a quiet month l"). Both are whole in source, so they
// are kept under 100 so no reader can clip them (2026-09-30).
describe("the two lines a 100-character reader used to clip", () => {
  it("every note under the Alerts row fits in 100 characters", () => {
    // off and on carry the all-or-nothing sentence as well, by design, and are not in this batch.
    for (const s of ["no-sw", "not-standalone", "no-push", "denied", "no-key"] as const) {
      expect(webNote(s).length, s).toBeLessThan(100);
    }
  });
  it("the Learning Lab consolidation line fits in 100 characters", async () => {
    const src = (await import("node:fs")).readFileSync("src/brain/strands/ReadinessPanel.tsx", "utf8");
    const m = /const passWhy = !pass\s*\? "([^"]+)"/.exec(src);
    expect(m).not.toBeNull();
    expect(m![1]!.length).toBeLessThan(100);
  });
});
