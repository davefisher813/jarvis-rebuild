import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// app/ and jarvis-core/ are siblings under jarvis-rebuild/. @core is the single
// engine source. SINGLEFILE=1 inlines everything into one openable index.html
// (used for the demo build); normal builds are unaffected.
export default defineConfig({
  plugins: [react(), ...(process.env.SINGLEFILE ? [viteSingleFile()] : [])],
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
