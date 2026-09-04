// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BackupBundle } from "./BackupService";

// S3-Q16 (2026-09-04): "Export cannot save a file on the iPhone." Native and
// web take genuinely different code paths (real Capacitor plugins vs. a
// browser download), so both are covered here, along with the failure case
// the old code never had: a native write or share that actually fails must
// throw, not report success for a file that never left the device.

const isNativePlatform = vi.fn();
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));

const writeFile = vi.fn();
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: { writeFile: (opts: unknown) => writeFile(opts) },
  Directory: { Cache: "CACHE" },
  Encoding: { UTF8: "utf8" },
}));

const share = vi.fn();
vi.mock("@capacitor/share", () => ({
  Share: { share: (opts: unknown) => share(opts) },
}));

import { saveBackupFile, backupFilename } from "./exportFile";

function bundle(): BackupBundle {
  return {
    app: "jarvis",
    version: 1,
    exportedAt: "2026-09-04T12:00:00.000Z",
    items: [{ entityType: "task", data: { text: "x" } }],
  };
}

beforeEach(() => {
  isNativePlatform.mockReset();
  writeFile.mockReset();
  share.mockReset();
});

describe("backupFilename", () => {
  it("names the file by the export date", () => {
    expect(backupFilename(bundle())).toBe("jarvis-backup-2026-09-04.json");
  });
});

describe("saveBackupFile on native", () => {
  it("writes the bundle to the cache directory, then opens the share sheet with that file", async () => {
    isNativePlatform.mockReturnValue(true);
    writeFile.mockResolvedValue({ uri: "file:///cache/jarvis-backup-2026-09-04.json" });
    share.mockResolvedValue({ activityType: "com.apple.UIKit.activity.Mail" });

    await saveBackupFile(bundle());

    expect(writeFile).toHaveBeenCalledTimes(1);
    const opts = writeFile.mock.calls[0]![0] as { path: string; data: string; directory: string; encoding: string };
    expect(opts.path).toBe("jarvis-backup-2026-09-04.json");
    expect(opts.directory).toBe("CACHE");
    expect(opts.encoding).toBe("utf8");
    expect(JSON.parse(opts.data)).toEqual(bundle());

    expect(share).toHaveBeenCalledWith({
      title: "JARVIS Backup",
      files: ["file:///cache/jarvis-backup-2026-09-04.json"],
    });
  });

  it("canceling the share sheet (empty activityType) is not a failure", async () => {
    isNativePlatform.mockReturnValue(true);
    writeFile.mockResolvedValue({ uri: "file:///cache/x.json" });
    share.mockResolvedValue({ activityType: "" });

    await expect(saveBackupFile(bundle())).resolves.toBeUndefined();
  });

  it("a write failure throws, so the caller never reports a success that did not happen", async () => {
    isNativePlatform.mockReturnValue(true);
    writeFile.mockRejectedValue(new Error("disk full"));

    await expect(saveBackupFile(bundle())).rejects.toThrow("disk full");
    expect(share).not.toHaveBeenCalled();
  });

  it("a share failure throws too", async () => {
    isNativePlatform.mockReturnValue(true);
    writeFile.mockResolvedValue({ uri: "file:///cache/x.json" });
    share.mockRejectedValue(new Error("share unavailable"));

    await expect(saveBackupFile(bundle())).rejects.toThrow("share unavailable");
  });
});

describe("saveBackupFile on web", () => {
  it("downloads a blob and never touches the native plugins", async () => {
    isNativePlatform.mockReturnValue(false);
    let n = 0;
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:" + ++n, revokeObjectURL: vi.fn() });
    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    const createElSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === "a") (el as HTMLAnchorElement).click = clickSpy;
      return el;
    });
    try {
      await saveBackupFile(bundle());
      expect(clickSpy).toHaveBeenCalledTimes(1);
    } finally {
      createElSpy.mockRestore();
      vi.unstubAllGlobals();
    }
    expect(writeFile).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });
});
