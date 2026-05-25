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
  },
  ...(process.env.TESTPANEL
    ? { build: { rollupOptions: { input: resolve(__dirname, "test.html") } } }
    : {}),
});
