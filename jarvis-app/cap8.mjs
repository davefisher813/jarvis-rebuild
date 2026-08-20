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
  await p.click('text="Tasks"'); await p.waitForTimeout(1400);
  const h = await p.evaluateHandle(() => {
    const row = [...document.querySelectorAll(".task-row")].find(r => r.textContent?.includes("Draft the Coach Onboarding Email"));
    return row?.querySelector(".task-check") || row;
  });
  const el = h.asElement();
  log.push("found: " + !!el);
  if (el) {
    await el.click();
    await p.waitForTimeout(220); await p.screenshot({ path: "/tmp/shots/burst.png" });
    await p.waitForTimeout(520); await p.screenshot({ path: "/tmp/shots/toast.png" });
    log.push("TOAST: " + JSON.stringify(await p.evaluate(() => document.querySelector(".toast")?.textContent)));
  }
} catch (e) { log.push("FAILED " + e.message.slice(0,140)); }
console.log(log.join("\n"));
await b.close();
