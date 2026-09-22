import { chromium } from "playwright";
import { writeFileSync } from "fs";

// THE VISUAL AUDITOR. Three visual bugs shipped past a green test suite in
// three rounds (an arc drawn in an undefined colour, a stream stacked flush,
// and a reset that zeroed itself). All three were geometry, and tests do not
// look at geometry. This measures it.
const AUDIT = () => {
  const out = [];
  const vw = window.innerWidth;
  const seen = new Set();
  const add = (kind, detail, el) => {
    const k = kind + "|" + detail;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ kind, detail, cls: (el?.className || "").toString().slice(0, 60) });
  };
  const inFixed = (e) => {
    let n = e;
    while (n && n !== document.body) {
      if (getComputedStyle(n).position === "fixed") return true;
      n = n.parentElement;
    }
    return false;
  };
  const vis = (e) => {
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // A rect CLIPPED by an ancestor is not where the user can touch it. The
  // Your Day ticker scrolls its rows under overflow:hidden, so a row can be
  // geometrically over the button above it while being invisible and
  // untappable. Judging raw rects invents overlaps that do not exist.
  const clipped = (e) => {
    let r = e.getBoundingClientRect();
    let n = e.parentElement;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (["hidden", "auto", "scroll", "clip"].includes(cs.overflow) ||
          ["hidden", "auto", "scroll", "clip"].includes(cs.overflowY) ||
          ["hidden", "auto", "scroll", "clip"].includes(cs.overflowX)) {
        const p = n.getBoundingClientRect();
        const top = Math.max(r.top, p.top), bottom = Math.min(r.bottom, p.bottom);
        const left = Math.max(r.left, p.left), right = Math.min(r.right, p.right);
        r = { top, bottom, left, right, width: right - left, height: bottom - top };
        if (r.width <= 0 || r.height <= 0) return null;
      }
      n = n.parentElement;
    }
    return r;
  };
  // WHEN A LAYER IS UP, THE PAGE UNDER IT IS NOT THE SUBJECT (2026-09-20).
  // Auditing inside sheets immediately produced 63 "overlap" findings that
  // were not overlaps at all: What Now paints over Today, so its "Back to
  // Today" button sat on top of Today's weather notice and the detector
  // compared the two as if a thumb could reach both. The same contamination
  // inflated every other check -- Today's avatar was being measured as a
  // small target "inside" five different sheets.
  //
  // A modal layer is the whole subject while it is up: the page beneath
  // cannot be tapped, read or truncated by the user. So the audit scopes to
  // it, and the page underneath is measured when it is the thing on screen,
  // which it is on its own pass.
  const modalRoot = (() => {
    const area = window.innerWidth * window.innerHeight;
    const named = document.querySelector(".sheet, [role=dialog], .modal");
    if (named) { const r = named.getBoundingClientRect(); if (r.width >= 40 && r.height >= 40) return named; }
    for (const e of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(e);
      if (cs.position !== "fixed" && cs.position !== "absolute") continue;
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.2) continue;
      if (e.closest(".tab-bar, .voice-dock")) continue;
      const r = e.getBoundingClientRect();
      if (r.width * r.height < area * 0.33) continue;
      if (r.top > window.innerHeight * 0.8) continue;
      return e;
    }
    return null;
  })();
  const ROOT = modalRoot || document.body;
  const all = [...ROOT.querySelectorAll("*")].filter(vis).filter((e) => clipped(e));

  // 1. HORIZONTAL OVERFLOW. The page must never scroll sideways.
  for (const e of all) {
    const r = e.getBoundingClientRect();
    if (r.right > vw + 1.5 || r.left < -1.5) {
      const cs = getComputedStyle(e);
      if (cs.position === "fixed") continue;
      // A deliberately scrollable strip is allowed to exceed its own box.
      let p = e.parentElement, scroller = false;
      while (p && p !== document.body) {
        const px = getComputedStyle(p).overflowX;
        if (px === "auto" || px === "scroll") { scroller = true; break; }
        p = p.parentElement;
      }
      if (scroller) continue;
      if (inFixed(e)) continue;
      add("overflow-x", `${e.tagName.toLowerCase()}.${(e.className||"").toString().split(" ")[0]} right=${Math.round(r.right)} vw=${vw}`, e);
    }
  }

  // 2. TRUNCATED TEXT. A label clipped mid-word is information thrown away.
  //
  // scrollWidth IS BLIND TO A FLEX ITEM THAT SHRANK (2026-09-21). A block of
  // a fixed width lays its text out at the text's natural width and overflows,
  // so scrollWidth exceeds clientWidth and this check sees it. A FLEX ITEM
  // that lost a shrink fight has a smaller content box, and the text is laid
  // out at THAT width, so scrollWidth comes back equal to clientWidth and the
  // check sees nothing. Measured on the New Reminder sheet at --type-scale
  // 1.4: the bar title paints "New Remind..." and reports scrollWidth 196
  // against clientWidth 195. A Range over the text node agrees with
  // scrollWidth exactly, because both describe the post-ellipsis layout.
  // Neither instrument can see the string that was thrown away.
  //
  // So measure the string on its own. A clone, off-screen, at max-content,
  // carrying only the properties that decide how wide text is, gives the
  // width the label WANTED. One shared host, removed at the end, and only for
  // the nowrap elements scrollWidth already gave up on.
  const ruler = document.createElement("div");
  ruler.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;white-space:nowrap;width:max-content";
  document.body.appendChild(ruler);
  const natural = (e, cs) => {
    ruler.textContent = e.textContent || "";
    // The `font` SHORTHAND comes back as an empty string from
    // getComputedStyle in Chromium for most elements, which silently left the
    // ruler measuring at the default 16px and reporting nothing. The
    // longhands are always populated.
    ruler.style.fontFamily = cs.fontFamily;
    ruler.style.fontSize = cs.fontSize;
    ruler.style.fontWeight = cs.fontWeight;
    ruler.style.fontStyle = cs.fontStyle;
    ruler.style.fontStretch = cs.fontStretch;
    ruler.style.letterSpacing = cs.letterSpacing;
    ruler.style.wordSpacing = cs.wordSpacing;
    ruler.style.textTransform = cs.textTransform;
    ruler.style.fontVariantNumeric = cs.fontVariantNumeric;
    return ruler.getBoundingClientRect().width;
  };
  for (const e of all) {
    if (e.children.length > 0) continue;
    const txt = (e.textContent || "").trim();
    if (!txt) continue;
    const cs = getComputedStyle(e);
    if (cs.textOverflow !== "ellipsis" && cs.overflow !== "hidden") continue;
    let want = e.scrollWidth;
    // Only ask the ruler when scrollWidth has nothing to say AND the text is
    // on one line, which is the shape the blind spot has.
    if (want <= e.clientWidth + 1 && cs.whiteSpace.startsWith("nowrap")) want = natural(e, cs);
    // Ellipsis is a legitimate pattern; losing a quarter of the string is
    // not. Flag by how much is actually hidden, so a secondary hint clipping
    // two characters does not bury a task name clipping a third of itself.
    const lost = (want - e.clientWidth) / Math.max(1, want);
    if (lost > 0.15) {
      add("truncated", `"${txt.slice(0,34)}" loses ${Math.round(lost*100)}%`, e);
    }
  }
  ruler.remove();

  // 2b. TEXT THAT ESCAPES ITS OWN BOX (2026-09-21). The gap that let two real
  // bugs ship past twelve clean passes on the same day.
  //
  // `truncated` above needs `overflow: hidden` or an ellipsis before it will
  // look at anything, because it measures scrollWidth against clientWidth and
  // those are equal on a box that does not clip. So a string with NEITHER --
  // one that simply grows past the box it sits in and paints on top of
  // whatever is there -- was invisible to this tool by construction. Both of
  // the day's bugs were exactly that:
  //
  //   the capture bar   "Add anything" had no min-width and no nowrap, so at
  //                     --type-scale 1.4 it wrapped to two lines and painted
  //                     across the JARVIS wordmark and out past the pill.
  //   the Tracker tabs  "Subscriptions" ran off the right of a segmented
  //                     control with nothing saying more existed.
  //
  // THE BOX IS THE PAINTED ONE. "Its box" cannot mean its parent -- half the
  // spans in this app sit in a bare <div> with no background, and escaping
  // one of those is what normal text flow looks like. The box a reader SEES
  // is the nearest ancestor that paints a background, which is the pill, the
  // card, the track. Text outside that is text outside the thing it belongs
  // to, and it is a bug every time.
  //
  // A SCROLLER IS NOT A BOX THAT WAS ESCAPED. Content outside a scroller is
  // the entire point of a scroller, so the walk stops at the first scrollable
  // ancestor and reports nothing. Whether a scrolling row SAYS it scrolls is
  // a different question, answered by the edge fade, and whether the keyboard
  // can reach into one is answered by FOCUS=1's focus-unscrolled.
  const painted = (cs) => {
    const bg = cs.backgroundColor;
    if (!bg || bg === "transparent") return false;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    if (!m) return false;
    const parts = m[1].split(",").map((n) => parseFloat(n));
    return parts.length < 4 || parts[3] > 0.02;
  };
  for (const e of all) {
    if (e.children.length > 0) continue;
    const txt = (e.textContent || "").trim();
    if (!txt) continue;
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    let n = e.parentElement;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      if ([cs.overflow, cs.overflowX, cs.overflowY].some((v) => v === "auto" || v === "scroll")) break;
      if (painted(cs)) {
        const p = n.getBoundingClientRect();
        // Sub-pixel and the odd descender are not an escape; a character is.
        const out = Math.max(p.left - r.left, r.right - p.right, p.top - r.top, r.bottom - p.bottom);
        if (out > 4) {
          add("outside-box", `"${txt.slice(0,30)}" paints ${Math.round(out)}px outside .${(n.className||"").toString().split(" ")[0] || n.tagName.toLowerCase()}`, e);
        }
        break;
      }
      n = n.parentElement;
    }
  }

  // 3. OVERLAPPING TAP TARGETS. Two controls sharing pixels means hitting
  //    the wrong one, which is worse than ugly.
  const tappable = all.filter((e) => {
    if (e.tagName === "BUTTON" || e.getAttribute("role") === "button") return true;
    return ["INPUT", "SELECT", "TEXTAREA", "A"].includes(e.tagName);
  });
  for (let i = 0; i < tappable.length; i++) {
    for (let j = i + 1; j < tappable.length; j++) {
      const a = tappable[i], c = tappable[j];
      if (a.contains(c) || c.contains(a)) continue;
      // A swipe rail sits deliberately behind its row. Same container, by
      // design, and not a stacked tap target.
      const SWIPE = ".task-swipe, .notice-swipe, .sched-swipe-wrap";
      if (a.closest(SWIPE) && a.closest(SWIPE) === c.closest(SWIPE)) continue;
      // App chrome sits in normal flow at the edges of the shell and content
      // scrolls behind it BY DESIGN. Content passing under the capture bar is
      // not a stacked tap target; that is what the under-bar check is for.
      // .toast-dock joined the list 2026-09-21. A toast is a LAYER: it lands
      // over whatever is under it, says one thing, and leaves after five
      // seconds. Pairing its Undo with the row it happens to cover reports
      // the pattern working as designed -- and it reported a different row on
      // every screen a toast could appear on, which is noise with no fix
      // behind it. Whether the toast is reachable is the under-bar check's
      // question, and it answers it.
      const CHROME = ".voice-dock, .tab-bar, .pagebar, .nav-bar, .sheet-scrim, .toast-dock";
      if (!!a.closest(CHROME) !== !!c.closest(CHROME)) continue;
      if (inFixed(a) || inFixed(c)) continue;
      const ra = clipped(a), rc = clipped(c);
      if (!ra || !rc) continue;
      const ox = Math.min(ra.right, rc.right) - Math.max(ra.left, rc.left);
      const oy = Math.min(ra.bottom, rc.bottom) - Math.max(ra.top, rc.top);
      if (ox > 2 && oy > 2) {
        add("overlap", `"${(a.textContent||"").trim().slice(0,18)}" x "${(c.textContent||"").trim().slice(0,18)}"`, a);
      }
    }
  }

  // 4. TAP TARGETS BELOW THE 44px MINIMUM (Apple HIG).
  // Measure the HIT AREA, not the paint. A control may be 19px of type with
  // a ::after that expands the touch target to 45; reporting the paint rect
  // calls a fixed control broken forever. elementFromPoint is the truth.
  // 24, not 44. Apple's own segmented control is 32px and full-width rows at
  // 30-36 are trivially hittable; flagging those is noise that buries the
  // real ones. This catches genuinely broken targets.
  // TWO TIERS (BROWSER-F-07, 2026-09-05). 24 was chosen so the report would
  // not drown in Apple's own 32px segmented control, and it worked: it kept
  // the noise down. It also meant the tool could never say what the browser
  // walk of 2026-09-05 said, which is that 162 row-action pills, 263 chips
  // and 227 dropdown values sit under the HIG's actual 44. Both numbers now
  // come out, under different names, so the 24s stay findable at the top of
  // the report and the 44s are countable underneath instead of invisible.
  //   small-target  under 24: genuinely broken, a thumb misses it
  //   small-44      under 44: under the HIG minimum Apple checks at review
  //
  // THE LADDER, NOT THE FLAT 44 (Dave 2026-09-20, settling the catalog's own
  // contradiction: H0 says chips 28 and capsules 34, and a line in H1 said
  // "44pt minimum hit targets"). small-44 was reporting 77 controls and 56 of
  // them were sitting at exactly the height the catalog specifies, so the one
  // number that mattered was buried under the app working as designed.
  //
  // A control is now measured against ITS OWN RUNG. Under 44 by the ladder is
  // a decision, not a defect, and the room is bought back with an expanded hit
  // area. Under its rung is the app disagreeing with its own catalog, which is
  // exactly what an auditor is for. A control with no rung yet keeps the old
  // small-44 line, so nothing goes quiet by being unrecognised.
  const MIN = 24;
  const HIG = 44;
  // Catalog H0: chips 28, capsules 34, fields and rows and bar actions 44,
  // buttons 50. First match wins, so the narrower class is listed first.
  const RUNGS = [
    [/(^| )(chip|uchip)( |$)/, 28, "chip"],
    // C1 names these as capsules by name: the row-action pill, the head
    // action (See All, Open Inbox, Schedule, Add), the small pill, the
    // segmented control's segment (34 by X0), and the dropdown value.
    [/(^| )(pill-act|pill-action|see-all|btn-sm|seg|dd-lead)( |$)/, 34, "capsule"],
    // INLINE ACTION, 24 (Dave's call 2026-09-21, the ladder's fourth rung).
    // The Match shortcut under a set chip ("Last: 275 lb x 5  Match") is a
    // line of text that logs a set, and a line of text is 16px tall. It
    // cannot be 44: one pixel separates it from the weight and reps fields
    // above, which are targets of their own, so reaching for 44 would trade
    // one small target for two stacked ones. It takes eight pixels of the
    // ghost row's own spare padding instead, which is the 24px floor with
    // five to spare, and the rung says that is the answer rather than
    // leaving the auditor to report a decision as a defect for ever.
    [/(^| )(set-last-act)( |$)/, 24, "inline action"],
  ];
  const rungOf = (cls) => RUNGS.find(([re]) => re.test(" " + cls + " "));
  // A CONTROL A ROW FORWARDS TO IS AS BIG AS THE ROW (2026-09-21). Eleven
  // sheets use FormSheet's Row, which passes its own taps to the control it
  // names so that the label, the tile and the empty space between them all
  // open the menu or flip the switch -- iOS's grouped table, and the thing
  // every sheet in this app failed to do until SHARED-F-11. The auditor could
  // not see it, because forwardTo is a React prop: it measured a 220x24
  // dropdown value, found a thumb 9px below it landing on .row, and called
  // the target too small. It was right about the pixels and wrong about the
  // app. Row now writes the selector into data-forwards, so the real target
  // resolves here the same way the pointer handler resolves it.
  const forwarder = (e) => {
    let n = e.parentElement;
    while (n && n !== document.body) {
      const sel = n.getAttribute && n.getAttribute("data-forwards");
      if (sel) { try { if (n.querySelector(sel) === e) return n; } catch { /* bad selector */ } }
      n = n.parentElement;
    }
    return null;
  };
  for (const e of tappable) {
    // The NATURAL height, not the clipped one. A 46px row scrolled so that
    // 5px of it shows is not a small target, it is a scrolled row.
    const r = (forwarder(e) || e).getBoundingClientRect();
    const txt = (e.textContent || "").trim();
    if (!txt || r.height >= HIG) continue;
    if (r.top < 0 || r.bottom > window.innerHeight) continue; // off-screen: cannot hit-test
    const cx = r.left + r.width / 2;
    const own = forwarder(e) || e;
    const hits = (y) => { const t = document.elementFromPoint(cx, y); return t === own || own.contains(t); };
    // Measure the HIT, once, at the widest bar, then report it against
    // whichever bar it actually fails.
    const reaches = (min) => {
      if (r.height >= min) return true;
      const need = (min - r.height) / 2;
      return hits(r.top - need + 1) && hits(r.bottom + need - 1);
    };
    const size = `${Math.round(r.width)}x${Math.round(r.height)}`;
    if (!reaches(MIN)) { add("small-target", `"${txt.slice(0,24)}" hit ${size}, needs ${MIN}`, e); continue; }
    const rung = rungOf(typeof e.className === "string" ? e.className : "");
    if (rung) {
      // The rung is a PAINT spec (a chip is 28 tall), so it is checked against
      // the painted box. The hit is the ladder's own business: a rung under 44
      // is signed off precisely because the touch area is expanded past it.
      const [, tall, name] = rung;
      if (r.height + 0.5 < tall) {
        add("below-rung", `"${txt.slice(0,24)}" is ${size}, the ${name} rung is ${tall}`, e);
      }
      continue;
    }
    if (!reaches(HIG)) add("small-44", `"${txt.slice(0,24)}" hit ${size}, needs ${HIG} (no rung assigned)`, e);
  }

  // 5. INVISIBLE TEXT. Same colour as what is behind it. This is the class
  //    of bug that shipped the arc drawn in an undefined custom property.
  // Composite the real stack. A chip is rgba(255,255,255,0.06) over black,
  // which is nearly black; reading the raw declaration calls white text on it
  // invisible, which is how a detector invents 40 bugs that do not exist.
  const parse = (c) => {
    const m = (c || "").match(/[\d.]+/g);
    if (!m) return null;
    return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 };
  };
  const bgOf = (e) => {
    const layers = [];
    let n = e;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; }
      n = n.parentElement;
    }
    // The base is the DOCUMENT's own background, not black. Hardcoding black
    // here is correct in dark theme and completely wrong in light, where the
    // page sits on #F2F2F7: every translucent layer composites against the
    // wrong floor and the whole check reports fiction (2026-08-21, when the
    // audit first ran in light).
    layers.push(parse(getComputedStyle(document.body).backgroundColor)?.a === 1
      ? parse(getComputedStyle(document.body).backgroundColor)
      : parse(getComputedStyle(document.documentElement).backgroundColor)?.a === 1
        ? parse(getComputedStyle(document.documentElement).backgroundColor)
        : { r: 0, g: 0, b: 0, a: 1 });
    let out = layers[layers.length - 1];
    for (let i = layers.length - 2; i >= 0; i--) {
      const t = layers[i];
      out = {
        r: t.r * t.a + out.r * (1 - t.a),
        g: t.g * t.a + out.g * (1 - t.a),
        b: t.b * t.a + out.b * (1 - t.a),
        a: 1,
      };
    }
    return `rgb(${Math.round(out.r)}, ${Math.round(out.g)}, ${Math.round(out.b)})`;
  };
  const lum = (c) => {
    const m = c.match(/[\d.]+/g);
    if (!m) return null;
    const [r, g, bl] = m.map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  // Real WCAG relative luminance, for the contrast ratio below. The simple
  // weighted average above is fine for "is this the same colour as that",
  // and useless for "can a person read it": sRGB is gamma-encoded, so the
  // linearisation matters as soon as the question is legibility.
  const srgb = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const rel = (c) => {
    const m = (c || "").match(/[\d.]+/g);
    if (!m) return null;
    return 0.2126 * srgb(+m[0]) + 0.7152 * srgb(+m[1]) + 0.0722 * srgb(+m[2]);
  };
  // ALPHA MATTERS. rel() reads only the first three numbers, so an rgba()
  // text colour was being scored as if it were opaque: every --tx-* grey in
  // this app is rgba, which meant the whole grey scale was measured as pure
  // #EBEBF5 and passed every check it should have failed. Composite the text
  // colour over its actual backdrop first, then measure.
  const parts = (c) => { const m = (c || "").match(/[\d.]+/g); return m ? m.map(Number) : null; };
  const over = (fg, bg) => {
    const f = parts(fg), b = parts(bg);
    if (!f || !b) return fg;
    const a = f.length > 3 ? f[3] : 1;
    if (a >= 1) return fg;
    return `rgb(${f[0] * a + b[0] * (1 - a)}, ${f[1] * a + b[1] * (1 - a)}, ${f[2] * a + b[2] * (1 - a)})`;
  };
  const ratio = (a, b) => {
    const x = rel(over(a, b)), y = rel(b);
    if (x === null || y === null) return null;
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  for (const e of all) {
    // "Leaf elements only" missed every label that shares a parent with an
    // icon -- which is every tab in the tab bar, where the word sits as a
    // text node beside an <svg>. The tab bar is the app's primary
    // navigation and it was outside the audit entirely. The right test is
    // not "has no children" but "owns text of its own".
    const own = [...e.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .trim();
    if (!own) continue;
    const txt = own;
    const cs = getComputedStyle(e);
    const back = bgOf(e);
    const fg = lum(cs.color), bg = lum(back);
    if (fg === null || bg === null) continue;
    if (Math.abs(fg - bg) < 12) {
      add("invisible-text", `"${txt.slice(0,28)}" fg=${cs.color} bg=${back}`, e);
      continue;
    }
    // 5b. UNREADABLE TEXT. Visible and still unreadable is the light-theme
    //     failure mode: a grey tuned against black has nothing left against
    //     #F2F2F7. WCAG AA, with the large-text allowance, and deliberately
    //     NOT applied to text the design has already dimmed to nothing on
    //     purpose (opacity below 0.5 is a "past" or "disabled" row saying so).
    const px = parseFloat(cs.fontSize) || 16;
    const weight = Number(cs.fontWeight) || 400;
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    // A RULING THIS APP HAS ALREADY MADE IS NOT A FINDING (2026-09-20). Two
    // of the seven contrast findings left after the sheet pass were decisions
    // Dave took, in writing, against a measurement he was shown:
    //
    //   THE GLYPH BAR. --accent-glyph (#FF2B3C) is defined once and never
    //   themed, because "a glyph carries no words and answers to 3:1" -- the
    //   catalog's L6, written after he asked for the brand red back on light
    //   icons. The wordmark J is one of its consumers, so measuring it
    //   against the TEXT bar reports the fix as the bug.
    //
    //   THE ASTRA PALETTE. --good and --warn resolve to Apple's light system
    //   colours as words as well as fills. The darkened pair was measured
    //   first (#1A7439, #8A5A00) and he looked at both and chose the real
    //   ones, knowing the cost; a law pins the two hexes. The green $0.00 in
    //   the Tracker is that ruling rendering, not a regression.
    //
    // Both are recorded with their reasons, so the auditor carries them the
    // same way it carries the Tap Ladder: measured against the bar the app
    // actually holds itself to, and silent when it clears it.
    // THE GLYPH BAR IS A ROSTER, NOT A COLOUR. Keying this on #FF2B3C alone
    // was wrong and silenced a real finding on its first run: .pill-act paints
    // its WORDS in that red, and the catalog is explicit that the token is for
    // icon-only consumers. So the exemption names the one consumer that owns
    // text and is still a mark rather than a word -- the wordmark J -- and
    // nothing else inherits it by sharing a hex.
    const GLYPH_TEXT = [".brand-mark .j", ".today-brand .j"];
    const isGlyph = GLYPH_TEXT.some((sel) => e.matches(sel));
    const ASTRA = { "rgb(52, 199, 89)": "--good", "rgb(255, 149, 0)": "--warn" };
    const astra = ASTRA[cs.color];
    const ruled = isGlyph
      ? { why: "--accent-glyph, catalog L6: a glyph answers to 3:1" }
      : astra
        ? { why: astra + ", the Astra ruling 2026-09-12, law-pinned" }
        : null;
    // A ruled colour is judged by the bar its ruling names, never waved
    // through: the wordmark still has to clear the 3:1 mark bar.
    const need = isGlyph ? 3 : astra ? 0 : (large ? 3 : 4.5);
    if (need === 0) continue;
    let faded = false;
    for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
      if (Number(getComputedStyle(n).opacity) < 0.5) { faded = true; break; }
    }
    if (faded) continue;
    const cr = ratio(cs.color, back);
    if (cr !== null && cr < need) {
      const tag = ruled ? ` [${ruled.why}]` : "";
      add("low-contrast", `"${txt.slice(0,24)}" ${cr.toFixed(2)}:1 needs ${need} · ${cs.color} on ${back}${tag}`, e);
    }
  }

  // 5c. WHAT A SCREEN READER WOULD SAY (2026-09-21). The button audit read
  //     LABELS out of the source and found 208 "nameless" controls that were
  //     all false: the label was conditional, or interpolated, or looked up.
  //     The only honest version of this question is asked of the rendered
  //     page, where the name is whatever the accessibility tree computes.
  //
  //     A control with no name announces as "button" and nothing else. An
  //     icon-only control is where this happens, which in this app means the
  //     back chevron, the swipe rail, the row menu and the capture bar.
  const accName = (e) => {
    const aria = e.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    const by = e.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
      if (t) return t;
    }
    const text = (e.innerText || e.textContent || "").trim();
    if (text) return text;
    const title = e.getAttribute("title");
    if (title && title.trim()) return title.trim();
    const alt = e.querySelector("img[alt]")?.getAttribute("alt");
    if (alt && alt.trim()) return alt.trim();
    if (e.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(e.id)}"]`);
      if (lab?.textContent?.trim()) return lab.textContent.trim();
    }
    const wrap = e.closest("label");
    if (wrap?.textContent?.trim()) return wrap.textContent.trim();
    const ph = e.getAttribute("placeholder");
    if (ph && ph.trim()) return ph.trim();
    return "";
  };
  for (const e of tappable) {
    // Something purely decorative can opt out, and a few things do.
    if (e.getAttribute("aria-hidden") === "true" || e.closest("[aria-hidden='true']")) continue;
    if (accName(e)) continue;
    const cls = (typeof e.className === "string" ? e.className : "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    const r = e.getBoundingClientRect();
    add("no-name", `${e.tagName.toLowerCase()}${cls ? "." + cls : ""} ${Math.round(r.width)}x${Math.round(r.height)} announces nothing`, e);
  }

  // 6. STACKED SIBLINGS WITH NO GAP. The bug Dave found in Heads Up.
  const cards = [...ROOT.querySelectorAll(".card, .notice-swipe, .promo-card")].filter(vis);
  for (let i = 1; i < cards.length; i++) {
    const a = cards[i-1].getBoundingClientRect(), c = cards[i].getBoundingClientRect();
    if (cards[i-1].contains(cards[i]) || cards[i].contains(cards[i-1])) continue;
    const gap = c.top - a.bottom;
    if (gap >= -1 && gap < 4 && Math.abs(a.left - c.left) < 3) {
      add("flush-stack", `gap=${Math.round(gap)}px between two cards`, cards[i]);
    }
  }

  // 8. ONE GREY, EVER (Dave 2026-09-21, five screenshots: "There should not
  //    be more than one gray subtext anywhere... you can make it gray with
  //    regular font one time. And then after that shit has to look different.
  //    If you want to bold something in gray, fine. Color coordinating,
  //    dots, chips, whatever. But I never want to speak about this again.")
  //
  //    So under a row's title, at most ONE run of text may be secondary ink
  //    at regular weight. Everything else on the row has to be told apart by
  //    something you can see without reading: weight, a colour, a dot, a
  //    chip's own fill. This measures the COMPUTED colour and weight of every
  //    text-bearing leaf in the row, which is what he sees, rather than
  //    class names, which is what drifted. A separator glyph (a middot, a
  //    slash, a bare bullet) is structure and does not count, and a leaf
  //    sitting on its own fill (a chip, a pill) is already told apart.
  // A CARD WITH A TITLE IS A ROW FOR THIS PURPOSE. The goal and project
  // cards on Life's grid carry a title and lines under it exactly as a row
  // does, and the first look at them showed two grey lines the row scan
  // could not see ("0 of 1 Projects done" over "1 Linked project").
  const ROWS = ".row, .task-row, .sched-row, .lib-row, .conn-row, .proj-row, .person-row, .lm-row, .rem-card, .area-card, .notice-card, .stream-card, .cat-row, .bp-card";
  const isGrey = (rgb) => {
    const m = rgb.match(/[\d.]+/g); if (!m) return false;
    const [r, g, b] = m.map(Number);
    const a = m[3] === undefined ? 1 : Number(m[3]);
    if (a < 0.2) return false;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    // Achromatic, and not the primary ink at either end of the ramp.
    return mx - mn < 18 && mx < 244 && mn > 12;
  };
  const onOwnFill = (e, stop) => {
    let n = e;
    while (n && n !== stop) {
      const bg = getComputedStyle(n).backgroundColor;
      const m = bg.match(/[\d.]+/g);
      if (m && (m[3] === undefined || Number(m[3]) > 0.02)) return true;
      n = n.parentElement;
    }
    return false;
  };
  for (const row of ROOT.querySelectorAll(ROWS)) {
    if (!vis(row) || !clipped(row)) continue;
    // Nested rows report themselves; a card that holds rows is not a row.
    if (row.querySelector(ROWS)) continue;
    const greys = [];
    for (const e of row.querySelectorAll("*")) {
      if (e.children.length > 0 && [...e.childNodes].every((c) => c.nodeType !== 3 || !c.textContent.trim())) continue;
      const txt = [...e.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join("").trim();
      if (!txt || /^[\u00b7\u2022\u2013\u2014\-\/|:,.\s]+$/.test(txt)) continue;
      if (!vis(e)) continue;
      const cs = getComputedStyle(e);
      if (!isGrey(cs.color)) continue;
      if (Number(cs.fontWeight) >= 600) continue;
      if (cs.textTransform === "uppercase") continue;   // a state word or eyebrow is told apart by its caps
      if (onOwnFill(e, row)) continue;
      // A MARK AHEAD OF THE WORDS TELLS THEM APART (the ruling names "dots").
      // The category dot, the event mark, the project pie and the goal ring
      // are all a wordless element drawn just before the text, so a leaf
      // whose nearest inline group opens with one is marked, not grey.
      const grp = e.parentElement;
      const marked = (n) => {
        let p = n.previousElementSibling;
        while (p) {
          if (vis(p) && !(p.textContent || "").trim()) return true;
          if ((p.textContent || "").trim()) return false;
          p = p.previousElementSibling;
        }
        return false;
      };
      // ...and a dot drawn INSIDE the leaf, ahead of its own text, is the
      // same mark: the schedule's "· Family" is a wordless dot element and
      // a text node in one span.
      const leadsWithMark = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3 && c.textContent.trim()) return false;
          if (c.nodeType === 1) return vis(c) && !(c.textContent || "").trim();
        }
        return false;
      };
      if (leadsWithMark(e) || marked(e) || (grp && grp !== row && marked(grp))) continue;
      // ONE SENTENCE IS ONE RUN. "Looks like Wednesday 2:30 PM · 30 Min" is
      // a single grey line whose numbers happen to sit in their own spans;
      // that is one run, not three. A run is the nearest ancestor that is a
      // direct item of a flex or grid box (or of the row): everything in
      // flowing text under it is the same run, and two items of a flex line
      // (two facts on a meta line) are two.
      let unit = e;
      while (unit.parentElement && unit.parentElement !== row) {
        const pd = getComputedStyle(unit.parentElement).display;
        if (pd.includes("flex") || pd.includes("grid")) break;
        unit = unit.parentElement;
      }
      if (!greys.some((g) => g.unit === unit)) greys.push({ unit, txt: txt.slice(0, 22) });
    }
    if (greys.length > 1) {
      add("grey-twice", `${greys.length} grey runs on one row: ${greys.map((g) => '"' + g.txt + '"').join(", ")}`, row);
    }
  }

  // 7. CONTENT UNDER THE FIXED BARS. A row you can see but never tap.
  //
  // THE BARS COME FROM ROOT TOO (2026-09-21, found the first time a finish
  // receipt was ever audited). This search was the one check still reading
  // the whole document while everything else honoured the modal root, so
  // with a sheet up it measured the sheet's own buttons against the PAGE's
  // fixed bars -- the ones lying under the scrim, unreachable and covering
  // nothing. "Done" and "Keep Training", the two biggest buttons on the
  // receipt, both came back as hidden behind the log bar they sit on top of.
  // Same rule as the rest of the file: when a layer is up, the page under it
  // is not the subject.
  const bars = [...ROOT.querySelectorAll("*")].filter((e) => getComputedStyle(e).position === "fixed" && vis(e));
  // A ROW YOU CAN SCROLL OUT IS NOT TRAPPED (2026-09-21). Every screen in
  // this app that has a fixed bottom bar also has content passing under it
  // at some scroll position, and reporting that is reporting scrolling. The
  // defect is content that can NEVER be moved out: the page is already at the
  // bottom and the bar is still on top of it, which is what a foot spacer
  // exists to prevent and what its absence looks like. So the question is
  // asked of the SCROLLER, once: is there anywhere left to go.
  const canScrollPast = (e) => {
    let n = e.parentElement;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (["auto", "scroll"].includes(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) {
        return n.scrollTop + n.clientHeight < n.scrollHeight - 1;
      }
      n = n.parentElement;
    }
    const d = document.scrollingElement;
    return !!d && d.scrollTop + d.clientHeight < d.scrollHeight - 1;
  };
  for (const bar of bars) {
    const rb = bar.getBoundingClientRect();
    if (rb.height > window.innerHeight * 0.5) continue;
    for (const e of tappable) {
      if (bar.contains(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.top >= 0 && r.bottom <= window.innerHeight &&
          r.bottom > rb.top + 4 && r.top < rb.bottom - 4 &&
          r.right > rb.left && r.left < rb.right) {
        if (canScrollPast(e)) continue;
        add("under-bar", `"${(e.textContent||"").trim().slice(0,22)}" behind fixed bar, page already at the bottom`, e);
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// FOCUS (FOCUS=1, 2026-09-21). The last question the DOM audit cannot answer,
// because it is about a SEQUENCE and not a frame: where does the keyboard go,
// and can you see it when it gets there.
//
// The starting suspicion was wrong and is recorded so nobody re-runs it: the
// computed outline on a focused control reads `auto 1px rgb(16,16,16)`, which
// looks like a near-black ring on a near-black app. It is not. Chromium's
// `outline: auto` is drawn specially and inverts per backdrop; screenshotted
// on this app it is a white ring in dark and a black one in light. The ring
// is fine. What is not automatic is everything around it:
//
//   no-ring      the app said `outline: none` and gave nothing back. 18 rules
//                do this, all of them on text fields, where the caret is the
//                indicator -- but a field is only exempt if it HAS a caret.
//   ring-clipped BROWSER-F-03's bug, one layer out. A ring is painted OUTSIDE
//                the box, so an `overflow: hidden` ancestor cuts it exactly
//                the way it cut the 44px ::after expanders. A focused control
//                with an invisible ring is a keyboard user lost on the page.
//   off-screen   focus landed somewhere the viewport does not show, and the
//                browser's scroll-into-view did not fix it.
//   backwards    the tab order went UP the page. DOM order is tab order, so
//                this means the DOM disagrees with the layout.
//
// Its own run, not part of the matrix: 30 tab presses a screen would double
// the sweep, and this question does not change with width or type scale.
const FOCUS = process.env.FOCUS === "1";
const FOCUS_STOPS = Number(process.env.FOCUS_STOPS || 40);

async function focusScreen(page, name) {
  const out = [];
  const seen = new Set();
  const add = (kind, detail) => {
    const k = kind + "|" + detail;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ kind, detail, cls: "" });
  };
  // START AT THE TOP OF THE DOCUMENT. blur() alone does NOT do this, which a
  // verification run caught: it clears activeElement but leaves the sequential
  // focus navigation starting point where it was, so Tab carried on from
  // wherever the crawl's last click left it and the order recorded was a
  // partial one. Focusing <body> moves the starting point, so the next Tab is
  // genuinely the first tabbable thing on the page.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    document.body.removeAttribute("tabindex");
  });
  let prev = null;
  const first = [];
  for (let i = 0; i < FOCUS_STOPS; i++) {
    await page.keyboard.press("Tab");
    // Focusing a control inside a scroller makes the browser scroll it into
    // view, and that is not instant. Measuring in the same tick reported
    // controls as clipped that the browser was in the middle of revealing.
    await page.waitForTimeout(80);
    const s = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body || !(e instanceof HTMLElement)) return null;
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      // A ring is painted outside the box. Clip it against every scrolling or
      // hidden ancestor, exactly as the main audit clips a rect.
      const ow = parseFloat(cs.outlineWidth) || 0;
      const off = parseFloat(cs.outlineOffset) || 0;
      const pad = cs.outlineStyle === "none" ? 0 : ow + Math.max(0, off) + 1;
      let clip = { top: r.top - pad, bottom: r.bottom + pad, left: r.left - pad, right: r.right + pad };
      const want = { ...clip };
      let n = e.parentElement;
      // HIDDEN AND SCROLLABLE ARE NOT THE SAME BUG. An `overflow: hidden` box
      // cuts a ring with no way to ever see it, which is BROWSER-F-03 one
      // layer out. A SCROLLER is meant to have content outside it, and the
      // browser scrolls a focused control into view, so anything still cut
      // after that is the scroller failing to follow the keyboard. Measured
      // separately or the second drowns the first.
      let scrolled = false;
      while (n && n !== document.documentElement) {
        const ps = getComputedStyle(n);
        const vals = [ps.overflow, ps.overflowX, ps.overflowY];
        if (vals.some((v) => ["hidden", "auto", "scroll", "clip"].includes(v))) {
          if (vals.some((v) => ["auto", "scroll"].includes(v))) scrolled = true;
          const pr = n.getBoundingClientRect();
          clip = {
            top: Math.max(clip.top, pr.top), bottom: Math.min(clip.bottom, pr.bottom),
            left: Math.max(clip.left, pr.left), right: Math.min(clip.right, pr.right),
          };
        }
        n = n.parentElement;
      }
      return {
        tag: e.tagName.toLowerCase(),
        id: (e.tagName + "." + (e.className || "").toString().split(" ")[0] + "|" + (e.textContent || "").trim().slice(0, 20)),
        txt: (e.textContent || "").trim().slice(0, 24) || (e.getAttribute("aria-label") || "").slice(0, 24),
        outlineNone: cs.outlineStyle === "none" || ow === 0,
        // A FIXED CONTROL IS NOT IN THE READING ORDER (2026-09-21, second
        // false positive from this check). A sheet's Cancel and a toast's
        // Undo sit at the foot of the VIEWPORT and do not scroll, so their
        // place on the page is not comparable with a row's at all; the
        // "backwards" jumps this reported were entirely that arithmetic.
        // Same helper the main audit uses, same reason.
        fixed: (() => { let n = e; while (n && n !== document.body) { if (getComputedStyle(n).position === "fixed") return true; n = n.parentElement; } return false; })(),
        // A field's caret IS its focus indicator, which is why 18 rules turn
        // the ring off. Only a field gets that exemption.
        caret: e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.isContentEditable,
        shadow: cs.boxShadow !== "none",
        // How much of the ring survives the clipping, per edge.
        lostTop: Math.round(clip.top - want.top), lostLeft: Math.round(clip.left - want.left),
        lostBottom: Math.round(want.bottom - clip.bottom), lostRight: Math.round(want.right - clip.right),
        scrolled,
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        // THE ORDER QUESTION IS A DOCUMENT QUESTION, NOT A VIEWPORT ONE, AND
        // ONLY WITHIN ONE SCROLLER. Two corrections, both of which this check
        // reported as findings before they were chased down:
        //
        // 1. Viewport y is not position. Tabbing to a control below the fold
        //    SCROLLS, so the next control -- genuinely lower -- reads a
        //    SMALLER viewport y than the one before it. getBoundingClientRect
        //    has the scroll already subtracted, so adding every ancestor's
        //    scroll back gives the unscrolled place on the page.
        //
        // 2. Adding it back puts the element in ITS OWN scroller's frame, and
        //    two scrollers are two different frames. .app-scroll holds the
        //    page; the toast dock and the tab bar are its SIBLINGS in the
        //    shell's footer stack. Comparing a row at 852 in the scroller
        //    with a toast at 664 in the viewport is comparing nothing, and it
        //    is what "About then Undo" was. Stops are only compared when they
        //    share a scroller.
        docY: (() => {
          let y = r.top + window.scrollY;
          let n = e.parentElement;
          while (n && n !== document.documentElement) { y += n.scrollTop; n = n.parentElement; }
          return Math.round(y);
        })(),
        scroller: (() => {
          let n = e.parentElement;
          while (n && n !== document.documentElement) {
            const ps = getComputedStyle(n);
            if ([ps.overflow, ps.overflowY].some((v) => ["auto", "scroll"].includes(v)) && n.scrollHeight > n.clientHeight + 1) {
              return n.tagName + "." + (n.className || "").toString().split(" ")[0];
            }
            n = n.parentElement;
          }
          return "@page";
        })(),
        vh: window.innerHeight, vw: window.innerWidth,
      };
    });
    if (!s) break;
    // A full cycle: Tab has wrapped back to where it started.
    if (first.length && s.id === first[0]) break;
    first.push(s.id);

    if (s.outlineNone && !s.shadow && !s.caret) {
      add("no-ring", `"${s.txt}" (${s.tag}) has no focus ring and no caret`);
    }
    // 2px of a ring is a rounded corner meeting a clip; half of one edge is
    // the ring being eaten.
    const lost = Math.max(s.lostTop, s.lostLeft, s.lostBottom, s.lostRight);
    if (!s.outlineNone && lost > 2) {
      add(s.scrolled ? "focus-unscrolled" : "ring-clipped",
        s.scrolled
          ? `"${s.txt}" is still ${lost}px outside its scroller after focus`
          : `"${s.txt}" loses ${lost}px of its focus ring to an overflow:hidden ancestor`);
    }
    const [x, y, w, h] = s.rect;
    if (y + h < 0 || y > s.vh || x + w < 0 || x > s.vw) {
      add("focus-offscreen", `"${s.txt}" focused at ${x},${y} outside ${s.vw}x${s.vh}`);
    } else if (prev && !s.fixed && !prev.fixed && s.scroller === prev.scroller && s.docY + 24 < prev.docY) {
      // Going back UP the page. Tolerant of a row of controls on one line and
      // of the small rises inside a card.
      add("focus-backwards", `"${prev.txt}" (y=${prev.docY}) then "${s.txt}" (y=${s.docY})`);
    }
    prev = { docY: s.docY, txt: s.txt, fixed: s.fixed, scroller: s.scroller };
  }
  return { name, findings: out, errs: [], stops: first.length };
}

// ONE TAP FURTHER IN (2026-08-21, extended to tabs 2026-09-21). Every audit
// before this stopped at the top of each section, so the pages where the app
// actually holds its content were never looked at. Click by ELEMENT, not by
// text: a text selector matches the first thing on the page that says those
// words, which on these screens is usually a heading rather than the row.
//
// AND LIFE'S ROWS ARE CARDS (2026-09-21). Probed rather than assumed: on the
// Life tab this selector matched ZERO elements, because an area is a
// .area-card, not a .row. So the dive that was added "for the tabs" walked
// straight past the one tab that is a hub, and Health -- the door to every
// screen Dave has been reporting bugs on -- stayed unvisited even after the
// tab dive existed. Count what a selector matches before trusting it.
const DIVE_SEL = '.row[role="button"], .proj-row, .lm-row, .cat-row, .settings-row, .conn-row, .person-row, .lib-row, .area-card';
// THREE WAS A NUMBER, NOT A LIMIT (2026-09-21). The dive took the first
// three rows of every screen, silently, and the audit checklist has carried
// "Settings > Categories · unreachable" for two days because of it: Categories
// is the FOURTH row of Settings. It was never missing, it was never looked at.
// The cap stays, because an unbounded dive on a list screen is a different
// tool, but it is named, tunable, and every row it skips is reported the way
// every other gap in this report is.
const DIVE_CAP = Number(process.env.DIVE_CAP || 6);
async function diveInto(page, label, sheetSkips, sheetsSeen) {
  const out = [];
  const title = () => page.evaluate(() => document.querySelector(".nav-title, .pagebar-title, .pagehead-title")?.textContent || "");
  const found = await page.locator(DIVE_SEL).count();
  const count = Math.min(DIVE_CAP, found);
  if (found > count) sheetSkips.push(`${label}: ${found - count} rows past the first ${count} were not opened (DIVE_CAP)`);
  for (let i = 0; i < count; i++) {
    await clearLayers(page);
    const before = page.url() + "|" + await title();
    const row = page.locator(DIVE_SEL).nth(i);
    let name = "";
    try {
      name = ((await row.textContent()) || "").trim().split("\n")[0].slice(0, 34);
      await row.click({ timeout: 2000 });
    } catch { continue; }
    await page.waitForTimeout(800);
    // A row that opened nothing is not a screen; auditing the same screen
    // three times is how a report gets padded instead of thorough.
    if (page.url() + "|" + await title() === before) continue;
    const name2 = label + " > " + name;
    out.push(await auditScreen(page, name2));
    if (SHEETS) {
      const back = async () => { await clearLayers(page); await page.waitForTimeout(300); };
      out.push(...await auditSheets(page, name2, back, sheetSkips, sheetsSeen));
    }
    await page.click(".nav-back, .pagebar-back").catch(() => {});
    await page.waitForTimeout(600);
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE LIVE WORKOUT (2026-09-21). Dave, on a round of health bugs the audit had
// never seen: "You are not proofing work". He was right, and the reason was
// structural rather than careless -- a live session cannot be crawled the way
// a screen is crawled:
//
//   1. It is four taps deep (Life > Health > the program > Start), and every
//      one of them is a different kind of control.
//   2. Starting one MUTATES state. The generic dive clicks three rows on every
//      screen it reaches; if one of those rows opens a workout, every screen
//      audited afterwards is a screen with a session running on it.
//   3. It needs a PROGRAM to exist. The demo seed wrote finished sessions with
//      no exercises against a program id that no program had, so Health read
//      "Set Up a Program" and Start was not on the screen at all (fixed in
//      src/data/seed.ts the same day).
//
// So it gets its own walk, driven by hand, and it runs LAST in the pass so the
// session it leaves behind cannot contaminate anything. Six screens that no
// audit has ever measured: Health, the program, the time sheet, the session,
// the session one set in (the rest clock, the Done chip, the drop action), and
// the finish receipt.
async function liveWorkout(page, sheetSkips, openTab) {
  const out = [];
  const step = async (what, fn) => {
    try { await fn(); await page.waitForTimeout(900); return true; }
    catch { sheetSkips.push("live workout: " + what); return false; }
  };
  await clearLayers(page);
  // By element, like every other navigation here: "Life" is a word Today
  // also uses.
  if (!await step("could not reach the Life tab", () => openTab("Life"))) return out;
  if (!await step("no Health card on Life", () => page.click(".area-card-health", { timeout: 3000 }))) return out;
  out.push(await auditScreen(page, "Live: Health"));
  // The hero is the day's door: "Pull Day / Today / 4 Exercises". With no
  // program it says "Set Up a Program" instead and the walk stops here, which
  // is the honest outcome rather than a silent pass.
  if (!await step("no program (the hero was a setup prompt)", () => page.click(".h-hero", { timeout: 3000 }))) return out;
  out.push(await auditScreen(page, "Live: Program"));
  if (!await step("no Start button on the program", () => page.click('text=/^Start /', { timeout: 3000 }))) return out;
  // The fit sheet ("How Long Do You Have") stands between Start and the
  // session, and it is a screen in its own right.
  out.push(await auditScreen(page, "Live: Time Check"));
  if (!await step("the time sheet would not confirm", () => page.click('text=/^Start · /', { timeout: 3000 }))) return out;
  await page.waitForTimeout(800);
  out.push(await auditScreen(page, "Live: Workout"));
  // One set logged, because the session one set in is a DIFFERENT screen: the
  // rest clock is up, the first chip is a Done row, Log a Drop appears, and
  // the bottom bar has to re-aim at set 2. Three of the five bugs Dave
  // reported on 2026-09-21 were only visible in this state.
  if (await step("the Log button would not log", () => page.click(".logbar button", { timeout: 3000 }))) {
    await page.waitForTimeout(700);
    out.push(await auditScreen(page, "Live: Workout, One Set In"));
  }
  if (await step("Finish did not open the receipt", () => page.click('.nav-bar >> text="Finish"', { timeout: 3000 }))) {
    out.push(await auditScreen(page, "Live: Finish"));
  }
  return out;
}

// A SEGMENTED CONTROL IS A SET OF SCREENS (2026-09-21). The other half of the
// same blind spot: Life's five lenses (Areas, Tasks, Reminders, Projects,
// Goals) are one tab to this crawler, so Projects and Goals -- which is where
// Bigger Picture lives, the whole roadmap layer -- were never drawn once, and
// the checklist has been carrying them as "in neither More nor Life. Renamed,
// moved or gone." They were in Life the whole time, behind a control the tool
// did not know was a control.
//
// Segment 1 is the screen just audited, so it is skipped; the walk returns to
// it afterwards, because a segment is a state the screen holds and the caller
// expects to find the screen where it left it.
async function segmentsOf(page, label) {
  const out = [];
  const segs = await page.evaluate(() =>
    [...document.querySelectorAll(".segmented .seg")].map((e) => (e.textContent || "").trim()).filter(Boolean));
  if (segs.length < 2) return out;
  for (const t of segs.slice(1)) {
    try { await page.click(`.segmented .seg:text-is("${t}")`, { timeout: 2500 }); } catch { continue; }
    await page.waitForTimeout(800);
    out.push(await auditScreen(page, label + " · " + t));
  }
  await page.click(`.segmented .seg:text-is("${segs[0]}")`, { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(600);
  return out;
}

const SHOTS = [];
const VISITED = [];
async function auditScreen(page, name) {
  VISITED.push(name);
  await page.waitForTimeout(900);
  if (FOCUS) return focusScreen(page, name);
  const findings = await page.evaluate(AUDIT);
  const errs = [];
  return { name, findings, errs };
}

// ---------------------------------------------------------------------------
// THE SHEETS (2026-09-20). Every number this tool has ever printed was a
// SCREEN number. It visits four tabs, the More rows and three detail rows
// each -- eleven screens a pass -- and never deliberately opened a sheet, so
// "the app has 48 findings" has always meant "the app has 48 findings on the
// parts of it that are not a sheet". A sheet is where the app asks for
// something: New Event, Edit Task, the block editor, every picker. It is
// exactly where a cramped target or an unreadable grey costs the most, and it
// was outside the audit.
//
// The mechanism is screen-crawl.mjs's, which has done this correctly all
// along: tap a control, ask whether a sheet actually appeared, and only then
// call it a screen. Text selectors are not used, because on these screens the
// first thing that says the words is usually a heading.
const SHEET_SEL = ".sheet, [role=dialog], .modal, .block-menu, .time-pop";
const SHEET_CAP = Number(process.env.SHEET_CAP || 6);

// WHAT OPENED IS A LAYER, NOT A CLASS NAME. The first version of this asked
// `document.querySelector(".sheet, [role=dialog], ...)` and called anything
// else "not a sheet door". Today's magnifier opens a full-screen SEARCH that
// carries none of those classes and leaves the tab bar and title alone, so
// the detector saw nothing, the screen check saw no move, and the overlay
// stayed up: every tab click for the rest of the pass landed on the search
// panel and was swallowed. The run then reported ONE screen and no error.
//
// So the question is the honest one -- is something covering the screen that
// was not covering it before -- and it is asked of the rendered page: a
// fixed or absolute layer taking a third of the viewport, or one of the
// known sheet classes. Anything that traps the pass now gets noticed.
const layerOf = (page) => page.evaluate((sel) => {
  const named = document.querySelector(sel);
  if (named) {
    const r = named.getBoundingClientRect();
    if (r.width >= 40 && r.height >= 40) {
      const h = named.querySelector("h1, h2, .sheet-title, .nav-title, .pagehead-title");
      return (h?.textContent || named.textContent || "sheet").trim().slice(0, 34) || "sheet";
    }
  }
  const area = window.innerWidth * window.innerHeight;
  for (const e of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(e);
    if (cs.position !== "fixed" && cs.position !== "absolute") continue;
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.2) continue;
    const r = e.getBoundingClientRect();
    if (r.width * r.height < area * 0.33) continue;
    if (r.top > window.innerHeight * 0.8) continue;        // a docked bar, not a layer
    if (e.closest(".tab-bar, .voice-dock")) continue;      // permanent chrome
    const h = e.querySelector("h1, h2, .sheet-title, .nav-title, .pagehead-title, input[placeholder]");
    const t = (h?.getAttribute?.("placeholder") || h?.textContent || e.textContent || "").trim();
    return (t || "overlay").slice(0, 34);
  }
  return "";
}, SHEET_SEL);

const sheetOpen = layerOf;

/** Everything on this screen that might open a sheet, as stable descriptors. */
const sheetCandidates = (page) => page.evaluate(() => {
  const SEL = "button, [role=button], .lib-row, .row-tap, .chip, [data-tap]";
  // Anything that leaves the screen or destroys a record is not a sheet door.
  const NO = /^(back|cancel|close|done|save|delete|remove|sign out|log out|clear all|reset|today|tasks|schedule|brain|notes|email|money|chat|more|life)$/i;
  const out = [], seen = new Map();
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (r.top < 0 || r.bottom > window.innerHeight) continue;
    const text = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!text || NO.test(text)) continue;
    const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    const key = text + "|" + cls;
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    out.push({ text, cls, nth: n });
  }
  return out;
});

const tapCandidate = (page, d) => page.evaluate(({ d }) => {
  const SEL = "button, [role=button], .lib-row, .row-tap, .chip, [data-tap]";
  let n = 0;
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (r.top < 0 || r.bottom > window.innerHeight) continue;
    const text = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!text) continue;
    const cls = (typeof el.className === "string" ? el.className : "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    if (text === d.text && cls === d.cls) {
      if (n === d.nth) { el.click(); return true; }
      n++;
    }
  }
  return false;
}, { d });

/**
 * Open every sheet this screen can reach, audit inside each, close it.
 * Returns one result per sheet that actually appeared. `reopen` puts the page
 * back on this screen, because a sheet that refuses to close must not poison
 * the rest of the pass.
 */
async function auditSheets(page, screenName, reopen, skipped, seenTitles) {
  const out = [];
  if (await sheetOpen(page)) return out; // already inside one
  let home = await screenSig(page);
  const cands = await sheetCandidates(page);
  let opened = 0;
  for (const d of cands) {
    if (opened >= SHEET_CAP) { skipped.push(`${screenName}: stopped at SHEET_CAP ${SHEET_CAP}, ${cands.length} candidates`); break; }
    let ok = false;
    try { ok = await tapCandidate(page, d); } catch { ok = false; }
    if (!ok) continue;
    await page.waitForTimeout(700);
    const title = await sheetOpen(page);
    if (!title) {
      // A TAP THAT NAVIGATES STILL HAPPENED. The first version of this said
      // "not a sheet door; nothing to undo" and moved on, so the first row
      // that opened a PAGE left the pass standing on that page: Today was
      // audited, every tab click after it missed, and the run reported one
      // screen with a straight face. If the screen moved, put it back.
      if (await screenSig(page) !== home) { await reopen(); home = await screenSig(page); }
      continue;
    }
    // ONE SHEET, ONCE PER PASS. The capture bar and What Now live in the
    // dock, so they are reachable from every screen in the app; auditing them
    // from each one padded the report with six identical copies of the same
    // findings and spent the runtime to produce them. The set is the pass's,
    // not the screen's.
    if (seenTitles.has(title)) {
      await closeSheet(page, reopen);
      if (await screenSig(page) !== home) { await reopen(); home = await screenSig(page); }
      continue;
    }
    seenTitles.add(title);
    opened++;
    out.push(await auditScreen(page, `${screenName} » ${d.text} [${title}]`));
    await closeSheet(page, reopen);
    // Closing can also land somewhere else (a sheet whose Cancel goes back a
    // level). Same rule: the next candidate is measured from this screen or
    // it is not measured at all.
    if (await screenSig(page) !== home) { await reopen(); home = await screenSig(page); }
  }
  return out;
}

/** What screen are we on? Enough to notice a move, cheap enough to ask often. */
const screenSig = (page) => page.evaluate(() => {
  const t = document.querySelector(".nav-title, .pagebar-title, .pagehead-title, h1, .page-title")?.textContent || "";
  const tab = document.querySelector(".tab.active")?.textContent || "";
  return (tab + "|" + t).trim().slice(0, 60);
});

/**
 * Get back to bare screen, whatever is on top of it. Every navigation click in
 * a pass goes through this: a layer left standing swallows the next tab click
 * silently, and the pass then reports fewer screens with no error at all,
 * which is how the More section went missing on the first working run.
 */
async function clearLayers(page) {
  for (let i = 0; i < 4; i++) {
    if (!(await layerOf(page))) return true;
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(280);
    if (!(await layerOf(page))) return true;
    for (const sel of [".sheet-cancel", ".block-menu-scrim", ".time-pop-scrim", ".sheet-scrim", ".nav-back", ".pagebar-back"]) {
      await page.click(sel, { timeout: 500 }).catch(() => {});
    }
    await page.waitForTimeout(280);
    if (!(await layerOf(page))) return true;
    // By their own words, and only the words that LEAVE. Never "Done" or
    // "Save": this is a way out of a screen, not a decision on its behalf.
    // ".search-overlay.focus-screen" (What Now) is the reason "Close" and
    // "Back to Today" are here -- it ignores Escape, so the pass sat behind
    // it and lost the whole More section.
    for (const word of ["Cancel", "Close", "Back to Today"]) {
      await page.getByText(word, { exact: true }).first().click({ timeout: 500 }).catch(() => {});
      await page.waitForTimeout(240);
      if (!(await layerOf(page))) return true;
    }
  }
  return !(await layerOf(page));
}

async function closeSheet(page, reopen) {
  for (const how of [
    () => page.keyboard.press("Escape"),
    () => page.keyboard.press("Escape"),
    () => page.click(".sheet-cancel, .nav-back, .pagebar-back", { timeout: 800 }),
    () => page.click("text=\"Cancel\"", { timeout: 800 }),
    () => page.click(".sheet-scrim, .block-menu-scrim, .time-pop-scrim", { timeout: 800 }),
  ]) {
    try { await how(); } catch { /* try the next door */ }
    await page.waitForTimeout(450);
    if (!(await sheetOpen(page))) return;
  }
  // Nothing closed it. Rebuild the screen from scratch rather than auditing
  // the next thing through a sheet that is still on top of it.
  try { await reopen(); } catch { /* the caller's pass will report the gap */ }
}

// ---------------------------------------------------------------------------
// THE MATRIX (2026-08-21). Until now this ran one width in one theme, which
// meant "the app has no visual bugs" actually meant "the app has no visual
// bugs at 390 wide in the dark". Dave reads it on a phone, but the same build
// is a web app anyone can open at any width, and the light palette is a
// separate set of colours that nothing had ever looked at.
//
// Passes run CONCURRENTLY in their own browser contexts. Each context has its
// own storage, so the demo seed and the onboarding skip do not interfere.

// Sheets are ON unless switched off. They roughly double the wall clock, so
// SHEETS=0 is there for chasing one screen finding; a REPORT without them is
// a screens-only report and says so at the bottom.
const SHEETS = process.env.SHEETS !== "0";
// The phone's text size as a multiplier; 1.4 is the top of this app's clamp.
const TYPE_SCALE = Number(process.env.TYPE_SCALE || 1);

const MATRIX = process.env.VW
  // An explicit VW/VH/THEME still runs exactly one pass, for chasing one
  // finding without waiting for the whole sweep.
  ? [{ w: Number(process.env.VW), h: Number(process.env.VH || 844), theme: process.env.THEME || "dark",
       scale: TYPE_SCALE }]
  // 320 IS NOT A SUPPORTED WIDTH (Dave, 2026-09-20, asked directly and
  // answered directly). The sheet-aware run found 18 distinct findings in the
  // whole app and SEVEN of them existed only at 320 and nowhere else: every
  // truncation the app has, plus a Search Cancel painting past the screen
  // edge and a 63x20 tap target. Supporting a phone nobody here uses was
  // costing 39 percent of the report.
  //
  // This is a decision, not an oversight, so the passes go rather than the
  // findings being triaged away one at a time for ever. 390 is the phone he
  // holds; 430 and 834 keep the app honest as a web app at other sizes.
  //
  // AND EVERY SIZE RUNS TWICE (2026-09-21). Dropping 320 was right and it also
  // hid something: larger text in a fixed width is the same arithmetic as
  // fixed text in a narrower one, so SIX of the seven findings that "only
  // existed at 320" came straight back the first time the app was measured at
  // --type-scale 1.4. That is not a phone nobody here uses. It is Dave's own
  // phone with its text size turned up, the app reads it (appearance/
  // textZoom.ts clamps 1.0 to 1.4) and Settings offers it, so 1.4 is a
  // SUPPORTED configuration in a way 320 never was.
  //
  // 834 at 1.4 found nothing on the run that added it, and it stays anyway:
  // "this pass is unlikely to find anything" is the exact reasoning that kept
  // those six findings invisible for a month.
  : [1, 1.4].flatMap((scale) => [
    { w: 390, h: 844, theme: "dark", scale },   // the phone Dave holds
    { w: 430, h: 932, theme: "dark", scale },   // Pro Max
    { w: 834, h: 1112, theme: "dark", scale },  // tablet / a desktop browser window
    { w: 390, h: 844, theme: "light", scale },
    { w: 430, h: 932, theme: "light", scale },
    { w: 834, h: 1112, theme: "light", scale },
  ]);

// IS THERE ANYTHING IN THE APP? (2026-09-21). Every number this tool had ever
// printed was measured against whatever happened to be on port 4173, and a
// plain `npm run build` produces an app with NO demo data -- the seeds live
// behind __DEMO_SEED__ and Rollup drops them, on purpose, so demo names can
// never ship. An audit of that build is an audit of empty states: no program,
// no sessions, no projects, no mail. It finds very little and says nothing
// about the app Dave uses.
//
// A demo build emits a DEMO_BUILD marker into dist (see vite.config.ts), so
// asking for it is an exact question with an exact answer. This does not
// refuse to run -- a deliberate empty-state pass is a real thing to want --
// it says which one this was, at the top and at the bottom, so no report can
// be mistaken for the other kind again.
//   DEMO=1 npm run build && npx vite preview --port 4173
const DEMO_BUILD = await fetch("http://localhost:4173/DEMO_BUILD")
  .then((r) => r.ok).catch(() => false);
const SEED_LINE = DEMO_BUILD
  ? "SEEDED BUILD: demo data is present, so this measures full screens."
  : "EMPTY BUILD: no DEMO_BUILD marker on :4173, so this measured EMPTY STATES.\n" +
    "  Rebuild with: DEMO=1 npm run build && npx vite preview --port 4173";
console.log(SEED_LINE + "\n");

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

async function runPass({ w, h, theme, scale = 1 }) {
  const label = `${w}x${h} ${theme}` + (scale === 1 ? "" : ` @${scale}x type`);
  const ctx = await b.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    // The weather offer's Allow asks for a position. Headless with no answer
    // parks on its own 10s timeout, once per pass, for nothing.
    permissions: ["geolocation"],
    geolocation: { latitude: 40.71, longitude: -74.01 },
  });
  await ctx.addInitScript(() => {
    const f = new Date(); f.setHours(11, 30, 0, 0);
    const o = f.getTime() - Date.now(); const R = Date;
    class F extends R { constructor(...a){ if(!a.length) super(R.now()+o); else super(...a);} static now(){return R.now()+o;} }
    window.Date = F;
  });
  const page = await ctx.newPage();
  const consoleErrs = [];
  page.on("pageerror", (e) => consoleErrs.push(String(e).slice(0, 140)));
  const results = [];
  const sheetSkips = [];
  const sheetsSeen = new Set();
  try {
    await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
    try { await page.click('text="Skip for now"', { timeout: 8000 }); } catch { /* already past it */ }
    await page.waitForTimeout(3000);
    // Set the theme EXPLICITLY in both passes. Leaving dark implicit means
    // the dark run is really "whatever the container's prefers-color-scheme
    // happens to be", which is not a thing to build a report on.
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(600);
    // DYNAMIC TYPE (2026-09-21). This app has a real one: --type-scale is
    // clamped 1.0 to 1.4, read from the phone's own text size, and every
    // named type token multiplies by it. What it has never had is a pass at
    // the top of that range, so nothing knew what 1.4 breaks. Every size in
    // the matrix now runs twice, at 1 and at 1.4; TYPE_SCALE=1.4 alongside an
    // explicit VW pins the scale for a single chase pass.
    if (scale !== 1) {
      await page.evaluate((n) => document.documentElement.style.setProperty("--type-scale", String(n)), scale);
      await page.waitForTimeout(500);
    }

    // THE TABS ARE WHATEVER THE TAB BAR SAYS (2026-09-21). This was hardcoded
    // to ["Today", "Tasks", "Schedule", "More"], which was the tab bar the day
    // it was written. The bar is CONFIGURABLE -- Settings reorders and toggles
    // it -- and Dave's reads Today / Life / Schedule / Brain / Email / More.
    // So "Tasks" matched nothing and was silently skipped (the click is in a
    // try/continue), and Life, Brain and Email were never visited at all.
    //
    // That is how every screen he reported bugs on came to be a screen this
    // tool had never once opened: the live workout lives behind Life, and no
    // audit has ever been inside one. A tool that decides for itself which
    // parts of the app count is not an audit, it is a sample.
    const TABS = await page.evaluate(() =>
      [...document.querySelectorAll(".tab-bar .tab")].map((e) => (e.textContent || "").trim()).filter(Boolean));
    if (TABS.length === 0) sheetSkips.push("the tab bar named no tabs, so only More was crawled");
    // AND THE TAB IS CLICKED BY ELEMENT, NOT BY ITS WORDS (2026-09-21). This
    // file already says, twice, that a text selector matches the first thing
    // on the page saying those words -- and then clicked the tabs by text
    // anyway. On Today the first "Schedule" is a Ready to Send action pill,
    // so `text="Schedule"` scheduled a dental cleaning and audited whatever
    // that opened. Verified by reading the active tab after the click: still
    // Today. Every "Tab: Schedule" this tool has ever printed was that.
    // The names are read off .tab-bar .tab in order, so the index is exact.
    const openTab = (t) => page.locator(".tab-bar .tab").nth(TABS.indexOf(t)).click({ timeout: 3000 });
    for (const t of TABS) {
      if (!(await clearLayers(page))) sheetSkips.push(`before Tab ${t}: a layer would not close`);
      try { await openTab(t); } catch { continue; }
      results.push(await auditScreen(page, "Tab: " + t));
      if (SHEETS) {
        const back = async () => { await clearLayers(page); await openTab(t).catch(() => {}); await page.waitForTimeout(700); };
        results.push(...await auditSheets(page, "Tab: " + t, back, sheetSkips, sheetsSeen));
        await back();
      }
    }

    // Every row inside More. Same rule as the tabs: by element and by index,
    // because "Notes" and "Money" are words that appear elsewhere too.
    await clearLayers(page);
    await openTab("More").catch(() => {});
    await page.waitForTimeout(1000);
    const rows = await page.evaluate(() => [...document.querySelectorAll(".lib-row .lib-name")].map((e) => (e.textContent || "").trim()));
    if (!rows.length) sheetSkips.push("More: no rows found, the whole section was skipped");
    const openMoreRow = (i) => page.locator(".lib-row").nth(i).click({ timeout: 2500 });
    for (const [ri, r] of rows.entries()) {
      await clearLayers(page);
      await openTab("More").catch(() => {});
      await page.waitForTimeout(700);
      try { await openMoreRow(ri); } catch { continue; }
      results.push(await auditScreen(page, "More > " + r));
      if (SHEETS) {
        const back = async () => {
          await clearLayers(page);
          await openTab("More").catch(() => {});
          await page.waitForTimeout(600);
          await openMoreRow(ri).catch(() => {});
          await page.waitForTimeout(700);
        };
        results.push(...await auditSheets(page, "More > " + r, back, sheetSkips, sheetsSeen));
        await back();
      }
      // DETAIL DIVE (2026-08-21). Every audit before this one stopped at the
      // top of each section, which meant the pages where the app actually
      // holds its content -- a project, a goal, a person, a category -- were
      // never looked at once. "How can we do it so you don't miss anything"
      // has to include the screens that are one tap further in.
      //
      // Click by ELEMENT, not by text. Text selectors match the first thing
      // on the page that happens to say the same words, which on these
      // screens is usually a heading rather than the row.
      results.push(...await diveInto(page, "More > " + r, sheetSkips, sheetsSeen));
    }

    // AND THE TABS GET THE SAME DIVE (2026-09-21). The dive ran on More's
    // rows only, so a tab that is a HUB -- Life, which is where Health and
    // the live workout live -- was audited as one screen and never entered.
    // Every bug Dave reported on 2026-09-21 was on a screen behind that door.
    for (const t of TABS) {
      if (t === "More") continue;   // its rows are crawled above, in full
      await clearLayers(page);
      try { await openTab(t); } catch { continue; }
      await page.waitForTimeout(700);
      results.push(...await diveInto(page, "Tab: " + t, sheetSkips, sheetsSeen));
      // And every lens the tab holds behind its segmented control.
      await clearLayers(page);
      await openTab(t).catch(() => {});
      await page.waitForTimeout(700);
      results.push(...await segmentsOf(page, "Tab: " + t));
    }

    // LAST, because it leaves a workout running. See liveWorkout above.
    results.push(...await liveWorkout(page, sheetSkips, openTab));
  } catch (e) {
    consoleErrs.push("PASS FAILED: " + String(e).slice(0, 160));
  } finally {
    await ctx.close();
  }
  return { label, w, h, theme, results, consoleErrs, sheetSkips };
}

// Three at a time: enough to cut the wall clock, few enough that a starved
// CPU does not turn a layout measurement into a timing measurement.
const LANES = 3;
const passes = [];
for (let i = 0; i < MATRIX.length; i += LANES) {
  passes.push(...await Promise.all(MATRIX.slice(i, i + LANES).map(runPass)));
}
await b.close();

writeFileSync("/tmp/audit.json", JSON.stringify(passes, null, 1));

let grand = 0;
for (const p of passes) {
  let total = 0;
  for (const r of p.results) {
    if (r.findings.length === 0) continue;
    total += r.findings.length;
    console.log(`\n### [${p.label}] ${r.name}`);
    const byKind = {};
    for (const f of r.findings) (byKind[f.kind] ??= []).push(f.detail);
    for (const [k, v] of Object.entries(byKind)) {
      console.log(`  ${k} (${v.length}):`);
      for (const d of v.slice(0, 4)) console.log("    - " + d);
      if (v.length > 4) console.log(`    ... ${v.length - 4} more`);
    }
  }
  grand += total;
  console.log(`\n[${p.label}] ${total} findings | ${p.results.length} screens${p.consoleErrs.length ? " | ERRORS: " + JSON.stringify(p.consoleErrs.slice(0, 3)) : ""}`);
}
const sheetScreens = passes.reduce((a, p) => a + p.results.filter((r) => r.name.includes(" » ")).length, 0);
const allSkips = passes.flatMap((p) => p.sheetSkips || []);
console.log("\n" + SEED_LINE);
console.log("SCREENS VISITED:\n" + [...new Set(VISITED)].map((n) => "  - " + n).join("\n"));
console.log(`\n=== TOTAL ACROSS ${passes.length} PASSES: ${grand} findings ===`);
console.log(SHEETS
  ? `SHEETS ON: ${sheetScreens} sheet screens audited across all passes (cap ${SHEET_CAP} per screen)`
  : "SHEETS OFF: this is a screens-only report, not a whole-app one");
if (allSkips.length) {
  console.log(`SHEETS NOT REACHED (${allSkips.length}), named so the gap is countable:`);
  for (const sk of [...new Set(allSkips)].slice(0, 12)) console.log("  - " + sk);
}
