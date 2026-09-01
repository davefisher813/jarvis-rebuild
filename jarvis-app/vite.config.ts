import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

// THE BUILD STAMP (2026-08-26). Twice now, "the feature isn't there" turned
// into an hour of guessing whether a phone was looking at the new build or
// an old one; the second time, the guess was wrong in both directions. The
// stamp ends the guessing: Settings > Advanced shows the commit this build
// came from, so "is my phone on it?" is a ten-second look, not a debugging
// session. On Vercel the sha comes from the deploy env; locally from git;
// "dev" when neither exists (tests, bare checkouts).
function buildSha(): string {
  const v = process.env.VERCEL_GIT_COMMIT_SHA;
  if (v) return v.slice(0, 7);
  try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "dev"; }
}

// app/ and jarvis-core/ are siblings under jarvis-rebuild/. @core is the single
// engine source. SINGLEFILE=1 inlines everything into one openable index.html
// (used for the demo build); normal builds are unaffected.
//
// CLEAN=1 (2026-09-01, Dave: "a back up clean new user version available as a
// back up at all times") also inlines to one file, but deliberately does NOT
// turn on __DEMO_SEED__ or emit the DEMO_BUILD marker. That is the whole point
// of it: a CLEAN build is a REAL build — no demo names, no fixture chunks —
// that happens to be openable as a single page, so it shows exactly what a
// stranger sees on first launch. Because it carries no marker, the no-demo-data
// law in src/laws/noDemoData.test.ts judges it as a real build rather than
// skipping it, which is the correct treatment and worth keeping that way.
export default defineConfig({
  plugins: [
    react(),
    ...(process.env.SINGLEFILE || process.env.CLEAN ? [viteSingleFile()] : []),
    // A demo build leaves a marker so the no-demo-data law can tell the two
    // apart. Without it the law fails whenever someone has built a demo
    // locally, which trains people to ignore it: a law that cries wolf is
    // worse than no law.
    ...(process.env.SINGLEFILE || process.env.DEMO
      ? [{
          name: "jarvis-demo-marker",
          generateBundle(this: unknown) {
            (this as { emitFile: (f: { type: "asset"; fileName: string; source: string }) => void })
              .emitFile({ type: "asset", fileName: "DEMO_BUILD", source: "demo\n" });
          },
        }]
      : []),
  ],
  // DEMO DATA NEVER SHIPS TO THE REAL BUILD (Dave: "why would we keep demo
  // data in the real build? that's only for previews"). Every seed and
  // fixture is reached through a dynamic import behind this constant, so
  // when it is false Rollup drops those modules from the bundle entirely
  // rather than merely never running them. Verified by grepping dist, and
  // held by a test.
  define: {
    __DEMO_SEED__: JSON.stringify(!!process.env.SINGLEFILE || !!process.env.DEMO),
    __BUILD_ID__: JSON.stringify(buildSha()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  resolve: {
    alias: { "@core": resolve(__dirname, "../jarvis-core/src/index.ts") },
    // The engine (jarvis-core) imports npm packages but its own node_modules is
    // not installed in the host's deploy (only the app's deps are). dedupe forces
    // these to resolve from the app's node_modules so the build works anywhere.
    dedupe: ["@supabase/supabase-js", "react", "react-dom"],
  },
  // CODE SPLITTING (2026-08-26, build queue item 13). The main chunk was
  // 868 KB, and roughly a third of it was vendor code that changes only when
  // a dependency is upgraded. Splitting it out does not shrink the total
  // download on a cold visit, but it means a normal app change no longer
  // invalidates React, Supabase and the icon set in everyone's cache: the
  // repeat visit that used to re-fetch 245 KB gzipped now re-fetches only
  // what actually changed.
  //
  // Three groups, each on its own release cadence:
  //   react    - react + react-dom, upgraded rarely
  //   supabase - the backend client, upgraded rarely
  //   icons    - lucide, large and almost never touched
  //
  // SINGLEFILE and CLEAN inline everything into one openable index.html, so
  // chunking is skipped for both: splitting a bundle that is about to be
  // concatenated just adds boundaries for no benefit, and rolldown rejects
  // manualChunks outright once code splitting is off.
  ...(process.env.TESTPANEL
    ? { build: { rollupOptions: { input: resolve(__dirname, "test.html") } } }
    : process.env.SINGLEFILE || process.env.CLEAN
      ? {}
      : {
          build: {
            rollupOptions: {
              output: {
                manualChunks(id: string) {
                  if (!id.includes("node_modules")) return;
                  if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
                  if (id.includes("@supabase")) return "supabase";
                  if (id.includes("lucide")) return "icons";
                },
              },
            },
          },
        }),
});
