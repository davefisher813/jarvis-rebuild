// @vitest-environment jsdom
//
// A TOAST BELONGS TO THE SCREEN IT WAS RAISED ON (Dave 2026-10-05, "he opens the app and finds nothing"). A receipt such as
// "Moved Rent to Tomorrow" rode along into the next tab and sat over a page it had nothing to do with, Undo included.
// The shell calls dismissForNavigation when the tab (or Search, or Quick Capture) changes.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { AppearanceProvider } from "../appearance/AppearanceProvider";
import { AuthProvider } from "../auth/AuthProvider";
import AppShell from "./AppShell";
import { showToast, resetToasts, TOAST_NAV_GRACE_MS } from "../shared/toast";

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
(Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};

const tab = (label: string) => screen.getByText(label, { selector: ".tab" });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => resetToasts());

describe("a toast does not survive a change of screen", () => {
  it("is gone after a tab change, but not if it was raised with the change", async () => {
    render(<AppearanceProvider><AuthProvider><NotesProvider userId="u-toast-nav"><AppShell /></NotesProvider></AuthProvider></AppearanceProvider>);
    await screen.findByText("Brain", { selector: ".tab" }, { timeout: 8000 });

    // A receipt from Today, seen for a while, then the person goes to Brain.
    act(() => showToast({ message: "Moved Rent to Tomorrow", actionLabel: "Undo", onAction: () => {} }));
    expect(screen.getByText("Moved Rent to Tomorrow")).toBeInTheDocument();
    await act(async () => { await wait(TOAST_NAV_GRACE_MS + 100); });
    fireEvent.click(tab("Brain"));
    await waitFor(() => expect(screen.queryByText("Moved Rent to Tomorrow")).toBeNull());

    // A toast raised in the same gesture as the change belongs to the screen being opened.
    await screen.findByText("What JARVIS Knows", { selector: ".lib-name" }, { timeout: 8000 });
    act(() => showToast({ message: "Opened Today" }));
    fireEvent.click(tab("Today"));
    await act(async () => { await wait(50); });
    expect(screen.getByText("Opened Today")).toBeInTheDocument();
  }, 40_000);
});
