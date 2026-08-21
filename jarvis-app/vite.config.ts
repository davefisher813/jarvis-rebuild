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
  ...(process.env.TESTPANEL
    ? { build: { rollupOptions: { input: resolve(__dirname, "test.html") } } }
    : {}),
});
