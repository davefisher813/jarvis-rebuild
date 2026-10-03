// @vitest-environment jsdom
// THE SENDER'S HTML, INERT (IMPLEMENTATION-SPEC.md 13: "sanitized inert
// display; no context expansion, execution or remote resource fetch"). The
// Email tab asks the app's sanitiser for remote images off until the person
// taps Show Images; scripts and handlers go either way.
import { describe, it, expect } from "vitest";
import { sanitizeMailHtml } from "../messages/mailHtml";
import { hasRemoteImages } from "./format";

const MAIL = `<style>.hero { background: url(https://t.example/bg.png) } .ok { color: red }</style>
<p onclick="steal()">Amount due <b>$142.30</b></p>
<script>alert(1)</script>
<img src="https://t.example/pixel.gif" alt="tracker" width="1" height="1">
<img src="data:image/png;base64,iVBORw0KGgo=" alt="inline">
<div style="background-image: url(https://t.example/b.png); color: blue">x</div>
<a href="javascript:alert(2)">bad</a> <a href="https://example.test/ok">ok</a>`;

describe("remote images off", () => {
  it("drops every http(s) picture and keeps the inline one, with scripts and handlers gone", () => {
    const doc = sanitizeMailHtml(MAIL, { remoteImages: false });
    expect(doc).not.toMatch(/<script/i);
    expect(doc).not.toMatch(/onclick/i);
    expect(doc).not.toMatch(/javascript:/i);
    expect(doc).not.toMatch(/https:\/\/t\.example/);
    expect(doc).toMatch(/data:image\/png/);
    expect(doc).toMatch(/alt="tracker"/);
    expect(doc).toMatch(/data-remote="off"/);
    expect(doc).toMatch(/https:\/\/example\.test\/ok/);
  });
  it("Show Images is the one thing that lets them load", () => {
    const doc = sanitizeMailHtml(MAIL, { remoteImages: true });
    expect(doc).toMatch(/https:\/\/t\.example\/pixel\.gif/);
    expect(doc).not.toMatch(/<script/i);
  });
  it("the screen knows when there is something to show", () => {
    expect(hasRemoteImages(MAIL)).toBe(true);
    expect(hasRemoteImages('<p>plain</p><img src="cid:logo" alt="">')).toBe(false);
  });
});
