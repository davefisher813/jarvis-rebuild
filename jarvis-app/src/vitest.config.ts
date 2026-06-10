import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@core": resolve(__dirname, "../jarvis-core/src/index.ts") },
  },
  test: { globals: true, environment: "node" },
});
