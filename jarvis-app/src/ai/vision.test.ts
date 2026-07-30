import { describe, it, expect } from "vitest";
import { buildVisionMessage } from "./AIService";

describe("buildVisionMessage", () => {
  it("builds one user message with the image first and the task after", () => {
    const m = buildVisionMessage("Describe the style.", "BASE64DATA", "image/jpeg");
    expect(m.role).toBe("user");
    const blocks = m.content as { type: string }[];
    expect(blocks[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "BASE64DATA" } });
    expect(blocks[1]).toEqual({ type: "text", text: "Describe the style." });
  });

  it("defaults to jpeg", () => {
    const m = buildVisionMessage("t", "d");
    const img = (m.content as { source?: { media_type: string } }[])[0];
    expect(img?.source?.media_type).toBe("image/jpeg");
  });
});
