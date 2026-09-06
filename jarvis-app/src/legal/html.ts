// UP-LAUNCH-05 (2026-09-05): the published half of the one legal source.
// tools/build-legal.mjs writes what this returns into public/<slug>.html, and
// src/legal/sync.test.ts fails when the committed file no longer matches, so
// the page App Store Connect links to cannot drift from the screen inside the
// app again.
//
// The output is byte-for-byte deterministic and matches the hand-written
// pages it replaces: same doctype line, same stylesheet, same red J, same
// card shape. Only the section headings changed case, because they are now
// the same strings the app renders and the app's copy law is Title Case.
//
// Type-only import on purpose: `node --experimental-strip-types` erases it,
// which is what lets the build script load this file with no bundler.
import type { LegalDoc, Inline, Block } from "./content";

// The five characters that can change the meaning of a document when they
// arrive from prose. Everything published here is ours, but escaping is the
// difference between a policy and an injection point the day it is not.
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(run: Inline): string {
  if (typeof run === "string") return esc(run);
  if ("b" in run) return "<b>" + esc(run.b) + "</b>";
  return '<a href="' + esc(run.href) + '">' + esc(run.a) + "</a>";
}

const runs = (rs: Inline[]): string => rs.map(inline).join("");

function block(b: Block): string {
  if (b.kind === "p") return "<p>" + runs(b.runs) + "</p>";
  if (b.kind === "card") return '<div class="card"><p>' + runs(b.runs) + "</p></div>";
  return "<ul>\n" + b.items.map((i) => "<li>" + runs(i) + "</li>").join("\n") + "\n</ul>";
}

export function renderPage(doc: LegalDoc): string {
  const out: string[] = [];
  out.push('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">');
  out.push("<title>JARVIS - " + esc(doc.title) + '</title><link rel="stylesheet" href="/_style.css"></head><body>');
  out.push("<!-- Generated from src/legal/content.ts by tools/build-legal.mjs, do not edit by hand: run npm run build:legal -->");
  out.push("<h1><span>J</span>ARVIS " + esc(doc.title) + "</h1>");
  if (doc.updated) out.push('<p class="updated">Last updated: ' + esc(doc.updated) + "</p>");
  out.push("");
  for (const b of doc.intro) out.push(block(b));
  for (const s of doc.sections) {
    out.push("");
    out.push("<h2>" + esc(s.heading) + "</h2>");
    for (const b of s.blocks) out.push(block(b));
  }
  if (doc.webFooter) {
    out.push("");
    out.push("<p>" + runs(doc.webFooter) + "</p>");
  }
  out.push("</body></html>");
  return out.join("\n") + "\n";
}
