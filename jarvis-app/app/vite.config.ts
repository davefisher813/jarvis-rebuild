import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// The app imports the verified engine as a single source via this alias.
// In the repo, app/ and jarvis-core/ are siblings under jarvis-rebuild/.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@core": resolve(__dirname, "../jarvis-core/src/index.ts"),
    },
  },
});
