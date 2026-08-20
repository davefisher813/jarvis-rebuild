import { chromium } from "playwright";
const B = "http://localhost:4180/";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const p = await ctx.newPage();
const log = [];
p.on("pageerror", e => log.push("ERR " + e));

async function boot() {
  await p.goto(B, { waitUntil: "networkidle" });
  try { await p.click('text="Skip for now"', { timeout: 3500 }); } catch {}
  await p.waitForTimeout(2600);
}
const shot = async (name) => { await p.screenshot({ path: `/tmp/shots/${name}.png` }); log.push("shot " + name); };

await boot();

// ---------- 1. EDITORIAL NOTES ----------
try {
  await p.click('text="More"'); await p.waitForTimeout(800);
  await p.click('text="Notes"'); await p.waitForTimeout(1600);
  const first = await p.evaluate(() => document.querySelector(".lib-name, .conn-name")?.textContent);
  await p.click(`text=${JSON.stringify(first)}`); await p.waitForTimeout(1400);
  // make sure editorial is ON
  const on = await p.evaluate(() => !!document.querySelector(".doc-editorial"));
  if (!on) { await p.click('[aria-label="Editorial layout"]'); await p.waitForTimeout(600); }
  await shot("editorial");
  // and the plain version for contrast
  await p.click('[aria-label="Leave editorial layout"]'); await p.waitForTimeout(600);
  await shot("plain");
  await p.click('[aria-label="Editorial layout"]'); await p.waitForTimeout(400);
} catch (e) { log.push("editorial FAILED " + e.message.slice(0,90)); }

// ---------- 2. UNDO SEND ----------
try {
  await boot();
  await p.click('text="More"'); await p.waitForTimeout(700);
  await p.click('text="Email"'); await p.waitForTimeout(1800);
  await shot("email-tab");
} catch (e) { log.push("email FAILED " + e.message.slice(0,90)); }

console.log(log.join("\n"));
await b.close();
