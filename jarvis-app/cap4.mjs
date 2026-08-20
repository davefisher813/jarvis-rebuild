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
  await p.click('text="Bigger Picture"'); await p.waitForTimeout(1500);
  await p.click('text="Ship the App Store Launch"'); await p.waitForTimeout(1400);
  await shot(p, "goal-detail");
  const names = await p.evaluate(() => [...document.querySelectorAll(".conn-name,.bp-name,.proj-name")].map(e=>e.textContent).slice(0,12));
  log.push("GOAL PAGE: " + JSON.stringify(names));
  const proj = names.find(n=>/Rebuild Bridge App/.test(n||""));
  if (proj) { await p.click(`text=${JSON.stringify(proj)}`); await p.waitForTimeout(1400); await shot(p, "project-detail"); }
  const btns = await p.evaluate(() => [...document.querySelectorAll("button")].map(x=>x.textContent).filter(Boolean));
  log.push("BUTTONS: " + JSON.stringify(btns.slice(0,14)));
  if (btns.some(t=>/Mark Done/.test(t||""))) {
    await p.click('text="Mark Done"'); await p.waitForTimeout(1400);
    await shot(p, "payoff");
  }
} catch (e) { log.push("FAILED " + e.message.slice(0,120)); }
console.log(log.join("\n"));
await b.close();
