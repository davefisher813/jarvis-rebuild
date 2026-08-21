// Draws the invisible layout on top of a screen: every distinct left edge of
// text, and every tap target under 44px. Numbers in a table are arguable;
// a picture of eleven different left margins is not.
import { chromium } from "playwright";

const SCREENS = [
  { label: "today", nav: async () => {} },
  { label: "schedule", nav: async (p) => { await p.click('text="Schedule"'); await p.waitForTimeout(800); } },
  { label: "tasks", nav: async (p) => { await p.click('text="Tasks"'); await p.waitForTimeout(800); } },
  { label: "money", nav: async (p) => { await p.click('text="More"'); await p.waitForTimeout(600); await p.click('text="Money"'); await p.waitForTimeout(800); } },
];

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

for (const s of SCREENS) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    const f = new Date(); f.setHours(11, 30, 0, 0);
    const o = f.getTime() - Date.now(); const R = Date;
    class F extends R { constructor(...a) { if (!a.length) super(R.now() + o); else super(...a); } static now() { return R.now() + o; } }
    window.Date = F;
  });
  const page = await ctx.newPage();
  await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
  try { await page.click('text="Skip for now"', { timeout: 6000 }); } catch { /* onboarded */ }
  await page.waitForTimeout(1800);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await s.nav(page);
  await page.waitForTimeout(500);

  const info = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0.05
        && r.bottom > 0 && r.top < innerHeight;
    };
    const lefts = new Map();
    for (const el of document.querySelectorAll("*")) {
      if (!vis(el)) continue;
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 30) continue;
      const L = Math.round(r.left);
      lefts.set(L, (lefts.get(L) || 0) + 1);
    }
    const smalls = [];
    for (const el of document.querySelectorAll("button,[role=button],a[href],.chip,.tab,.lib-row")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      const after = getComputedStyle(el, "::after");
      const grew = after && after.content !== "none" && /absolute/.test(after.position);
      if (grew) continue;
      if (r.height < 44) smalls.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
    const ov = document.createElement("div");
    ov.style.cssText = "position:fixed;inset:0;z-index:99999;pointer-events:none";
    for (const [L, n] of [...lefts].sort((a, b2) => a[0] - b2[0])) {
      const line = document.createElement("div");
      line.style.cssText = `position:absolute;left:${L}px;top:0;bottom:0;width:1px;background:rgba(0,255,200,.85)`;
      ov.appendChild(line);
      const tag = document.createElement("div");
      tag.textContent = L;
      tag.style.cssText = `position:absolute;left:${L + 1}px;top:${(n % 7) * 15 + 90}px;font:9px monospace;color:#00ffc8;background:rgba(0,0,0,.75);padding:0 2px`;
      ov.appendChild(tag);
    }
    for (const t of smalls) {
      const box = document.createElement("div");
      box.style.cssText = `position:absolute;left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px;outline:1.5px solid #ff3b30;background:rgba(255,59,48,.14)`;
      ov.appendChild(box);
      const tag = document.createElement("div");
      tag.textContent = Math.round(t.h);
      tag.style.cssText = `position:absolute;left:${t.x + t.w + 2}px;top:${t.y}px;font:9px monospace;color:#fff;background:#ff3b30;padding:0 3px;border-radius:2px`;
      ov.appendChild(tag);
    }
    document.body.appendChild(ov);
    return { edges: lefts.size, smalls: smalls.length };
  });

  await page.screenshot({ path: `/tmp/overlay-${s.label}.png` });
  console.log(`${s.label}: ${info.edges} distinct left edges, ${info.smalls} sub-44px targets`);
  await ctx.close();
}
await b.close();
