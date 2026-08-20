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
  await p.click('text="Tasks"'); await p.waitForTimeout(1500);
  const rows = await p.evaluate(() => [...document.querySelectorAll(".task-row .conn-name, .task-name, .task-row")].map(e=>e.textContent).slice(0,12));
  log.push("TASKS: " + JSON.stringify(rows));
  // tick the first checkbox
  const boxes = await p.$$(".task-check, [role='checkbox']");
  log.push("boxes=" + boxes.length);
  if (boxes.length) { await boxes[0].click(); await p.waitForTimeout(260); await p.screenshot({ path:"/tmp/shots/burst.png" }); await p.waitForTimeout(500); await p.screenshot({ path: "/tmp/shots/toast.png" }); log.push("shot toast"); }
  const toast = await p.evaluate(() => document.querySelector(".toast")?.textContent);
  log.push("TOAST: " + JSON.stringify(toast));
} catch (e) { log.push("FAILED " + e.message.slice(0,120)); }
console.log(log.join("\n"));
await b.close();
