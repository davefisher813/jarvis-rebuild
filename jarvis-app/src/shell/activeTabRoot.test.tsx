// @vitest-environment jsdom
//
// TAPPING THE TAB YOU ARE ON (click-through audit 2026-09-29). "Five taps on
// the Brain tab did not navigate": Health is a screen inside the Brain tab, so
// from Health the Brain tab was already the active one and a tap on it did
// nothing until the app was reloaded. A second tap on the open tab now goes
// back to that tab's root, the way a native tab bar does.
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

describe("tapping the active tab", () => {
  it("goes back to the tab's root from a screen inside it", async () => {
    render(<AppearanceProvider><AuthProvider><NotesProvider userId="u-active-tab-root"><AppShell /></NotesProvider></AuthProvider></AppearanceProvider>);
    await screen.findByText("Brain", { selector: ".tab" }, { timeout: 8000 });
    fireEvent.click(tab("Brain"));
    // The hub lists its doors; open one, which is a screen inside the tab.
    const door = await screen.findByText("What JARVIS Knows", { selector: ".lib-name" }, { timeout: 8000 });
    fireEvent.click(door);
    await waitFor(() => expect(screen.queryByText("What JARVIS Knows", { selector: ".lib-name" })).toBeNull(), { timeout: 8000 });
    expect(tab("Brain")).toHaveClass("active");
    // The same tab again: the hub is back.
    fireEvent.click(tab("Brain"));
    await screen.findByText("What JARVIS Knows", { selector: ".lib-name" }, { timeout: 8000 });
    expect(tab("Brain")).toHaveClass("active");
  }, 40_000);
});
