import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type Page } from "playwright";

// THE WHOLE DAY IS MEASURED IN A REAL BROWSER (Dave 2026-10-19, on his phone: "The schedule is broke").
//
// On 2026-10-18 the Whole Day rows gained an area chip on a second line. In the held-task rows (a task the planner put inside Deep Work, drawn in a
// two-column grid: ring, then title) the chip joined that grid with no column of its own, so auto-placement put it in the ring's column; that column is
// sized to its content, the chip made it the whole row, and every held title was left a one-letter strip down the right edge, 25px wide and 254px
// tall. Every test passed: they run in jsdom, which has no layout engine, and the laws that guard geometry here are source scans of the stylesheets.
// This is the one that LOOKS. It renders the real Today day card (YourDay, through the real stylesheets, in bench-whole-day.html) at 390px, the
// width of the phone, and measures what a person would see:
//   - every title in the card is laid out horizontally, on at most three lines, and the held ones have real width;
//   - the ring's column is a ring wide, never the row;
//   - the area chip sits in the title's column, under the title, inside the card.
// Run against the broken stylesheet it fails on the first held row (title 25px wide, 254px tall). It needs a browser: CI installs Chromium, and
// CHROMIUM_PATH points at one anywhere else.

const PHONE = { width: 390, height: 844 };
let server: ViteDevServer;
let browser: Browser;
let page: Page;

function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  return ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find((p) => existsSync(p));
}

beforeAll(async () => {
  server = await createServer({ root: process.cwd(), logLevel: "silent", server: { host: "127.0.0.1", port: 0, strictPort: false } });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("the bench server did not start");
  const exe = chromiumPath();
  browser = await chromium.launch(exe ? { executablePath: exe } : {});
  page = await (await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1 })).newPage();
  await page.goto(url + "bench-whole-day.html", { waitUntil: "networkidle" });
  await page.waitForSelector(".sched-ticker .block-held-prop", { timeout: 60_000 });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

interface Box { text: string; w: number; h: number; lines: number }

describe("the Whole Day card, rendered at 390px", () => {
  it("draws the real card with the rows the break lived in", async () => {
    const seen = await page.evaluate(() => ({
      held: new Set([...document.querySelectorAll(".sched-ticker .block-held-prop .block-held-t")].map((e) => e.textContent)).size,
      chips: document.querySelectorAll(".sched-ticker .block-held-prop .cat-chip").length,
      rows: document.querySelectorAll(".sched-ticker .sched-row").length,
    }));
    expect(seen.held, "three held tasks").toBe(3);
    expect(seen.chips, "with their area chips").toBeGreaterThanOrEqual(2);
    expect(seen.rows, "beside the event and proposed rows").toBeGreaterThanOrEqual(3);
  });

  it("every title is horizontal text on at most three lines, never a strip", async () => {
    const titles = await page.evaluate<Box[]>(() =>
      [...document.querySelectorAll(".sched-ticker .sched-t, .sched-ticker .block-held-t")].map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
        return { text: el.textContent ?? "", w: r.width, h: r.height, lines: Math.round(r.height / lh), horizontal: cs.writingMode === "horizontal-tb" } as Box & { horizontal: boolean };
      }),
    );
    expect(titles.length).toBeGreaterThan(6);
    for (const t of titles as (Box & { horizontal: boolean })[]) {
      expect(t.horizontal, `"${t.text}" is horizontal text`).toBe(true);
      expect(t.lines, `"${t.text}" is ${Math.round(t.h)}px tall: a title is at most three lines`).toBeLessThanOrEqual(3);
    }
  });

  it("every held title has real width: more than half the card, beside a ring-wide column", async () => {
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".sched-ticker .block-held-prop")].map((row) => {
        const t = row.querySelector(".block-held-t")!.getBoundingClientRect();
        const card = row.closest(".sched-ticker")!.getBoundingClientRect();
        const ring = getComputedStyle(row).gridTemplateColumns.split(" ")[0] ?? "";
        return { text: row.querySelector(".block-held-t")!.textContent ?? "", w: t.width, card: card.width, ring: parseFloat(ring) };
      }),
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      expect(r.w, `"${r.text}" is ${Math.round(r.w)}px wide in a ${Math.round(r.card)}px card`).toBeGreaterThan(r.card * 0.5);
      expect(r.ring, `the ring's column is ${Math.round(r.ring)}px: a ring, not the row`).toBeLessThanOrEqual(48);
    }
  });

  it("the area chip sits under the title in the title's column, inside the card", async () => {
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll(".sched-ticker .block-held-prop")].filter((r) => r.querySelector(".r-k")).map((row) => {
        const t = row.querySelector(".block-held-t")!.getBoundingClientRect();
        const c = row.querySelector(".r-k")!.getBoundingClientRect();
        const card = row.closest(".sched-ticker")!.getBoundingClientRect();
        return { text: row.querySelector(".block-held-t")!.textContent ?? "", dx: Math.abs(c.left - t.left), below: c.top >= t.bottom - 1, inside: c.right <= card.right + 1 && c.left >= card.left };
      }),
    );
    expect(chips.length).toBeGreaterThanOrEqual(2);
    for (const c of chips) {
      expect(c.dx, `"${c.text}": the chip's left edge is the title's`).toBeLessThanOrEqual(1);
      expect(c.below, `"${c.text}": the chip is under the title`).toBe(true);
      expect(c.inside, `"${c.text}": the chip is inside the card`).toBe(true);
    }
  });

  it("the event and proposed rows keep their own title room, chip under the title", async () => {
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".sched-ticker .sched-row .sched-body")].filter((b) => b.querySelector(".r-k")).map((body) => {
        const row = body.closest(".sched-row")!.getBoundingClientRect();
        const b = body.getBoundingClientRect();
        const t = body.querySelector(".sched-t")!.getBoundingClientRect();
        const c = body.querySelector(".r-k")!.getBoundingClientRect();
        return { text: body.querySelector(".sched-t")!.textContent ?? "", bodyW: b.width, rowW: row.width, below: c.top >= t.bottom - 1 };
      }),
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect(r.bodyW, `"${r.text}": the title's column is ${Math.round(r.bodyW)}px of a ${Math.round(r.rowW)}px row`).toBeGreaterThan(r.rowW * 0.5);
      expect(r.below, `"${r.text}": the chip is under the title`).toBe(true);
    }
  });
});
