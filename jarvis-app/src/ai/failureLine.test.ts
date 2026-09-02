import { describe, it, expect } from "vitest";
import { aiFailureLine } from "./failureLine";

describe("aiFailureLine", () => {
  it("names the upstream's own message from the proxy's 502 envelope", () => {
    const body = JSON.stringify({ error: "Upstream error", detail: JSON.stringify({ type: "error", error: { type: "not_found_error", message: "model: claude-nope" } }) });
    expect(aiFailureLine(new Error("AI request failed (502). " + body), "The sort didn't come back"))
      .toBe("The sort didn't come back · Server said 502 · model: claude-nope");
  });
  it("never blames Google for a proxy failure", () => {
    expect(aiFailureLine(new Error("AI request failed (500). {\"error\":\"AI not configured on the server\"}"), "The sort didn't come back"))
      .toBe("The sort didn't come back · Server said 500 · AI not configured on the server");
    expect(aiFailureLine(new Error("AI request failed (502). garbage"), "x")).toBe("x · Server said 502");
  });
  it("leaves non-proxy errors to humanError", () => {
    expect(aiFailureLine(new Error("Failed to fetch"), "x")).toBe("You're offline · Nothing was lost");
    expect(aiFailureLine(new Error("gmail 500"), "x")).toBe("Google's mail service is having trouble · Try again shortly");
  });
});
