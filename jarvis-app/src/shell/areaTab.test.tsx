// @vitest-environment jsdom
//
// AN AREA OPENED FROM LIFE IS LIFE'S PAGE (Dave 2026-10-05, the round-2 review: "On Health (reached from Life) the bottom bar lights
// More in red and Life is grey"). The page is Brain's CategoryDetail, which is no tab, so the bar used to fall back to More.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { AppearanceProvider } from "../appearance/AppearanceProvider";
import { AuthProvider } from "../auth/AuthProvider";
import AppShell from "./AppShell";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
(Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};

const tab = (label: string) => screen.getByText(label, { selector: ".tab" });

describe("the tab bar on an area page reached from Life", () => {
  it("keeps Life lit, never More, and Life stays the way back", async () => {
    render(<AppearanceProvider><AuthProvider><NotesProvider userId="u-area-tab"><AppShell /></NotesProvider></AuthProvider></AppearanceProvider>);
    await screen.findByText("Life", { selector: ".tab" }, { timeout: 8000 });
    fireEvent.click(tab("Life"));
    const area = await waitFor(() => {
      const el = document.querySelector(".area-card") as HTMLElement | null;
      if (!el) throw new Error("no area yet");
      return el;
    }, { timeout: 8000 });
    fireEvent.click(area);
    // The area's own page is up (its nav bar has the Edit and Back controls)...
    await screen.findByLabelText("Back", {}, { timeout: 8000 });
    // ...and the bar still says Life.
    expect(tab("Life")).toHaveClass("active");
    expect(tab("More")).not.toHaveClass("active");
  }, 40_000);
});
