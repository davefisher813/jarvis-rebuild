import { describe, it, expect } from "vitest";
import { googleConfigured } from "./config";

describe("googleConfigured", () => {
  it("is off without a client id", () => {
    expect(googleConfigured("")).toBe(false);
    expect(googleConfigured("   ")).toBe(false);
  });
  it("is on with a client id", () => {
    expect(googleConfigured("abc.apps.googleusercontent.com")).toBe(true);
  });
});
