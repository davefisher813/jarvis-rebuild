// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import * as clearLocalDataModule from "./clearLocalData";
import AdvancedPage from "./AdvancedPage";

// S3-Q17 (2026-09-04): AdvancedPage had no test file before this one. The
// button used to call the bare localStorage.clear(); this proves it now
// goes through the namespaced clearLocalData() instead, armed the same way
// every other danger row in this app is (tap once to arm, tap again to
// confirm).
const showToast = vi.fn();
vi.mock("../shared/toast", () => ({ showToast: (t: unknown) => showToast(t) }));
const saveBackupFile = vi.fn();
vi.mock("../backup/exportFile", () => ({ saveBackupFile: (b: unknown) => saveBackupFile(b) }));

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

// Slice 09 QA (2026-10-04): Export Data opened the Backup page and exported nothing.
describe("AdvancedPage: Export Data", () => {
  beforeEach(() => { showToast.mockReset(); saveBackupFile.mockReset(); });

  it("tapping it hands a real backup file to the platform and says how many items, without leaving the page", async () => {
    saveBackupFile.mockResolvedValue(true);
    const onBack = vi.fn();
    render(<NotesProvider userId="u1"><AdvancedPage onBack={onBack} /></NotesProvider>);
    fireEvent.click(screen.getByText("Export Data"));
    await waitFor(() => expect(saveBackupFile).toHaveBeenCalledTimes(1));
    const bundle = saveBackupFile.mock.calls[0]![0] as { exportedAt: string; items: unknown[] };
    expect(typeof bundle.exportedAt).toBe("string");
    expect(Array.isArray(bundle.items)).toBe(true);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: expect.stringMatching(/^Exported \d+ Items?$/) }));
    expect(screen.getByText("Export Data")).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("a dismissed share sheet says nothing; a real failure says so", async () => {
    saveBackupFile.mockResolvedValueOnce(false);
    render(<NotesProvider userId="u1"><AdvancedPage onBack={() => {}} /></NotesProvider>);
    fireEvent.click(screen.getByText("Export Data"));
    await waitFor(() => expect(saveBackupFile).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(showToast).not.toHaveBeenCalled();
    saveBackupFile.mockRejectedValueOnce(new Error("disk full"));
    fireEvent.click(screen.getByText("Export Data"));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ message: "Export Failed · Try Again" }));
  });
});
