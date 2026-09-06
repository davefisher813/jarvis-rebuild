// Generate public/*.html from the one legal source (UP-LAUNCH-05, 2026-09-05).
//
//   npm run build:legal
//
// Run it after editing src/legal/content.ts and commit both. src/legal/sync.test.ts
// fails if you forget, and names this command.
//
// It loads the TypeScript modules directly through Node's type stripping
// (Node 22.6+), which is why content.ts imports nothing and html.ts imports
// only types: no bundler, no build step of its own, no new dependency.
import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS } from "../src/legal/content.ts";
import { renderPage } from "../src/legal/html.ts";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

let changed = 0;
for (const doc of DOCS) {
  const path = join(PUBLIC, doc.slug + ".html");
  const next = renderPage(doc);
  let prev = "";
  try { prev = readFileSync(path, "utf8"); } catch { /* first run */ }
  if (prev === next) { console.log("unchanged", doc.slug + ".html"); continue; }
  writeFileSync(path, next);
  changed += 1;
  console.log("wrote    ", doc.slug + ".html");
}
console.log(changed === 0 ? "public/ was already in step with src/legal/content.ts" : changed + " page(s) rewritten. Commit them with the content change.");
