// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import BackupPage from "./BackupPage";

// S3-Q16 (2026-09-04): BackupPage had no test file at all before this one.
// The page-level flow (export button -> saveBackupFile -> receipt copy) is
// covered here; exportFile.test.ts covers the native/web branching itself in
// depth, so this file mocks saveBackupFile rather than duplicating that.
const saveBackupFile = vi.fn();
vi.mock("../backup/exportFile", () => ({
  saveBackupFile: (bundle: unknown) => saveBackupFile(bundle),
}));

beforeEach(() => {
  saveBackupFile.mockReset();
  try { localStorage.clear(); } catch { /* ignore */ }
});

describe("BackupPage export", () => {
  it("saves a real file, then shows the count and stamps Last exported", async () => {
    saveBackupFile.mockResolvedValue(undefined);
    render(<NotesProvider userId="u1"><BackupPage onBack={() => {}} /></NotesProvider>);
    fireEvent.click(screen.getByText("Export All Data"));
    await waitFor(() => expect(saveBackupFile).toHaveBeenCalledTimes(1));
    await screen.findByText(/^Exported \d+ items?\.$/);
    await screen.findByText(/Last exported \d{4}-\d{2}-\d{2}/);
  });

  // S3-Q16: the old code called URL.createObjectURL + an anchor click
  // directly and reported success no matter what happened, which is exactly
  // how the iOS web view swallowed it silently. Now a real failure from
  // saveBackupFile must surface, not be papered over.
  it("a failed save shows the honest failure message, not a false success", async () => {
    saveBackupFile.mockRejectedValue(new Error("disk full"));
    render(<NotesProvider userId="u1"><BackupPage onBack={() => {}} /></NotesProvider>);
    fireEvent.click(screen.getByText("Export All Data"));
    await screen.findByText("Export failed · Try again");
    expect(screen.queryByText(/Last exported/)).not.toBeInTheDocument();
  });
});

describe("BackupPage import receipt", () => {
  // jsdom's File has no text() (see files.test.ts for the same workaround
  // with arrayBuffer()); give it the one the browser has.
  function jsonFile(bundle: unknown): File {
    const text = JSON.stringify(bundle);
    const f = new File([text], "backup.json", { type: "application/json" });
    Object.defineProperty(f, "text", { value: () => Promise.resolve(text) });
    return f;
  }

  it("names unsupported types instead of silently dropping them (S3-Q15)", async () => {
    render(<NotesProvider userId="u1"><BackupPage onBack={() => {}} /></NotesProvider>);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const bundle = {
      app: "jarvis", version: 1, exportedAt: "2026-09-01T00:00:00.000Z",
      items: [
        { entityType: "task", data: { text: "Pack the bag" } },
        { entityType: "a_future_type", data: { x: 1 } },
      ],
    };
    fireEvent.change(input, { target: { files: [jsonFile(bundle)] } });
    await screen.findByText(/Backup from 2026-09-01/);
    fireEvent.click(screen.getByText("Import"));
    await screen.findByText(/^Imported 1 item · Duplicates skipped/);
    await screen.findByText(/This build can't restore: a_future_type/);
  });

  it("a fully-understood bundle shows no unsupported-types line", async () => {
    render(<NotesProvider userId="u1"><BackupPage onBack={() => {}} /></NotesProvider>);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const bundle = {
      app: "jarvis", version: 1, exportedAt: "2026-09-01T00:00:00.000Z",
      items: [{ entityType: "task", data: { text: "Pack the bag" } }],
    };
    fireEvent.change(input, { target: { files: [jsonFile(bundle)] } });
    await screen.findByText(/Backup from 2026-09-01/);
    fireEvent.click(screen.getByText("Import"));
    await screen.findByText(/^Imported 1 item · Duplicates skipped$/);
  });
});
