// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// TODAY-F-03 / LIFE-F-06 (2026-09-05): "Add to Calendar does nothing on the
// iPhone, and says it did." downloadIcs was a blob-and-anchor click, which the
// iOS WKWebView silently ignores, and the toast fired on the next line
// regardless. Native and web are genuinely different paths (Filesystem +
// Share vs a browser download), so both are covered here, plus the failure
// that must reach the caller rather than being reported as success.

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

import { saveIcsFile } from "./ics";

const ICS = "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";

beforeEach(() => {
  isNativePlatform.mockReset();
  writeFile.mockReset();
  share.mockReset();
});

describe("saveIcsFile on the phone", () => {
  it("writes the .ics to the cache, then hands that file to the share sheet", async () => {
    isNativePlatform.mockReturnValue(true);
    writeFile.mockResolvedValue({ uri: "file:///cache/jarvis-reminder.ics" });
    share.mockResolvedValue({ activityType: "com.apple.mobilecal" });

    await saveIcsFile(ICS, "jarvis-reminder.ics");

    const opts = writeFile.mock.calls[0]![0] as { path: string; data: string; directory: string; encoding: string };
    expect(opts).toMatchObject({ path: "jarvis-reminder.ics", data: ICS, directory: "CACHE", encoding: "utf8" });
    expect(share).toHaveBeenCalledWith({ title: "Add to Calendar", files: ["file:///cache/jarvis-reminder.ics"] });
  });

  it("a failed handoff throws, so nothing can toast Opening Calendar over it", async () => {
    isNativePlatform.mockReturnValue(true);
    writeFile.mockRejectedValue(new Error("disk full"));
    await expect(saveIcsFile(ICS)).rejects.toThrow("disk full");
    expect(share).not.toHaveBeenCalled();
  });

  it("[edge] cancelling the share sheet is not a failure", async () => {
    isNativePlatform.mockReturnValue(true);
    writeFile.mockResolvedValue({ uri: "file:///cache/x.ics" });
    share.mockResolvedValue({ activityType: "" });
    await expect(saveIcsFile(ICS)).resolves.toBeUndefined();
  });
});

describe("saveIcsFile on the web", () => {
  it("downloads the file and never touches the native plugins", async () => {
    isNativePlatform.mockReturnValue(false);
    vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:1", revokeObjectURL: vi.fn() });
    const clickSpy = vi.fn();
    const origCreateElement = document.createElement.bind(document);
    const createElSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreateElement(tag);
      if (tag === "a") (el as HTMLAnchorElement).click = clickSpy;
      return el;
    });
    try {
      await saveIcsFile(ICS);
      expect(clickSpy).toHaveBeenCalledTimes(1);
    } finally {
      createElSpy.mockRestore();
      vi.unstubAllGlobals();
    }
    expect(writeFile).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });
});
