// READING AN EMAIL AS THE SENDER LAID IT OUT (Dave 2026-09-02: "the email
// screen is broke I can't read emails or see pics"). The text view strips
// the markup; this is the other view, the markup itself, made safe.
//
// A sandboxed iframe with no scripts is the container; this file decides
// what goes into it. Scripts, styles that load things, forms, frames and
// every on* handler go. Links open in a new tab. Images stay, because a
// picture is usually the point of the mail that has one, and a tracking
// pixel loading is the price of that; the sandbox keeps it to a GET.
//
// Hand-rolled on purpose: the app has no HTML sanitiser dependency, and the
// allow-list below is the whole policy, readable in one screen.

const DROP_TAGS = ["script", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "button", "select", "textarea", "meta", "link", "base", "svg", "math", "video", "audio", "source", "noscript", "template"];
const SAFE_ATTR = new Set(["href", "src", "alt", "title", "width", "height", "colspan", "rowspan", "align", "valign", "bgcolor", "color", "border", "cellpadding", "cellspacing", "dir", "lang", "role"]);
const SAFE_URL = /^(https?:|mailto:|tel:|cid:|data:image\/(png|jpe?g|gif|webp);base64,)/i;

function cleanStyle(v: string): string {
  // Inline style survives with anything that runs, loads from anywhere but
  // https, or positions out of the box removed. A background picture over
  // https stays, by the same rule an <img> stays.
  return v
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d && !/expression\s*\(|position\s*:\s*(fixed|absolute)|behavior\s*:|-moz-binding/i.test(d))
    .filter((d) => !/url\s*\(/i.test(d) || /url\s*\(\s*['"]?(https:|data:image\/)/i.test(d))
    .join("; ");
}

// THE MAIL'S OWN STYLESHEET STAYS (2026-09-02, the TikTok mail: its layout
// is classes in a <style> block, and dropping the block left the picture
// with no layout around it). A stylesheet cannot run anything; what it can
// do is fetch, and that is what goes: @import, and any url() that is not a
// plain https picture. Everything else in it, media queries included, is
// exactly what "as sent" means.
function cleanStylesheet(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/@charset[^;]*;?/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "none")
    .replace(/behavior\s*:[^;}]*/gi, "")
    .replace(/-moz-binding\s*:[^;}]*/gi, "")
    .replace(/url\s*\(\s*(['"]?)(?!https?:|data:image\/)[^)]*\)/gi, "none");
}


// TEXT THE GROUND CAN SHOW (Dave 2026-10-15, item 6: "dark grey on black"). The frame is transparent, so the app's ground sits behind
// the mail, and a sender who wrote #333 text for white paper has written text this ground cannot show. Where the text has no
// background of its own to sit on, a colour too close to the ground is moved toward the frame's own text colour until it reads
// (4.5 to 1 at least); a colour that already reads, and any text on a ground the sender painted, is left exactly as sent.
const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0], gray: [128, 128, 128], grey: [128, 128, 128], dimgray: [105, 105, 105], dimgrey: [105, 105, 105], navy: [0, 0, 128],
  maroon: [128, 0, 0], darkblue: [0, 0, 139], darkgreen: [0, 100, 0], darkred: [139, 0, 0], midnightblue: [25, 25, 112], purple: [128, 0, 128],
  darkslategray: [47, 79, 79], darkslategrey: [47, 79, 79], brown: [165, 42, 42], saddlebrown: [139, 69, 19], white: [255, 255, 255],
  silver: [192, 192, 192], lightgray: [211, 211, 211], lightgrey: [211, 211, 211], gainsboro: [220, 220, 220], whitesmoke: [245, 245, 245],
};
function rgbOf(css: string): [number, number, number] | null {
  const v = css.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1]!.length === 3 ? hex[1]!.split("").map((c) => c + c).join("") : hex[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const fn = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(v);
  if (fn) return [Math.min(255, +fn[1]!), Math.min(255, +fn[2]!), Math.min(255, +fn[3]!)];
  return NAMED[v] ?? null;
}
function lumOf([r, g, b]: [number, number, number]): number {
  const f = (c: number): number => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
// The ground is the app's: about 0.007 in dark, about 0.9 in light. 4.5 to 1 against either is the luminance below.
const DARK_NEEDS = 4.5 * (0.007 + 0.05) - 0.05;
const LIGHT_NEEDS = (0.9 + 0.05) / 4.5 - 0.05;
function shifted(rgb: [number, number, number], toward: [number, number, number], ok: (l: number) => boolean): string {
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const m = rgb.map((c, i) => Math.round(c + (toward[i]! - c) * t)) as [number, number, number];
    if (ok(lumOf(m))) return `rgb(${m[0]}, ${m[1]}, ${m[2]})`;
  }
  return `rgb(${toward[0]}, ${toward[1]}, ${toward[2]})`;
}
function fixTextColour(css: string, dark: boolean): string | null {
  const rgb = rgbOf(css);
  if (!rgb) return null;
  const l = lumOf(rgb);
  if (dark) return l >= DARK_NEEDS ? null : shifted(rgb, [247, 241, 234], (x) => x >= DARK_NEEDS);
  return l <= LIGHT_NEEDS ? null : shifted(rgb, [31, 26, 22], (x) => x <= LIGHT_NEEDS);
}
const OWN_GROUND = /background/i;
function onOwnGround(el: Element, classBackgrounds: boolean): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.hasAttribute("bgcolor") || n.hasAttribute("background") || OWN_GROUND.test(n.getAttribute("style") ?? "")) return true;
    if (classBackgrounds && n.hasAttribute("class")) return true;
  }
  return false;
}

/** Sanitise a mail's HTML into a self-contained document for a sandboxed frame. */
// REMOTE IMAGES ON REQUEST (docs/jarvis-unified, slice 05; IMPLEMENTATION-SPEC.md
// 13: "no remote resource fetch"). The unified Email tab asks for
// remoteImages: false until the person taps Show Images: an http(s) <img>
// loses its src (its alt stays), a stylesheet or inline style loses its
// https url(), and inline data: and cid: pictures stay, since they fetch
// nothing. Every other caller keeps the default, which is what it was.
export function sanitizeMailHtml(html: string, opts: { dark?: boolean; remoteImages?: boolean } = {}): string {
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const remote = opts.remoteImages !== false;
  const noRemote = (css: string): string => remote ? css : css.replace(/url\s*\(\s*(['"]?)https?:[^)]*\)/gi, "none");
  const sheets = Array.from(doc.querySelectorAll("style")).map((el) => noRemote(cleanStylesheet(el.textContent || "")));
  doc.querySelectorAll("style").forEach((el) => el.remove());
  for (const tag of DROP_TAGS) doc.querySelectorAll(tag).forEach((el) => el.remove());
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  const els: Element[] = [];
  while (walker.nextNode()) els.push(walker.currentNode as Element);
  for (const el of els) {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) { el.removeAttribute(a.name); continue; }
      if (n === "style") { const c = noRemote(cleanStyle(a.value)); if (c) el.setAttribute("style", c); else el.removeAttribute("style"); continue; }
      if (n === "class" || n === "id") continue;
      if (!SAFE_ATTR.has(n)) { el.removeAttribute(a.name); continue; }
      if ((n === "href" || n === "src") && !SAFE_URL.test(a.value.trim())) el.removeAttribute(a.name);
    }
    if (el.tagName === "A") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
    if (el.tagName === "IMG") {
      el.setAttribute("loading", "lazy");
      if (!remote && /^https?:/i.test(el.getAttribute("src") ?? "")) { el.removeAttribute("src"); el.setAttribute("data-remote", "off"); }
    }
  }
  const dark = opts.dark !== false;
  // A sheet that paints backgrounds by class means any classed element may sit on one we cannot see from here: those are left as sent.
  const classBackgrounds = sheets.some((c) => OWN_GROUND.test(c));
  for (const el of els) {
    if (onOwnGround(el, classBackgrounds)) continue;
    const link = el.tagName === "A";
    const inline = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(el.getAttribute("style") ?? "");
    const attr = el.getAttribute("color");
    for (const [src, set] of [[inline?.[1], (c: string) => el.setAttribute("style", (el.getAttribute("style") ?? "").replace(/((?:^|;)\s*)color\s*:\s*[^;]+/i, `$1color: ${c}`))], [attr, (c: string) => el.setAttribute("color", c)]] as const) {
      if (!src) continue;
      const fixed = fixTextColour(src, dark);
      if (fixed) set(link ? "#0A84FF" : fixed);
    }
  }
  // ONE SCHEME, THE APP'S (Dave 2026-09-04, screenshot: the app in Light,
  // the mail frame a black box with the sender's dark-grey text vanished
  // into it). The frame's body is transparent, but CSS Color Adjust makes an
  // iframe OPAQUE, painted in its own default canvas colour, whenever its
  // colour scheme differs from the page's. This used to declare "dark light"
  // regardless of the app's theme, so the phone's own preference decided:
  // OS dark + app Light = a black slab behind text written for white paper.
  // Declaring exactly the app's scheme keeps the frame transparent, and the
  // page's ground, not the phone's, sits behind the mail.
  const base = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="${dark ? "dark" : "light"}">
<style>
  html, body { margin: 0; padding: 0; background: transparent; color: ${dark ? "#F7F1EA" : "#1F1A16"};
    font: 15px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%; word-wrap: break-word; overflow-wrap: anywhere; }
  img { max-width: 100% !important; height: auto !important; }
  table { max-width: 100% !important; }
  a { color: #0A84FF; }
  body > * { max-width: 100%; }
</style>`;
  // 2026-09-11: every "<" becomes the CSS escape \3C, not a deleted "</style":
  // deleting once let "</sty</stylele>" rebuild a closing tag and smuggle raw
  // markup into the head. With no "<" left, no tag can close or open.
  // The sender's class colours get the same treatment, but only for a mail that paints no ground anywhere (no background in its
  // sheets, no bgcolor, no inline background): otherwise a "dark" text colour may be sitting on a white block we cannot see from here.
  const paintsGround = classBackgrounds || els.some((e) => e.hasAttribute("bgcolor") || OWN_GROUND.test(e.getAttribute("style") ?? ""));
  const readable = paintsGround ? sheets : sheets.map((c) => c.replace(/(^|[;{\s])color\s*:\s*([^;}!]+)/gi, (m, pre: string, v: string) => { const f = fixTextColour(v, dark); return f ? `${pre}color: ${f}` : m; }));
  const own = readable.filter((c) => c.trim()).map((c) => `<style>${c.replace(/</g, "\\3C ")}</style>`).join("\n");
  // After the mail's own rules, so it wins: the frame is sized to the
  // content by the reader, and a mail that pins html/body to 100% height
  // (TikTok's does, with !important) would otherwise grow to meet every
  // height the reader set, a few pixels a tick, forever.
  // A picture that was never fetched has no pixels to draw: it leaves no empty box behind (Dave 2026-10-15, item 6).
  const fit = `<style>html, body { height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; }
  img[data-remote="off"] { display: none !important; }</style>`;
  return `<!doctype html><html><head>${base}\n${own}\n${fit}</head><body>${doc.body.innerHTML}</body></html>`;
}
