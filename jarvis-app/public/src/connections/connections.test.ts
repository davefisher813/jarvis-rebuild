import { describe, it, expect } from "vitest";
import { PROVIDERS, webProviders, nativeProviders, isConnected } from "./providers";
import { EMPTY_PROFILE } from "../profile/types";

describe("connections registry", () => {
  it("splits web vs native sources", () => {
    expect(webProviders().map((p) => p.key)).toContain("gmail");
    expect(nativeProviders().map((p) => p.key)).toContain("appleHealth");
    expect(PROVIDERS.find((p) => p.key === "metaGlasses")?.experimental).toBe(true);
  });

  it("reads the generic map and falls back to legacy flags", () => {
    expect(isConnected({ ...EMPTY_PROFILE, gmail: true }, "gmail")).toBe(true);
    expect(isConnected({ ...EMPTY_PROFILE, connections: { appleMusic: true } }, "appleMusic")).toBe(true);
    expect(isConnected({ ...EMPTY_PROFILE }, "appleHealth")).toBe(false);
  });
});
