// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeMailHtml } from "./mailHtml";

// THE MAIL AS SENT (2026-09-02). Everything that could run, load a script,
// or leave the frame goes; pictures and layout stay.
describe("sanitizeMailHtml", () => {
  const out = sanitizeMailHtml(`<html><head><script>alert(1)</script><style>@import 'https://evil/x.css'; body{margin:0} .pc{background:url(https://t/px.gif)} .b{background:url("javascript:x")} @media (max-width:600px){.pc{display:none}}</style></head><body>
    <div onclick="x()" style="color:red;background:url(https://t/px.gif);border-image:url(javascript:x);position:fixed">Hi <a href="javascript:alert(1)">bad</a> <a href="https://tiktok.com/x">ok</a></div>
    <img src="https://cdn/x.jpg" onerror="x()"><iframe src="https://evil"></iframe><form><input></form>
  </body></html>`);
  it("drops scripts, frames and forms", () => {
    expect(out).not.toMatch(/<script|<iframe|<form|<input|alert\(/);
  });
  it("drops handlers and javascript: links, keeps https links opening outside", () => {
    expect(out).not.toMatch(/onclick|onerror|javascript:/);
    expect(out).toMatch(/href="https:\/\/tiktok.com\/x" target="_blank" rel="noopener noreferrer"/);
  });
  it("keeps the picture and the safe part of the style", () => {
    expect(out).toMatch(/<img src="https:\/\/cdn\/x.jpg" loading="lazy">/);
    // An https background stays (it is a picture); a javascript: one and
    // the fixed position go.
    expect(out).toMatch(/style="color:red; background:url\(https:\/\/t\/px\.gif\)"/);
    expect(out).not.toMatch(/javascript:|position:fixed/);
  });
  it("keeps the mail's own stylesheet, minus anything that imports or loads", () => {
    // The TikTok mail's layout is classes in its <style> block (2026-09-02).
    expect(out).toMatch(/<style>[^<]*body\{margin:0\}/);
    expect(out).toMatch(/@media \(max-width:600px\)\{\.pc\{display:none\}\}/);
    expect(out).not.toMatch(/@import|evil/);
    expect(out).toMatch(/\.pc\{background:url\(https:\/\/t\/px\.gif\)\}/);
    expect(out).toMatch(/\.b\{background:none\}/);
    expect(out).not.toMatch(/javascript:/);
  });
  it("cannot be tricked into closing its own <style> early (2026-09-11)", () => {
    // One pass deleting "</style" turned "</sty</stylele>" back into "</style>".
    const evil = sanitizeMailHtml(`<style>p{color:red}</sty</stylele><iframe src=https://evil></iframe></style><p>hi</p>`);
    expect(evil).not.toMatch(/<iframe/i);
    expect(evil).toMatch(/<style>p\{color:red\}/);
    const head = evil.slice(0, evil.indexOf("<body>"));
    expect(head.match(/<\/style>/g)?.length).toBe(head.match(/<style>/g)?.length);
    const frame = new DOMParser().parseFromString(evil, "text/html");
    expect(frame.querySelector("iframe")).toBeNull();
    expect(frame.querySelector("body p")?.textContent).toBe("hi");
  });
  it("un-pins a mail that fixes html and body to 100% height, after the mail's own rules", () => {
    const i = out.lastIndexOf("<style>");
    expect(out.slice(i)).toMatch(/html, body \{ height: auto !important/);
    expect(i).toBeGreaterThan(out.indexOf("body{margin:0}"));
  });
  it("is a whole document with a dark ground", () => {
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toMatch(/color-scheme/);
  });
  it("declares exactly the app's colour scheme, never both (Dave 2026-09-04: black slab in Light)", () => {
    // "dark light" let the phone's own preference pick, and an iframe whose
    // scheme differs from its page is painted opaque in its own canvas
    // colour: OS dark + app Light = a black box, and the sender's dark text
    // written for white paper disappears into it.
    expect(sanitizeMailHtml("<p>hi</p>", { dark: true })).toMatch(/<meta name="color-scheme" content="dark">/);
    expect(sanitizeMailHtml("<p>hi</p>", { dark: false })).toMatch(/<meta name="color-scheme" content="light">/);
    // AMENDED 2026-10-05 (Dave, the warm neutrals): the mail's ink is the app's warm ink, not #111.
    expect(sanitizeMailHtml("<p>hi</p>", { dark: false })).toMatch(/color: #1F1A16/);
    expect(sanitizeMailHtml("<p>hi</p>", { dark: true })).toMatch(/color: #F7F1EA/);
    expect(out).not.toMatch(/content="dark light"/);
  });
});

describe("the reading view shows the words (Dave 2026-10-15, item 6)", () => {
  const colourOf = (html: string, sel: string, dark = true): string => {
    const doc = new DOMParser().parseFromString(sanitizeMailHtml(html, { dark }), "text/html");
    return (doc.querySelector(sel) as HTMLElement).style.color || (doc.querySelector(sel) as HTMLElement).getAttribute("color") || "";
  };
  it("dark grey text on the dark ground is lifted until it reads", () => {
    const c = colourOf('<p id="x" style="color:#333333">Hello</p>', "#x");
    expect(c).toMatch(/^rgb\(/);
    const [r] = c.match(/\d+/g)!.map(Number);
    expect(r).toBeGreaterThan(0x77);
    expect(colourOf('<font id="x" color="#000000">Hello</font>', "#x")).toMatch(/^rgb\(/);
  });
  it("text that already reads, and text on a ground the sender painted, is left exactly as sent", () => {
    expect(colourOf('<p id="x" style="color:#EEEEEE">Hi</p>', "#x")).not.toMatch(/^rgb\((?!238)/);
    expect(colourOf('<table><tr><td bgcolor="#ffffff"><p id="x" style="color:#333333">Hi</p></td></tr></table>', "#x")).toBe("rgb(51, 51, 51)");
    expect(colourOf('<div style="background:#fff"><p id="x" style="color:#333">Hi</p></div>', "#x")).toBe("rgb(51, 51, 51)");
  });
  it("a dark link becomes the frame's link blue, and light text in a light app is pulled down to read", () => {
    expect(colourOf('<a id="x" href="https://e.test" style="color:#1a0dab">go</a>', "#x")).toMatch(/10, 132, 255|0A84FF|#0a84ff/i);
    const c = colourOf('<p id="x" style="color:#ffffff">Hi</p>', "#x", false);
    const [r] = c.match(/\d+/g)!.map(Number);
    expect(r).toBeLessThan(0x90);
  });
  it("the sender's class colours are lifted only when the mail paints no ground anywhere", () => {
    expect(sanitizeMailHtml('<style>.t{color:#222222}</style><p class="t">Hi</p>', { dark: true })).not.toMatch(/color:\s*#222222/);
    expect(sanitizeMailHtml('<style>.t{color:#222222}</style><table><tr><td bgcolor="#fff" class="t">Hi</td></tr></table>', { dark: true })).toMatch(/color:\s*#222222/);
  });
  it("a picture that was not fetched leaves no empty box", () => {
    const out = sanitizeMailHtml('<img src="https://t.test/a.png" width="600" height="300" alt="">', { dark: true, remoteImages: false });
    expect(out).toMatch(/data-remote="off"/);
    expect(out).toMatch(/img\[data-remote="off"\]\s*\{\s*display:\s*none\s*!important/);
  });
});
