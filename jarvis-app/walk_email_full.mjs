// LIVE WALK of the email tab, against the bench (fake Gmail + scripted AI).
//
// The static checks cannot see a dead end, a receipt that never renders, a
// control that offers nothing, or a screen with no way out. This walks the
// path a person actually takes and asserts what they SEE at each step.
//
// Run: node walk_email_full.mjs   (vite dev server started by the caller)
import { chromium } from "playwright";

const URL = process.env.WALK_URL || "http://localhost:5173/bench-email.html";
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push((ok ? "PASS  " : "FAIL  ") + name + (ok || !detail ? "" : "   <- " + detail));
  if (!ok) failed++;
}

const txt = async (page) => (await page.locator("body").innerText()).replace(/ /g, " ");
const has = (body, s) => body.toLowerCase().includes(s.toLowerCase());

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
// /api/* are Vercel functions and do not exist under the dev server. Open
// tracking failing here is the bench being a bench, not a defect; the app is
// built so a dead tracker never breaks anything.
const EXPECTED_404 = /\/api\//;
page.on("requestfailed", (r) => { if (!EXPECTED_404.test(r.url())) errors.push("REQ " + r.url()); });
page.on("response", (r) => { if (r.status() === 404 && !EXPECTED_404.test(r.url())) errors.push("404 " + r.url()); });

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  // ---- connect ----
  // EXACT match: "Connect Google to read and send email here." contains the
  // button's label as a substring, and .first() grabbed the description.
  await page.getByText("Connect Google", { exact: true }).click();
  await page.waitForTimeout(1200);
  let body = await txt(page);

  // ---- the fold ----
  check("headline counts only what needs him", /needs you/i.test(body) && !/unread/i.test(body), body.slice(0, 80));
  check("Needs You section renders", has(body, "Needs You"));
  check("the fold collapses everything else to one line", /The rest · \d+/.test(body), body.match(/The rest[^\n]*/)?.[0] || "no fold");
  check("Worth Knowing is NOT loose on the page", !has(body, "Worth Knowing"));
  check("Noise is NOT loose on the page", !has(body, "Noise"));

  // ---- real deadlines ----
  check("a stated deadline shows on the row", has(body, "Friday") || has(body, "Aug 12"),
    "no deadline text found");
  const order = ["today", "friday", "aug 12"].map((d) => body.toLowerCase().indexOf(d));
  check("deadlines sort soonest first", order[0] >= 0 && order[0] < order[1], "order: " + order.join(","));

  // ---- the fold opens in place ----
  await page.getByText(/The rest · \d+/).click();
  await page.waitForTimeout(300);
  body = await txt(page);
  check("expanding the fold reveals Worth Knowing", has(body, "Worth Knowing"));
  check("noise inside the fold stays collapsed to a count", /\d+ automated emails?/.test(body));
  check("Archive All is offered with the noise", has(body, "Archive All"));
  await page.getByText(/The rest · \d+/).click();
  await page.waitForTimeout(250);
  check("the fold closes again", !has(await txt(page), "Worth Knowing"));

  // ---- the drain: HE sets the timer ----
  await page.getByText("Only have a few minutes?").click();
  await page.waitForTimeout(250);
  body = await txt(page);
  check("the drain offers presets", has(body, "2 min") && has(body, "5 min") && has(body, "10 min"));
  check("the drain accepts his own number", await page.locator('input[aria-label="Minutes"]').count() === 1);
  check("the drain has a start", has(body, "Start the drain"));

  // ---- open a thread: brief, no wall, actions ----
  await page.getByText("Coach Tucci", { exact: true }).first().click();
  await page.waitForTimeout(1200);
  body = await txt(page);
  check("thread opens with a summary", has(body, "JARVIS Summary"));
  check("the summary has real words in it", /waiver/i.test(body));
  check("quick replies came from the brief", has(body, "Sending it tonight"));
  check("reply and forward are offered", has(body, "Reply") && has(body, "Forward"));
  check("mute is offered", has(body, "Mute this thread"));
  check("delete is reachable from the thread", await page.locator('[aria-label="Delete"]').count() > 0);

  // ---- hand off ----
  await page.getByText("Hand this to someone").click();
  await page.waitForTimeout(400);
  body = await txt(page);
  check("hand off opens a people picker", has(body, "Hand This To"));
  check("hand off can be backed out of", has(body, "Never mind"));
  await page.getByText("Never mind").click();
  await page.waitForTimeout(200);

  // ---- back out, then the deck ----
  await page.getByText("Email", { exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.getByText(/Deal With It · \d+/).click();
  await page.waitForTimeout(1400);
  body = await txt(page);
  check("the deck prepares a decision, not a blank card", /prepared|ready|why|reply/i.test(body), body.slice(0, 120));
  check("the deck says what it wants him to do", /Send|Pay|Add|Archive/i.test(body));
  check("the deck can be left", has(body, "Email"));

  // ---- landing after the deck: no dead end ----
  for (let i = 0; i < 6; i++) {
    const send = page.getByText(/^(Send & Next|Add to Schedule|Add the Bill|Archive)/).first();
    if (await send.count() === 0) break;
    await send.click();
    await page.waitForTimeout(900);
  }
  body = await txt(page);
  const landed = has(body, "Inbox: dead") || has(body, "handled") || has(body, "Needs You") || has(body, "Email");
  check("finishing the deck LANDS somewhere, never a blank screen", landed, body.slice(0, 120));
  if (has(body, "Inbox: dead")) {
    check("the payoff screen has a way out", has(body, "Back to Email"));
    check("the receipt states what was handled", /\d+ handled/.test(body));
  }

  check("no uncaught errors during the walk", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
  check("walk completed without throwing", false, String(e).slice(0, 200));
} finally {
  await browser.close();
}

console.log(results.join("\n"));
console.log("\n" + (failed === 0 ? "ALL " + results.length + " CHECKS PASSED" : failed + " of " + results.length + " FAILED"));
process.exit(failed === 0 ? 0 : 1);
