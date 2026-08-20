import { chromium } from "playwright";
const B = "http://localhost:4181/";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const log = [];

async function fresh(init) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const p = await ctx.newPage();
  p.on("pageerror", e => log.push("ERR " + String(e).slice(0,110)));
  if (init) await ctx.addInitScript(init);
  await p.goto(B, { waitUntil: "networkidle" });
  try { await p.click('text="Skip for now"', { timeout: 3500 }); } catch {}
  await p.waitForTimeout(2600);
  return p;
}
const shot = (p, n) => p.screenshot({ path: `/tmp/shots/${n}.png` }).then(() => log.push("shot " + n));

// ---- UNDO SEND ----
try {
  const p = await fresh();
  await p.click('text="More"'); await p.waitForTimeout(700);
  await p.click('text="Email"'); await p.waitForTimeout(1600);
  await p.click('[aria-label="New Message"]'); await p.waitForTimeout(900);
  await p.fill('input[placeholder="To"]', "wei@bffsa.org");
  await p.fill('input[placeholder="Subject"]', "Invoice, signed");
  await p.fill('textarea', "Signed and sent back this morning. Net 15 from Monday works.");
  await p.waitForTimeout(300);
  await p.click('text="Send"'); await p.waitForTimeout(900);
  await shot(p, "undo-send");
} catch (e) { log.push("undosend FAILED " + e.message.slice(0,110)); }

// ---- EMAIL WINDOWS CURTAIN ----
try {
  // hours far from "now" so the curtain is definitely closed
  const h = new Date().getHours();
  const closed = [ (h+3)%24, (h+6)%24, (h+9)%24 ].sort((a,b)=>a-b);
  const p = await fresh(`localStorage.setItem("jarvis.mail.windows.v1", ${JSON.stringify(JSON.stringify({on:true,hours:closed}))});`);
  await p.click('text="More"'); await p.waitForTimeout(700);
  await p.click('text="Email"'); await p.waitForTimeout(1600);
  await shot(p, "windows");
} catch (e) { log.push("windows FAILED " + e.message.slice(0,110)); }

console.log(log.join("\n"));
await b.close();
