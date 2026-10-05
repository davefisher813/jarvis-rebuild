// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AppearanceProvider } from "../appearance/AppearanceProvider";
import { readSystemTextScale } from "../appearance/textZoom";
import AppearancePage from "./AppearancePage";

// 2026-10-04 (audit): the footer said "Your phone's own text size still
// applies", and nothing builds that: readSystemTextScale returns null (the
// text-zoom plugin is not installed), so --type-scale follows only the menu.
// A promise the app does not keep is the same defect as a switch that does
// nothing, so the footer says what the menu does and no more.
describe("AppearancePage footer", () => {
  it("does not promise the phone's own text size while nothing reads it", async () => {
    expect(await readSystemTextScale()).toBeNull();
    render(<AppearanceProvider><AppearancePage onBack={() => {}} /></AppearanceProvider>);
    // And it says nothing false about the size either: "Larger Text Everywhere" sat under a value of "Default" (round 2 review).
    expect(screen.queryByText("Larger Text Everywhere")).toBeNull();
    expect(document.body.textContent).not.toMatch(/phone.{0,3}s own text size/i);
    expect(document.body.textContent).not.toMatch(/still applies/i);
  });
});
