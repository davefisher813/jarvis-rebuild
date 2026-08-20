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
  // Go to the project itself: its task list is right there.
  await p.click('text="More"'); await p.waitForTimeout(700);
  await p.click('text="Bigger Picture"'); await p.waitForTimeout(1400);
  await p.click('text="Ship the App Store Launch"'); await p.waitForTimeout(1200);
  await p.click('text="Rebuild Bridge App"'); await p.waitForTimeout(1400);
  const rows = await p.evaluate(() => [...document.querySelectorAll(".task-row")].map(r=>r.textContent).slice(0,10));
  log.push("PROJ TASKS: " + JSON.stringify(rows));
  const h = await p.evaluateHandle(() => {
    const row = [...document.querySelectorAll(".task-row")].find(r => !r.className.includes("done"));
    return row?.querySelector(".task-check") || row;
  });
  const el = h.asElement();
  if (el) {
    await el.click();
    await p.waitForTimeout(230); await p.screenshot({ path: "/tmp/shots/burst.png" });
    await p.waitForTimeout(520); await p.screenshot({ path: "/tmp/shots/toast.png" });
    log.push("TOAST: " + JSON.stringify(await p.evaluate(() => document.querySelector(".toast")?.textContent)));
  } else log.push("no open task row on project page");
} catch (e) { log.push("FAILED " + e.message.slice(0,140)); }
console.log(log.join("\n"));
await b.close();
