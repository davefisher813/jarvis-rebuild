import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  // Tests exercise the demo fixtures on purpose, so the constant is true here.
  // It is the BUILD that strips them (see vite.config.ts).
  define: { __DEMO_SEED__: "true" },
  resolve: {
    alias: { "@core": resolve(__dirname, "../jarvis-core/src/index.ts") },
  },
  test: { globals: true, environment: "node" },
});
