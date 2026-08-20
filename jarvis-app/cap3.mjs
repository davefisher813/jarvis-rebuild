import { chromium } from "playwright";
const B = "http://localhost:4181/";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const log = [];
async function fresh() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const p = await ctx.newPage();
  p.on("pageerror", e => log.push("ERR " + String(e).slice(0,110)));
  await p.goto(B, { waitUntil: "networkidle" });
  try { await p.click('text="Skip for now"', { timeout: 3500 }); } catch {}
  await p.waitForTimeout(2600);
  return p;
}
const shot = (p, n) => p.screenshot({ path: `/tmp/shots/${n}.png` }).then(() => log.push("shot " + n));

try {
  const p = await fresh();
  await p.click('text="More"'); await p.waitForTimeout(700);
  await p.click('text="Bigger Picture"'); await p.waitForTimeout(1600);
  const names = await p.evaluate(() => [...document.querySelectorAll(".proj-name, .conn-name, .bp-name")].map(e=>e.textContent).slice(0,10));
  log.push("BP: " + JSON.stringify(names));
  await shot(p, "bigger");
  // open the first project
  const target = names.find(n => /Bridge|Rebuild|Golf|Website|Cookout/.test(n||"")) || names[0];
  if (target) { await p.click(`text=${JSON.stringify(target)}`); await p.waitForTimeout(1400); }
  await shot(p, "project-detail");
  const has = await p.evaluate(() => [...document.querySelectorAll("button")].map(x=>x.textContent).filter(Boolean));
  log.push("BUTTONS: " + JSON.stringify(has.slice(0,14)));
  if (has.some(t=>/Mark Done/.test(t))) {
    await p.click('text="Mark Done"'); await p.waitForTimeout(1200);
    await shot(p, "payoff");
  }
} catch (e) { log.push("dopamine FAILED " + e.message.slice(0,120)); }
console.log(log.join("\n"));
await b.close();
