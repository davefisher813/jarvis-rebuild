import { chromium } from "playwright";
const B = "http://localhost:4181/";
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
  // widen the filter so project tasks with later dates show
  for (const f of ["All","Everything","Upcoming"]) {
    const el = await p.$(`text="${f}"`); if (el) { await el.click(); await p.waitForTimeout(900); log.push("filter " + f); break; }
  }
  const target = "Send Thank-You Notes";
  const el = await p.$(`text=${JSON.stringify(target)}`);
  log.push("found target: " + !!el);
  if (el) {
    const box = await p.evaluateHandle((t) => {
      const row = [...document.querySelectorAll(".task-row")].find(r => r.textContent?.includes(t));
      return row?.querySelector(".task-check") || row;
    }, target);
    await box.asElement().click();
    await p.waitForTimeout(240); await p.screenshot({ path: "/tmp/shots/burst.png" });
    await p.waitForTimeout(520);
    await p.screenshot({ path: "/tmp/shots/toast.png" });
    log.push("TOAST: " + JSON.stringify(await p.evaluate(() => document.querySelector(".toast")?.textContent)));
  }
} catch (e) { log.push("FAILED " + e.message.slice(0,140)); }
console.log(log.join("\n"));
await b.close();
