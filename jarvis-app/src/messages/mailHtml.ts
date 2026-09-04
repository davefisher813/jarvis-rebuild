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

/** Sanitise a mail's HTML into a self-contained document for a sandboxed frame. */
export function sanitizeMailHtml(html: string, opts: { dark?: boolean } = {}): string {
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const sheets = Array.from(doc.querySelectorAll("style")).map((el) => cleanStylesheet(el.textContent || ""));
  doc.querySelectorAll("style").forEach((el) => el.remove());
  for (const tag of DROP_TAGS) doc.querySelectorAll(tag).forEach((el) => el.remove());
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  const els: Element[] = [];
  while (walker.nextNode()) els.push(walker.currentNode as Element);
  for (const el of els) {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (n.startsWith("on")) { el.removeAttribute(a.name); continue; }
      if (n === "style") { const c = cleanStyle(a.value); if (c) el.setAttribute("style", c); else el.removeAttribute("style"); continue; }
      if (n === "class" || n === "id") continue;
      if (!SAFE_ATTR.has(n)) { el.removeAttribute(a.name); continue; }
      if ((n === "href" || n === "src") && !SAFE_URL.test(a.value.trim())) el.removeAttribute(a.name);
    }
    if (el.tagName === "A") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
    if (el.tagName === "IMG") { el.setAttribute("loading", "lazy"); }
  }
  const dark = opts.dark !== false;
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
  html, body { margin: 0; padding: 0; background: transparent; color: ${dark ? "#EDEDF0" : "#111"};
    font: 15px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%; word-wrap: break-word; overflow-wrap: anywhere; }
  img { max-width: 100% !important; height: auto !important; }
  table { max-width: 100% !important; }
  a { color: #0A84FF; }
  body > * { max-width: 100%; }
</style>`;
  const own = sheets.filter((c) => c.trim()).map((c) => `<style>${c.replace(/<\/style/gi, "")}</style>`).join("\n");
  // After the mail's own rules, so it wins: the frame is sized to the
  // content by the reader, and a mail that pins html/body to 100% height
  // (TikTok's does, with !important) would otherwise grow to meet every
  // height the reader set, a few pixels a tick, forever.
  const fit = `<style>html, body { height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; }</style>`;
  return `<!doctype html><html><head>${base}\n${own}\n${fit}</head><body>${doc.body.innerHTML}</body></html>`;
}
