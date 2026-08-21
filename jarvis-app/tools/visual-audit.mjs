import { chromium } from "playwright";
import { writeFileSync } from "fs";

// THE VISUAL AUDITOR. Three visual bugs shipped past a green test suite in
// three rounds (an arc drawn in an undefined colour, a stream stacked flush,
// and a reset that zeroed itself). All three were geometry, and tests do not
// look at geometry. This measures it.
const AUDIT = () => {
  const out = [];
  const vw = window.innerWidth;
  const seen = new Set();
  const add = (kind, detail, el) => {
    const k = kind + "|" + detail;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ kind, detail, cls: (el?.className || "").toString().slice(0, 60) });
  };
  const inFixed = (e) => {
    let n = e;
    while (n && n !== document.body) {
      if (getComputedStyle(n).position === "fixed") return true;
      n = n.parentElement;
    }
    return false;
  };
  const vis = (e) => {
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // A rect CLIPPED by an ancestor is not where the user can touch it. The
  // Your Day ticker scrolls its rows under overflow:hidden, so a row can be
  // geometrically over the button above it while being invisible and
  // untappable. Judging raw rects invents overlaps that do not exist.
  const clipped = (e) => {
    let r = e.getBoundingClientRect();
    let n = e.parentElement;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (["hidden", "auto", "scroll", "clip"].includes(cs.overflow) ||
          ["hidden", "auto", "scroll", "clip"].includes(cs.overflowY) ||
          ["hidden", "auto", "scroll", "clip"].includes(cs.overflowX)) {
        const p = n.getBoundingClientRect();
        const top = Math.max(r.top, p.top), bottom = Math.min(r.bottom, p.bottom);
        const left = Math.max(r.left, p.left), right = Math.min(r.right, p.right);
        r = { top, bottom, left, right, width: right - left, height: bottom - top };
        if (r.width <= 0 || r.height <= 0) return null;
      }
      n = n.parentElement;
    }
    return r;
  };
  const all = [...document.querySelectorAll("body *")].filter(vis).filter((e) => clipped(e));

  // 1. HORIZONTAL OVERFLOW. The page must never scroll sideways.
  for (const e of all) {
    const r = e.getBoundingClientRect();
    if (r.right > vw + 1.5 || r.left < -1.5) {
      const cs = getComputedStyle(e);
      if (cs.position === "fixed") continue;
      // A deliberately scrollable strip is allowed to exceed its own box.
      let p = e.parentElement, scroller = false;
      while (p && p !== document.body) {
        const px = getComputedStyle(p).overflowX;
        if (px === "auto" || px === "scroll") { scroller = true; break; }
        p = p.parentElement;
      }
      if (scroller) continue;
      if (inFixed(e)) continue;
      add("overflow-x", `${e.tagName.toLowerCase()}.${(e.className||"").toString().split(" ")[0]} right=${Math.round(r.right)} vw=${vw}`, e);
    }
  }

  // 2. TRUNCATED TEXT. A label clipped mid-word is information thrown away.
  for (const e of all) {
    if (e.children.length > 0) continue;
    const cs = getComputedStyle(e);
    if (cs.textOverflow !== "ellipsis" && cs.overflow !== "hidden") continue;
    // Ellipsis is a legitimate pattern; losing a quarter of the string is
    // not. Flag by how much is actually hidden, so a secondary hint clipping
    // two characters does not bury a task name clipping a third of itself.
    const lost = (e.scrollWidth - e.clientWidth) / Math.max(1, e.scrollWidth);
    if (lost > 0.15 && (e.textContent || "").trim().length > 0) {
      add("truncated", `"${(e.textContent||"").trim().slice(0,34)}" loses ${Math.round(lost*100)}%`, e);
    }
  }

  // 3. OVERLAPPING TAP TARGETS. Two controls sharing pixels means hitting
  //    the wrong one, which is worse than ugly.
  const tappable = all.filter((e) => {
    if (e.tagName === "BUTTON" || e.getAttribute("role") === "button") return true;
    return ["INPUT", "SELECT", "TEXTAREA", "A"].includes(e.tagName);
  });
  for (let i = 0; i < tappable.length; i++) {
    for (let j = i + 1; j < tappable.length; j++) {
      const a = tappable[i], c = tappable[j];
      if (a.contains(c) || c.contains(a)) continue;
      // A swipe rail sits deliberately behind its row. Same container, by
      // design, and not a stacked tap target.
      const SWIPE = ".task-swipe, .notice-swipe, .sched-swipe-wrap";
      if (a.closest(SWIPE) && a.closest(SWIPE) === c.closest(SWIPE)) continue;
      // App chrome sits in normal flow at the edges of the shell and content
      // scrolls behind it BY DESIGN. Content passing under the capture bar is
      // not a stacked tap target; that is what the under-bar check is for.
      const CHROME = ".voice-dock, .tab-bar, .pagebar, .nav-bar, .sheet-scrim";
      if (!!a.closest(CHROME) !== !!c.closest(CHROME)) continue;
      if (inFixed(a) || inFixed(c)) continue;
      const ra = clipped(a), rc = clipped(c);
      if (!ra || !rc) continue;
      const ox = Math.min(ra.right, rc.right) - Math.max(ra.left, rc.left);
      const oy = Math.min(ra.bottom, rc.bottom) - Math.max(ra.top, rc.top);
      if (ox > 2 && oy > 2) {
        add("overlap", `"${(a.textContent||"").trim().slice(0,18)}" x "${(c.textContent||"").trim().slice(0,18)}"`, a);
      }
    }
  }

  // 4. TAP TARGETS BELOW THE 44px MINIMUM (Apple HIG).
  // Measure the HIT AREA, not the paint. A control may be 19px of type with
  // a ::after that expands the touch target to 45; reporting the paint rect
  // calls a fixed control broken forever. elementFromPoint is the truth.
  // 24, not 44. Apple's own segmented control is 32px and full-width rows at
  // 30-36 are trivially hittable; flagging those is noise that buries the
  // real ones. This catches genuinely broken targets.
  const MIN = 24;
  for (const e of tappable) {
    // The NATURAL height, not the clipped one. A 46px row scrolled so that
    // 5px of it shows is not a small target, it is a scrolled row.
    const r = e.getBoundingClientRect();
    const txt = (e.textContent || "").trim();
    if (!txt || r.height >= MIN) continue;
    if (r.top < 0 || r.bottom > window.innerHeight) continue; // off-screen: cannot hit-test
    const cx = r.left + r.width / 2;
    const hits = (y) => { const t = document.elementFromPoint(cx, y); return t === e || e.contains(t); };
    const need = (MIN - r.height) / 2;
    const grown = hits(r.top - need + 1) && hits(r.bottom + need - 1);
    if (!grown) {
      add("small-target", `"${txt.slice(0,24)}" hit ${Math.round(r.width)}x${Math.round(r.height)}, needs ${MIN}`, e);
    }
  }

  // 5. INVISIBLE TEXT. Same colour as what is behind it. This is the class
  //    of bug that shipped the arc drawn in an undefined custom property.
  // Composite the real stack. A chip is rgba(255,255,255,0.06) over black,
  // which is nearly black; reading the raw declaration calls white text on it
  // invisible, which is how a detector invents 40 bugs that do not exist.
  const parse = (c) => {
    const m = (c || "").match(/[\d.]+/g);
    if (!m) return null;
    return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 };
  };
  const bgOf = (e) => {
    const layers = [];
    let n = e;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; }
      n = n.parentElement;
    }
    layers.push({ r: 0, g: 0, b: 0, a: 1 });
    let out = layers[layers.length - 1];
    for (let i = layers.length - 2; i >= 0; i--) {
      const t = layers[i];
      out = {
        r: t.r * t.a + out.r * (1 - t.a),
        g: t.g * t.a + out.g * (1 - t.a),
        b: t.b * t.a + out.b * (1 - t.a),
        a: 1,
      };
    }
    return `rgb(${Math.round(out.r)}, ${Math.round(out.g)}, ${Math.round(out.b)})`;
  };
  const lum = (c) => {
    const m = c.match(/[\d.]+/g);
    if (!m) return null;
    const [r, g, bl] = m.map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  for (const e of all) {
    if (e.children.length > 0) continue;
    const txt = (e.textContent || "").trim();
    if (!txt) continue;
    const cs = getComputedStyle(e);
    const fg = lum(cs.color), bg = lum(bgOf(e));
    if (fg === null || bg === null) continue;
    if (Math.abs(fg - bg) < 12) {
      add("invisible-text", `"${txt.slice(0,28)}" fg=${cs.color} bg=${bgOf(e)}`, e);
    }
  }

  // 6. STACKED SIBLINGS WITH NO GAP. The bug Dave found in Heads Up.
  const cards = [...document.querySelectorAll(".card, .notice-swipe, .promo-card")].filter(vis);
  for (let i = 1; i < cards.length; i++) {
    const a = cards[i-1].getBoundingClientRect(), c = cards[i].getBoundingClientRect();
    if (cards[i-1].contains(cards[i]) || cards[i].contains(cards[i-1])) continue;
    const gap = c.top - a.bottom;
    if (gap >= -1 && gap < 4 && Math.abs(a.left - c.left) < 3) {
      add("flush-stack", `gap=${Math.round(gap)}px between two cards`, cards[i]);
    }
  }

  // 7. CONTENT UNDER THE FIXED BARS. A row you can see but never tap.
  const bars = [...document.querySelectorAll("*")].filter((e) => getComputedStyle(e).position === "fixed" && vis(e));
  for (const bar of bars) {
    const rb = bar.getBoundingClientRect();
    if (rb.height > window.innerHeight * 0.5) continue;
    for (const e of tappable) {
      if (bar.contains(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.top >= 0 && r.bottom <= window.innerHeight &&
          r.bottom > rb.top + 4 && r.top < rb.bottom - 4 &&
          r.right > rb.left && r.left < rb.right) {
        add("under-bar", `"${(e.textContent||"").trim().slice(0,22)}" behind fixed bar`, e);
      }
    }
  }
  return out;
};

const SHOTS = [];
async function auditScreen(page, name) {
  await page.waitForTimeout(900);
  const findings = await page.evaluate(AUDIT);
  const errs = [];
  return { name, findings, errs };
}

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const W = Number(process.env.VW || 390), H = Number(process.env.VH || 844);
const THEME = process.env.THEME || "";
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  const f = new Date(); f.setHours(11, 30, 0, 0);
  const o = f.getTime() - Date.now(); const R = Date;
  class F extends R { constructor(...a){ if(!a.length) super(R.now()+o); else super(...a);} static now(){return R.now()+o;} }
  window.Date = F;
});
const page = await ctx.newPage();
const consoleErrs = [];
page.on("pageerror", (e) => consoleErrs.push(String(e).slice(0, 140)));
await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
try { await page.click('text="Skip for now"', { timeout: 5000 }); } catch {}
await page.waitForTimeout(3000);
if (THEME) { await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), THEME); await page.waitForTimeout(500); }

const results = [];
const TABS = ["Today", "Tasks", "Schedule", "More"];
for (const t of TABS) {
  try { await page.click(`text="${t}"`, { timeout: 3000 }); } catch { continue; }
  results.push(await auditScreen(page, "Tab: " + t));
}

// Every row inside More
await page.click('text="More"').catch(()=>{});
await page.waitForTimeout(1000);
const rows = await page.evaluate(() => [...document.querySelectorAll(".lib-name")].map(e => e.textContent));
for (const r of rows) {
  await page.click('text="More"').catch(()=>{});
  await page.waitForTimeout(700);
  try { await page.click(`text="${r}"`, { timeout: 2500 }); } catch { continue; }
  results.push(await auditScreen(page, "More > " + r));
  // DETAIL DIVE (2026-08-21). Every audit before this one stopped at the
  // top of each section, which meant the pages where the app actually holds
  // its content -- a project, a goal, a person, a category -- were never
  // looked at once. "How can we do it so you don't miss anything" has to
  // include the screens that are one tap further in.
  // Click by ELEMENT, not by text. Text selectors match the first thing on
  // the page that happens to say the same words, which on these screens is
  // usually a heading rather than the row.
  const SEL = '.row[role="button"], .proj-row, .lm-row, .cat-row, .settings-row, .conn-row, .person-row';
  const count = Math.min(3, await page.locator(SEL).count());
  for (let i = 0; i < count; i++) {
    const before = page.url() + "|" + await page.evaluate(() => document.querySelector(".nav-title, .pagebar-title, .pagehead-title")?.textContent || "");
    const row = page.locator(SEL).nth(i);
    let label = "";
    try {
      label = ((await row.textContent()) || "").trim().split("\n")[0].slice(0, 34);
      await row.click({ timeout: 2000 });
    } catch { continue; }
    await page.waitForTimeout(800);
    const after = page.url() + "|" + await page.evaluate(() => document.querySelector(".nav-title, .pagebar-title, .pagehead-title")?.textContent || "");
    // A row that opened nothing is not a screen; auditing the same screen
    // three times is how a report gets padded instead of thorough.
    if (after === before) continue;
    results.push(await auditScreen(page, "More > " + r + " > " + label));
    await page.click(".nav-back, .pagebar-back").catch(() => {});
    await page.waitForTimeout(600);
  }
}

writeFileSync("/tmp/audit.json", JSON.stringify({ results, consoleErrs }, null, 1));
let total = 0;
for (const r of results) {
  if (r.findings.length === 0) continue;
  total += r.findings.length;
  console.log("\n### " + r.name);
  const byKind = {};
  for (const f of r.findings) (byKind[f.kind] ??= []).push(f.detail);
  for (const [k, v] of Object.entries(byKind)) {
    console.log(`  ${k} (${v.length}):`);
    for (const d of v.slice(0, 4)) console.log("    - " + d);
    if (v.length > 4) console.log(`    ... ${v.length - 4} more`);
  }
}
console.log(`\n[${W}x${H}${THEME ? " " + THEME : " dark"}] TOTAL FINDINGS: ${total} | screens: ${results.length}`);
console.log("PAGE ERRORS:", consoleErrs.slice(0, 4));
await b.close();
