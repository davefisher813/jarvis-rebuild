import type { CapacitorConfig } from "@capacitor/cli";

// Native wrapper config. appId is the iOS bundle identifier: it must match the
// identifier registered in the Apple Developer account before submission
// (change here + in ios/App if it differs; one rename, low cost).
const config: CapacitorConfig = {
  appId: "com.bridge.jarvis",
  appName: "JARVIS",
  webDir: "dist",
  ios: {
    // Match the app's dark shell so the webview never flashes white behind
    // the UI during load or keyboard transitions.
    backgroundColor: "#000000",
  },
};

export default config;
