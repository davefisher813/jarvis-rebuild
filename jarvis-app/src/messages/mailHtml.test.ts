// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { sanitizeMailHtml } from "./mailHtml";

// THE MAIL AS SENT (2026-09-02). Everything that could run, load a script,
// or leave the frame goes; pictures and layout stay.
describe("sanitizeMailHtml", () => {
  const out = sanitizeMailHtml(`<html><head><script>alert(1)</script><style>body{}</style></head><body>
    <div onclick="x()" style="color:red;background:url(https://t/px.gif)">Hi <a href="javascript:alert(1)">bad</a> <a href="https://tiktok.com/x">ok</a></div>
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
    expect(out).toMatch(/style="color:red"/);
    expect(out).not.toMatch(/url\(/);
  });
  it("is a whole document with a dark ground", () => {
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toMatch(/color-scheme/);
  });
});
