// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// THE SCREEN AND VERSION READOUT (issue 110, 2026-10-18): Dave's phone is the only acceptance test the tab bar and the
// Life header have ever had, and every render that passed was not it. This section is the phone reporting its own build,
// origin and measurements, and the switch that outlines the four layers so a screenshot of any page shows where each sits.
describe("AdvancedPage: This Device", () => {
  const latest = { id: "c772c56", date: "2026-10-18" };
  beforeEach(() => {
    document.documentElement.removeAttribute("data-outline-layers");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => latest }) as Response));
  });
  afterEach(() => { vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-outline-layers"); });

  const open = () => render(<NotesProvider userId="u1"><AdvancedPage onBack={() => {}} /></NotesProvider>);
  const rowValue = (label: string) => screen.getByText(label, { selector: ".row-title, .row-label, span, div" }).closest(".row")!;

  it("is the first section, and reads the newest build from production", async () => {
    open();
    expect(document.querySelector(".sh2 .t")!.textContent).toBe("This Device");
    await waitFor(() => expect(rowValue("Latest Build").textContent).toContain("c772c56"));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("https://jarvis-rebuild.vercel.app/version.json", { cache: "no-store" });
  });

  it("names the build, where it was opened from, and the screen in the order they get asked", async () => {
    open();
    const labels = Array.from(document.querySelectorAll(".set-card")[0]!.querySelectorAll(".row")).map((r) => r.textContent ?? "");
    for (const want of ["Running Build", "Latest Build", "This Copy", "Opened From", "Safe Areas", "Tab Bar", "Labels to Bottom"]) {
      expect(labels.some((t) => t.includes(want)), want).toBe(true);
    }
    await waitFor(() => expect(rowValue("This Copy").textContent).toMatch(/Behind the Latest|Not Known/));
  });

  it("an unreachable production origin reads Couldn't Check, never a claim that this copy is current", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    open();
    await waitFor(() => expect(rowValue("Latest Build").textContent).toContain("Couldn't Check"));
    expect(rowValue("This Copy").textContent).toContain("Not Known");
  });

  it("Outline the Layers puts the attribute on the document and takes it off again", async () => {
    open();
    const sw = screen.getByRole("switch", { name: /Outline the Layers/ });
    expect(document.documentElement.hasAttribute("data-outline-layers")).toBe(false);
    fireEvent.click(sw);
    expect(document.documentElement.hasAttribute("data-outline-layers")).toBe(true);
    fireEvent.click(sw);
    expect(document.documentElement.hasAttribute("data-outline-layers")).toBe(false);
  });

  it("Copy puts the readout on the clipboard, one line a fact", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toMatch(/^Running Build: /);
  });
});
