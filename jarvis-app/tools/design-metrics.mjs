// VISUAL DESIGN METRICS
//
// The ADHD behaviour audit asked "does this screen help him act?". This asks
// the craft questions instead: is there a type scale or just font sizes, is
// spacing on a grid, do containers nest sanely, does one thing dominate, is
// red still meaningful, do edges line up.
//
// All of it is measured from COMPUTED STYLE on the rendered page, not from
// the stylesheet. A design system that exists in CSS variables but is not
// what the browser actually paints is not a design system.
export async function measureDesign(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return (
        r.width > 0 && r.height > 0 &&
        st.visibility !== "hidden" && st.display !== "none" && Number(st.opacity) > 0.05
      );
    };
    const inView = (el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    };
    // Text-bearing leaf: the thing a reader actually sees as one run of type.
    const leaves = [...document.querySelectorAll("*")].filter((el) => {
      if (!vis(el) || !inView(el)) return false;
      const t = (el.textContent || "").trim();
      if (!t) return false;
      return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    });

    const px = (v) => Math.round(parseFloat(v) || 0);

    // ---- TYPE: every size/weight pair actually painted -------------------
    const type = {};
    for (const el of leaves) {
      const st = getComputedStyle(el);
      const key = `${px(st.fontSize)}/${st.fontWeight}`;
      if (!type[key]) type[key] = { n: 0, sample: (el.textContent || "").trim().slice(0, 28) };
      type[key].n++;
    }

    // ---- COLOR: text colors, surfaces, and how much is red --------------
    const textColors = {};
    let redText = 0;
    const isRedish = (c) => {
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return false;
      const [r, g, b] = [+m[1], +m[2], +m[3]];
      return r > 140 && r > g * 1.7 && r > b * 1.5;
    };
    for (const el of leaves) {
      const c = getComputedStyle(el).color;
      textColors[c] = (textColors[c] || 0) + 1;
      if (isRedish(c)) redText++;
    }
    const surfaces = {};
    let redFill = 0;
    for (const el of document.querySelectorAll("*")) {
      if (!vis(el) || !inView(el)) continue;
      const st = getComputedStyle(el);
      const bg = st.backgroundColor;
      if (!bg || bg === "rgba(0, 0, 0, 0)") continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < 400) continue;
      surfaces[bg] = (surfaces[bg] || 0) + 1;
      if (isRedish(bg)) redFill++;
    }

    // ---- RADII + BORDERS: container vocabulary ---------------------------
    const radii = {};
    for (const el of document.querySelectorAll("*")) {
      if (!vis(el) || !inView(el)) continue;
      const st = getComputedStyle(el);
      const r = px(st.borderTopLeftRadius);
      if (!r) continue;
      const b = el.getBoundingClientRect();
      if (b.width * b.height < 900) continue;
      radii[r] = (radii[r] || 0) + 1;
    }

    // ---- SPACING: gaps and paddings actually rendered --------------------
    const spacing = {};
    for (const el of document.querySelectorAll("*")) {
      if (!vis(el) || !inView(el)) continue;
      const st = getComputedStyle(el);
      for (const v of [st.gap, st.rowGap, st.paddingTop, st.paddingBottom, st.marginTop, st.marginBottom]) {
        const n = px(v);
        if (n > 0 && n < 90) spacing[n] = (spacing[n] || 0) + 1;
      }
    }

    // ---- ALIGNMENT: distinct left edges of content ------------------------
    const lefts = {};
    for (const el of leaves) {
      const r = el.getBoundingClientRect();
      if (r.width < 30) continue;
      const L = Math.round(r.left);
      lefts[L] = (lefts[L] || 0) + 1;
    }

    // ---- NESTING: cards inside cards inside cards ------------------------
    let maxCardDepth = 0;
    for (const el of document.querySelectorAll(".card")) {
      if (!vis(el)) continue;
      let d = 0, p = el;
      while (p) { if (p.classList && p.classList.contains("card")) d++; p = p.parentElement; }
      maxCardDepth = Math.max(maxCardDepth, d);
    }

    // ---- HIERARCHY: is there a single dominant element above the fold? ---
    const areas = [];
    for (const el of document.querySelectorAll(".card, .btn, .lib-row, .sh2, .pagehead-title, .empty-state, .seg")) {
      if (!vis(el) || !inView(el)) continue;
      const r = el.getBoundingClientRect();
      areas.push({ a: Math.round(r.width * r.height), t: (el.textContent || "").trim().slice(0, 26) });
    }
    areas.sort((x, y) => y.a - x.a);
    const dominance = areas.length > 1 ? +(areas[0].a / areas[1].a).toFixed(2) : null;

    // ---- BUTTON VOCABULARY ----------------------------------------------
    const btn = {};
    for (const el of document.querySelectorAll("button, [role=button], .btn")) {
      if (!vis(el) || !inView(el)) continue;
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const key = `h${Math.round(r.height)}/r${px(st.borderTopLeftRadius)}/${st.backgroundColor}`;
      if (!btn[key]) btn[key] = { n: 0, sample: (el.textContent || "").trim().slice(0, 22) };
      btn[key].n++;
    }

    // ---- WHITESPACE at the bottom: dead tail under the last content -----
    let lastBottom = 0;
    const scroller = [...document.querySelectorAll("*")].filter((e) => {
      const s = getComputedStyle(e);
      return /auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 40 && e.clientHeight > 200;
    }).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    const host = scroller || document.body;
    for (const el of host.querySelectorAll("*")) {
      if (!vis(el)) continue;
      const t = (el.textContent || "").trim();
      const isBox = el.classList && (el.classList.contains("card") || el.classList.contains("btn"));
      if (!t && !isBox) continue;
      const r = el.getBoundingClientRect();
      lastBottom = Math.max(lastBottom, r.bottom);
    }
    // distance from last painted content to the bottom of the visible area
    const tailPx = Math.max(0, Math.round(innerHeight - lastBottom));

    const top = (o, k = 14) =>
      Object.entries(o).sort((a, b) => (b[1].n ?? b[1]) - (a[1].n ?? a[1])).slice(0, k);

    return {
      typeCount: Object.keys(type).length,
      type: top(type).map(([k, v]) => ({ k, n: v.n, sample: v.sample })),
      textColorCount: Object.keys(textColors).length,
      textColors: top(textColors, 10).map(([k, n]) => ({ k, n })),
      surfaceCount: Object.keys(surfaces).length,
      surfaces: top(surfaces, 8).map(([k, n]) => ({ k, n })),
      redText, redFill,
      radiiCount: Object.keys(radii).length,
      radii: top(radii, 10).map(([k, n]) => ({ k: +k, n })),
      spacingCount: Object.keys(spacing).length,
      spacing: top(spacing, 16).map(([k, n]) => ({ k: +k, n })),
      leftEdges: Object.keys(lefts).length,
      leftEdgeList: top(lefts, 10).map(([k, n]) => ({ k: +k, n })),
      maxCardDepth,
      dominance,
      biggest: areas.slice(0, 3),
      btnVariants: Object.keys(btn).length,
      btn: top(btn, 10).map(([k, v]) => ({ k, n: v.n, sample: v.sample })),
      tailPx,
    };
  });
}
