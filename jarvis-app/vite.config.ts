import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// app/ and jarvis-core/ are siblings under jarvis-rebuild/. @core is the single
// engine source. SINGLEFILE=1 inlines everything into one openable index.html
// (used for the demo build); normal builds are unaffected.
export default defineConfig({
  plugins: [
    react(),
    ...(process.env.SINGLEFILE ? [viteSingleFile()] : []),
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
  // SINGLEFILE inlines everything into one openable index.html, so chunking
  // is skipped there: splitting a bundle that is about to be concatenated
  // just adds boundaries for no benefit.
  ...(process.env.TESTPANEL
    ? { build: { rollupOptions: { input: resolve(__dirname, "test.html") } } }
    : process.env.SINGLEFILE
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
