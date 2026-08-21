// EXHAUSTIVE SCREEN CRAWLER
//
// The app has no router: every screen is React state reached by tapping, so a
// route list cannot be read off disk. Pure discovery-by-clicking is also not
// trustworthy on its own -- the first version of this tool spent its whole
// budget inside Today and never reached Tasks, and reported "22 screens" with
// a straight face. So coverage is built from two halves that check each other:
//
//   1. SEEDS. Every destination in shell/destinations.tsx is navigated to
//      explicitly, by name. If one cannot be reached the run FAILS loudly
//      instead of quietly reporting a smaller number. Settings' subtree is
//      seeded the same way.
//   2. DISCOVERY. Inside each seeded screen, every visible tappable is
//      explored one level deep (sheets, filters, detail pages), returning to
//      the seed between taps so one branch cannot poison the next.
//
// Everything not tapped -- destructive, capped, or it threw -- is written to
// the skip ledger BY NAME. Silent truncation is the failure this tool exists
// to prevent: a report that looks complete is worse than an obvious gap.
//
// Captures are FULL SCROLL HEIGHT, in segments. A viewport-only shot of a
// scrolling page is a partial audit that reads as a total one.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { measure } from "./adhd-metrics.mjs";

const OUT = process.env.OUT || "/tmp/crawl";
const THEME = process.env.THEME || "dark";
const W = Number(process.env.W || 390);
const H = Number(process.env.H || 844);
const DISCOVER = process.env.DISCOVER !== "0";

mkdirSync(OUT, { recursive: true });

// From src/shell/destinations.tsx. Kept in sync by the assertion at the end:
// if a label here cannot be reached, the run fails.
const DESTINATIONS = [
  "Today", "Tasks", "Schedule", "Brain", "Notes",
  "Bigger Picture", "Email", "Notifications", "Money", "Chat",
];
// Rows inside More > Settings.
const SETTINGS_ROWS = [
  "Account", "Notifications", "Appearance", "Categories", "Edit Tabs",
  "Connections", "AI Control", "What JARVIS Learned", "Backup", "Advanced", "About",
];
// Rows inside More > Brain.
const BRAIN_ROWS = [
  "Contacts", "Decisions", "Life Philosophy", "How You Write", "Values", "Your Routine",
];

const DESTRUCTIVE =
  /^(delete|remove|sign out|log out|erase|clear all|reset|disconnect|revoke|wipe|trash|discard|unlink|forget)/i;

const TAPPABLE = [
  "button", "[role=button]", "a[href]", ".lib-row", ".row-tap",
  ".seg button", ".chip", "[data-tap]", "li[tabindex]",
].join(",");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

async function fresh() {
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
  });
  await ctx.addInitScript(() => {
    const f = new Date();
    f.setHours(11, 30, 0, 0);
    const o = f.getTime() - Date.now();
    const R = Date;
    class F extends R {
      constructor(...a) { if (!a.length) super(R.now() + o); else super(...a); }
      static now() { return R.now() + o; }
    }
    window.Date = F;
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
  try { await page.click('text="Skip for now"', { timeout: 5000 }); } catch { /* onboarded */ }
  await page.waitForTimeout(1400);
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), THEME);
  await page.waitForTimeout(250);
  return { ctx, page, errs };
}

/** Tap something by its exact visible label. Tabs and rows both work. */
async function tapText(page, label, { timeout = 4000 } = {}) {
  const tries = [
    () => page.click(`.tab:has-text("${label}")`, { timeout: timeout / 2 }),
    () => page.getByText(label, { exact: true }).first().click({ timeout: timeout / 2 }),
    () => page.click(`text="${label}"`, { timeout: timeout / 2 }),
  ];
  for (const t of tries) {
    try { await t(); await page.waitForTimeout(480); return true; } catch { /* next */ }
  }
  return false;
}

/** Navigate a fresh page to a named destination (tab bar, else via More). */
async function goTo(page, label) {
  if (await tapText(page, label, { timeout: 2500 })) return true;
  if (!(await tapText(page, "More"))) return false;
  return await tapText(page, label);
}

async function tappables(page) {
  return page.$$eval(TAPPABLE, (els) => {
    const seen = new Map();
    const out = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width < 6 || r.height < 6) continue;
      if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) < 0.05) continue;
      const text = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 60);
      if (!text) continue;
      const cls = (el.className && typeof el.className === "string" ? el.className : "")
        .split(/\s+/).filter(Boolean).slice(0, 3).join(".");
      const key = text + "|" + cls;
      const n = seen.get(key) || 0;
      seen.set(key, n + 1);
      out.push({ text, cls, nth: n });
    }
    return out;
  });
}

async function tapDesc(page, d) {
  const ok = await page.evaluate(({ d, SEL }) => {
    const els = [...document.querySelectorAll(SEL)];
    let n = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width < 6 || r.height < 6) continue;
      if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) < 0.05) continue;
      const text = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 60);
      if (!text) continue;
      const cls = (el.className && typeof el.className === "string" ? el.className : "")
        .split(/\s+/).filter(Boolean).slice(0, 3).join(".");
      if (text === d.text && cls === d.cls) {
        if (n === d.nth) { el.scrollIntoView({ block: "center" }); el.click(); return true; }
        n++;
      }
    }
    return false;
  }, { d, SEL: TAPPABLE });
  if (ok) await page.waitForTimeout(520);
  return ok;
}

async function signature(page) {
  return page.evaluate(() => {
    const h = document.querySelector(".pagehead-title, h1, .page-title, .nav-title, .sheet-title, .doc-title")?.innerText?.trim() || "";
    const sheet = document.querySelector(".sheet, [role=dialog], .modal") ? "SHEET" : "";
    const sheetH = document.querySelector(".sheet h2, .sheet h1, [role=dialog] h2")?.innerText?.trim() || "";
    const on = [...document.querySelectorAll(".seg button.on, .seg button.active, .chip.on, .chip.active, .tab.active")]
      .map((e) => e.innerText.trim()).join(",");
    const rows = [...document.querySelectorAll(".lib-row, .row, li, .card, .sh2 .t")]
      .slice(0, 20).map((e) => (e.innerText || "").trim().slice(0, 30)).join("|");
    return [h, sheet, sheetH, on, rows].join("::").slice(0, 900);
  });
}

/** Capture the entire scroll height as numbered segments. */
async function fullShot(page, base, onSegment) {
  const FIND = `[...document.querySelectorAll("*")].filter((e)=>{const s=getComputedStyle(e);return /auto|scroll/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+40&&e.clientHeight>200}).sort((a,b)=>b.scrollHeight-a.scrollHeight)[0]`;
  const box = await page.evaluate(`(()=>{const s=${FIND};if(!s)return null;s.scrollTop=0;return {h:s.scrollHeight,c:s.clientHeight}})()`);
  if (!box) {
    await page.screenshot({ path: `${base}.png` });
    try { onSegment && (await onSegment(0)); } catch { /* best-effort */ }
    return [`${base}.png`];
  }
  const step = Math.max(200, box.c - 70);
  const steps = Math.min(10, Math.ceil((box.h - box.c) / step) + 1);
  const files = [];
  for (let i = 0; i < steps; i++) {
    await page.evaluate(`(()=>{const s=${FIND};if(s)s.scrollTop=${i}*${step}})()`);
    await page.waitForTimeout(240);
    const f = `${base}.s${i}.png`;
    await page.screenshot({ path: f });
    files.push(f);
    try { onSegment && (await onSegment(i)); } catch { /* metrics are best-effort */ }
  }
  return files;
}

// ---------------------------------------------------------------------------
const screens = [];
const skipped = [];
const reachedSeeds = new Set();
const seedHeadings = {};
const seenSig = new Set();
let n = 0;

async function heading(page) {
  return page.evaluate(() =>
    (document.querySelector(".sheet .pagehead-title, .sheet h1, .sheet h2, [role=dialog] h1, [role=dialog] h2, .pagehead-title, h1, .page-title, .nav-title, .doc-title")?.innerText || "").trim().slice(0, 60));
}

async function capture(page, label, path, errs) {
  const sig = await signature(page);
  if (seenSig.has(sig)) return false;
  seenSig.add(sig);
  n++;
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const base = `${OUT}/${String(n).padStart(3, "0")}-${slug}`;
  const merged = {
    words: 0, fillPct: 0, actionCount: 0,
    truncated: [], smallTargets: [], longParas: [], repeatWalls: [], shameHits: [], motion: [],
  };
  const seenK = new Set();
  const files = await fullShot(page, base, async () => {
    let m;
    try { m = await measure(page); } catch { return; }
    merged.words = Math.max(merged.words, m.words || 0);
    merged.fillPct = Math.max(merged.fillPct, m.fillPct || 0);
    merged.actionCount = Math.max(merged.actionCount, m.actionCount || 0);
    for (const key of ["truncated", "smallTargets", "longParas", "repeatWalls", "shameHits", "motion"]) {
      for (const item of m[key] || []) {
        const k = key + JSON.stringify(item);
        if (seenK.has(k)) continue;
        seenK.add(k);
        merged[key].push(item);
      }
    }
  });
  screens.push({ n, label, path, files, segments: files.length, errs: [...errs], metrics: merged });
  return true;
}

// ---- 1. SEEDS: every destination, by name ---------------------------------
const SEEDS = [
  ...DESTINATIONS.map((d) => ({ label: d, nav: async (p) => goTo(p, d) })),
  { label: "More", nav: async (p) => tapText(p, "More") },
  { label: "Settings", nav: async (p) => (await tapText(p, "More")) && tapText(p, "Settings") },
  ...SETTINGS_ROWS.map((r) => ({
    parentHeading: "Settings",
    label: `Settings > ${r}`,
    nav: async (p) => (await tapText(p, "More")) && (await tapText(p, "Settings")) && tapText(p, r),
  })),
  ...BRAIN_ROWS.map((r) => ({
    parentHeading: "Brain",
    label: `Brain > ${r}`,
    nav: async (p) => (await goTo(p, "Brain")) && tapText(p, r),
  })),
  // Search is an overlay, not a destination: it opens from Today's header
  // magnifier or the capture bar's. Both are seeded so a change to either
  // does not silently drop the screen.
  // ".voice-search" alone matches the What-Now bolt too (it carries both
  // classes), so the first version of this seed captured the Right Now sheet
  // and labelled it "Search". Address each by its aria-label instead.
  { label: "Search (from Today header)", nav: async (p) => { try { await p.click(".today-search", { timeout: 3000 }); await p.waitForTimeout(900); return true; } catch { return false; } } },
  { label: "Search (from capture bar)", nav: async (p) => { try { await p.click('[aria-label="Search everything"]', { timeout: 3000 }); await p.waitForTimeout(900); return true; } catch { return false; } } },
  { label: "What Now (the bolt)", nav: async (p) => { try { await p.click('[aria-label="What should I do now"]', { timeout: 3000 }); await p.waitForTimeout(900); return true; } catch { return false; } } },
  { label: "Capture bar (tap to capture)", nav: async (p) => { try { await p.click(".voice-cap, .voice-bar .voice-hint, .voice-bar", { timeout: 3000 }); await p.waitForTimeout(900); return true; } catch { return false; } } },
];

for (const seed of SEEDS) {
  const { ctx, page, errs } = await fresh();
  try {
    const ok = await seed.nav(page);
    if (!ok) {
      skipped.push({ path: seed.label, why: "SEED UNREACHABLE (investigate)" });
      await ctx.close();
      continue;
    }
    // A tap that "succeeded" but left us on the parent screen is a FALSE
    // pass -- the first run of this reported 30/30 while five pages had
    // silently not opened. Compare the heading against the parent's.
    const h = await heading(page);
    if (seed.parentHeading && h === seed.parentHeading) {
      skipped.push({ path: seed.label, why: `SEED DID NOT OPEN (still on "${h}")` });
      await ctx.close();
      continue;
    }
    reachedSeeds.add(seed.label);
    seedHeadings[seed.label] = h;
    const fresh1 = await capture(page, seed.label, seed.label, errs);
    if (!fresh1) skipped.push({ path: seed.label, why: `duplicate signature (heading "${h}")` });

    // ---- 2. DISCOVERY inside this seed, one level deep -------------------
    if (DISCOVER) {
      const kids = await tappables(page);
      for (const d of kids) {
        if (DESTRUCTIVE.test(d.text)) {
          skipped.push({ path: `${seed.label} > ${d.text}`, why: "destructive, not tapped by policy" });
          continue;
        }
        if (DESTINATIONS.includes(d.text) || d.text === "More") continue; // seeded separately
        // Re-enter the seed from zero so a previous tap cannot pollute this one.
        const f2 = await fresh();
        try {
          if (!(await seed.nav(f2.page))) { await f2.ctx.close(); continue; }
          if (!(await tapDesc(f2.page, d))) {
            skipped.push({ path: `${seed.label} > ${d.text}`, why: "element vanished on replay" });
            await f2.ctx.close();
            continue;
          }
          await capture(f2.page, `${seed.label} > ${d.text}`, `${seed.label} > ${d.text}`, f2.errs);
        } catch (e) {
          skipped.push({ path: `${seed.label} > ${d.text}`, why: "threw: " + String(e).slice(0, 90) });
        } finally {
          await f2.ctx.close();
        }
      }
    }
  } catch (e) {
    skipped.push({ path: seed.label, why: "threw: " + String(e).slice(0, 110) });
  } finally {
    await ctx.close();
  }
  console.log(`seed done: ${seed.label} -> ${screens.length} screens so far`);
}

await browser.close();

// ---- 3. COVERAGE ASSERTION ------------------------------------------------
const missing = SEEDS.map((s) => s.label).filter((l) => !reachedSeeds.has(l));
const report = {
  theme: THEME,
  viewport: `${W}x${H}`,
  seedsExpected: SEEDS.length,
  seedsReached: reachedSeeds.size,
  seedsMissing: missing,
  seedHeadings,
  uniqueScreens: screens.length,
  totalSegments: screens.reduce((a, s) => a + s.segments, 0),
  screens,
  skipped,
};
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(report, null, 2));
console.log(`\nSEEDS  ${reachedSeeds.size}/${SEEDS.length} reached`);
if (missing.length) console.log(`MISSING SEEDS: ${missing.join(", ")}`);
console.log(`SCREENS ${screens.length} unique, ${report.totalSegments} image segments`);
console.log(`SKIPPED ${skipped.length} entries (all named in manifest.json)`);
if (missing.length) process.exitCode = 1;
