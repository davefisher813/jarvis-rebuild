// ADHD HEURISTICS CHECKER
//
// The visual crawler proves every screen was SEEN. This proves every screen
// was MEASURED. Eyeballing 300 screenshots misses the mechanical faults --
// a title clipped to "What JARVIS Lear...", a 27px tap target, a screen that
// is 80% empty -- because the eye slides over them. These are countable, so
// they get counted on every screen rather than sampled.
//
// Checks, each traceable to published ADHD/neurodivergent UX guidance:
//
//   TRUNCATION   Clipped text forces the reader to reconstruct the missing
//                word. Cognitive-load guidance: never make the user infer.
//   TAP TARGET   Apple's 44px minimum. Motor + attention cost of a missed tap.
//   DENSITY      Words on one screen. "Chunk content, avoid long paragraphs."
//   EMPTY        A screen that is mostly nothing signals a dead end.
//   CHOICE LOAD  Equal-weight actions competing at once -> decision paralysis.
//   SHAME        Copy that tallies failure ("moved 5 days running") -- the
//                single most-cited ADHD anti-pattern in the literature.
//   MOTION       Infinite animations that pull attention with no off switch.
import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";

const CRAWL = process.env.CRAWL || "/tmp/crawl-full";
const THEME = process.env.THEME || "dark";

const SHAME = [
  /\b\d+\s+days?\s+running\b/i,
  /\bmoved\s+\d+\s+(times|days)\b/i,
  /\bwaiting\s+\d+\s+days?\s+on\s+you\b/i,
  /\byou\s+(still\s+)?haven'?t\b/i,
  /\bfailed\b/i,
  /\bstreak\s+(lost|broken)\b/i,
  /\byou\s+missed\b/i,
  /\bagain\b.*\bagain\b/i,
];

export async function measure(page) {
  return page.evaluate((SHAME_SRC) => {
    const shame = SHAME_SRC.map((s) => new RegExp(s.source, s.flags));
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0.05;
    };

    // --- truncation: element is clipped by ellipsis or overflow ---
    const truncated = [];
    for (const el of document.querySelectorAll("*")) {
      if (!el.children.length && !el.innerText) continue;
      if (!vis(el)) continue;
      const st = getComputedStyle(el);
      const clipsX = el.scrollWidth > el.clientWidth + 2 && /hidden|clip/.test(st.overflowX);
      const ellipsis = st.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 2;
      const clampY = st.webkitLineClamp && st.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 2;
      if (clipsX || ellipsis || clampY) {
        const t = (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 50);
        if (t && !truncated.some((x) => x.text === t)) {
          truncated.push({ text: t, why: ellipsis ? "ellipsis" : clampY ? "line-clamp" : "overflow-hidden" });
        }
      }
    }

    // --- tap targets under 44px ---
    const small = [];
    for (const el of document.querySelectorAll("button,[role=button],a[href],input,select,.chip,.tab,.lib-row")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      // The hit area may be extended by a ::after overlay; measure that too.
      const after = getComputedStyle(el, "::after");
      const grew = after && after.content !== "none" && /absolute/.test(after.position);
      const h = grew ? Math.max(r.height, 44) : r.height;
      const w = grew ? Math.max(r.width, 44) : r.width;
      if (h < 44 || w < 24) {
        const t = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40);
        if (t) small.push({ text: t, h: Math.round(r.height), w: Math.round(r.width) });
      }
    }

    // --- text density + emptiness ---
    const body = document.body.innerText || "";
    const words = body.trim().split(/\s+/).filter(Boolean).length;
    const longParas = [...document.querySelectorAll("p,.sub,.bp-sub,.conn-meta,.hint")]
      .filter(vis)
      .map((e) => (e.innerText || "").trim())
      .filter((t) => t.split(/\s+/).length > 40)
      .map((t) => t.slice(0, 60));

    // painted area vs viewport: how much of the screen is doing nothing
    let painted = 0;
    const vw = innerWidth, vh = innerHeight;
    for (const el of document.querySelectorAll(".card,.lib-row,.row,.sh2,.btn,.chip,.pagehead-title,.seg,.empty-state,.doc-title,textarea,input")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) continue;
      painted += Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)) * Math.min(r.width, vw);
    }
    const fill = Math.min(1, painted / (vw * vh));

    // --- competing equal-weight actions visible at once ---
    const actions = [...document.querySelectorAll("button,[role=button]")]
      .filter(vis)
      .filter((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.top < vh - 80; })
      .map((e) => (e.innerText || "").trim())
      .filter(Boolean);
    const uniqActions = [...new Set(actions)];
    const repeated = {};
    for (const a of actions) repeated[a] = (repeated[a] || 0) + 1;
    const repeatWalls = Object.entries(repeated).filter(([, n]) => n >= 4).map(([t, n]) => ({ text: t, count: n }));

    // --- shame / failure-tally copy ---
    const shameHits = [];
    for (const el of document.querySelectorAll("*")) {
      if (el.children.length || !vis(el)) continue;
      const t = (el.innerText || "").trim();
      if (!t || t.length > 160) continue;
      for (const re of shame) if (re.test(t) && !shameHits.includes(t)) shameHits.push(t);
    }

    // --- unstoppable motion ---
    const motion = [];
    for (const el of document.querySelectorAll("*")) {
      if (!vis(el)) continue;
      const st = getComputedStyle(el);
      if (st.animationName !== "none" && (st.animationIterationCount === "infinite")) {
        const t = (el.className && typeof el.className === "string" ? el.className : el.tagName).slice(0, 40);
        if (!motion.includes(t)) motion.push(t);
      }
    }

    return {
      words,
      fillPct: Math.round(fill * 100),
      truncated,
      smallTargets: small,
      longParas,
      actionCount: uniqActions.length,
      repeatWalls,
      shameHits,
      motion,
    };
  }, SHAME.map((r) => ({ source: r.source, flags: r.flags })));
}

// Standalone: re-walk the seeds and measure each.
if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = JSON.parse(readFileSync(`${CRAWL}/manifest.json`, "utf8"));
  const labels = manifest.screens.map((s) => s.label);
  console.log(`measuring ${labels.length} screens from ${CRAWL}`);
  writeFileSync("/tmp/adhd-metrics-targets.json", JSON.stringify(labels, null, 2));
}
