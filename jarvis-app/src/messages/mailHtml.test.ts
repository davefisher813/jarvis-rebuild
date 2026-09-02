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
  it("un-pins a mail that fixes html and body to 100% height, after the mail's own rules", () => {
    const i = out.lastIndexOf("<style>");
    expect(out.slice(i)).toMatch(/html, body \{ height: auto !important/);
    expect(i).toBeGreaterThan(out.indexOf("body{margin:0}"));
  });
  it("is a whole document with a dark ground", () => {
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toMatch(/color-scheme/);
  });
});
