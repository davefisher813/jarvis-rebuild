import { chromium } from "playwright";
const B = "http://localhost:4183/";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const log = [];
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const p = await ctx.newPage();
p.on("pageerror", e => log.push("ERR " + String(e).slice(0,110)));
await p.goto(B, { waitUntil: "networkidle" });
try { await p.click('text="Skip for now"', { timeout: 3500 }); } catch {}
await p.waitForTimeout(2600);
try {
  await p.click('text="Tasks"'); await p.waitForTimeout(1200);
  const chips = await p.evaluate(() => [...document.querySelectorAll(".chip,.seg,.filter-chip")].map(e=>e.textContent));
  log.push("CHIPS: " + JSON.stringify(chips));
  for (const f of ["Upcoming · 11","Upcoming"]) {
    const el = await p.$(`text="${f}"`); if (el) { await el.click(); await p.waitForTimeout(900); log.push("filter " + f); break; }
  }
  const names = await p.evaluate(() => [...document.querySelectorAll(".task-row")].map(r=>r.textContent?.slice(0,40)));
  log.push("ROWS: " + JSON.stringify(names.slice(0,16)));
  const h = await p.evaluateHandle(() => {
    const row = [...document.querySelectorAll(".task-row")].find(r => r.textContent?.includes("Send Thank-You Notes"));
    return row?.querySelector(".task-check") || row;
  });
  const el = h.asElement();
  log.push("found last-one task: " + !!el);
  if (el) {
    await el.click();
    await p.waitForTimeout(200); await p.screenshot({ path: "/tmp/shots/burst.png" });
    await p.waitForTimeout(560); await p.screenshot({ path: "/tmp/shots/finish-it.png" });
    log.push("TOAST: " + JSON.stringify(await p.evaluate(() => document.querySelector(".toast")?.textContent)));
  }
} catch (e) { log.push("FAILED " + e.message.slice(0,140)); }
console.log(log.join("\n"));
await b.close();
