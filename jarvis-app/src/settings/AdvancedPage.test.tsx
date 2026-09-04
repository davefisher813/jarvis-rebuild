// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import * as clearLocalDataModule from "./clearLocalData";
import AdvancedPage from "./AdvancedPage";

// S3-Q17 (2026-09-04): AdvancedPage had no test file before this one. The
// button used to call the bare localStorage.clear(); this proves it now
// goes through the namespaced clearLocalData() instead, armed the same way
// every other danger row in this app is (tap once to arm, tap again to
// confirm).
vi.mock("../shared/toast", () => ({ showToast: () => {} }));

describe("AdvancedPage: Clear Local Data", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("is armed (two taps), and the confirm tap calls the namespaced clear, not a bare wipe", () => {
    const spy = vi.spyOn(clearLocalDataModule, "clearLocalData").mockImplementation(() => {});
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, reload: reloadSpy }, writable: true });

    render(<NotesProvider userId="u1"><AdvancedPage onBack={() => {}} /></NotesProvider>);
    expect(screen.queryByText("Tap Again to Confirm")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Clear Local Data"));
    fireEvent.click(screen.getByText("Tap Again to Confirm"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
