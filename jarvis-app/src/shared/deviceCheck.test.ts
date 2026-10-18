// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fetchLatestBuild, readDevice, readoutLines, readoutText, versionVerdict, PRODUCTION_ORIGIN, type DeviceReading } from "./deviceCheck";

// THE SCREEN AND VERSION READOUT (issue 110, 2026-10-18). What is proven: the newest build is asked of the production
// origin and only a clean answer counts; "this copy is current" is never claimed on a guess; the readout names the build,
// the origin, the screen and the safe areas in the order they get asked, and says so plainly when a layer is not on screen.

const ok = (body: unknown) => (async () => ({ ok: true, json: async () => body }) as Response) as unknown as typeof fetch;

describe("the newest build is asked of the production origin", () => {
  it("reads version.json from production, never from the host the app is running on", async () => {
    const f = vi.fn(ok({ id: "c772c56", date: "2026-10-18" }));
    expect(await fetchLatestBuild(f)).toEqual({ id: "c772c56", date: "2026-10-18" });
    expect(f).toHaveBeenCalledWith(`${PRODUCTION_ORIGIN}/version.json`, { cache: "no-store" });
  });

  it("anything that is not a clean answer is null: an error status, a body of another shape, a thrown request", async () => {
    expect(await fetchLatestBuild((async () => ({ ok: false }) as Response) as unknown as typeof fetch)).toBeNull();
    expect(await fetchLatestBuild(ok({ id: 7 }))).toBeNull();
    expect(await fetchLatestBuild(ok(null))).toBeNull();
    expect(await fetchLatestBuild((async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe("this copy against the newest build", () => {
  const latest = { id: "c772c56", date: "2026-10-18" };
  it("current when the stamps match, behind when they do not", () => {
    expect(versionVerdict("c772c56", latest)).toBe("current");
    expect(versionVerdict("2b1f434", latest)).toBe("behind");
  });
  it("unknown, never current, when there is nothing to compare: no answer, or a dev build", () => {
    expect(versionVerdict("c772c56", null)).toBe("unknown");
    expect(versionVerdict("dev", latest)).toBe("unknown");
  });
});

const reading = (over: Partial<DeviceReading> = {}): DeviceReading => ({
  origin: "https://jarvis-rebuild.vercel.app", iosVersion: "26.0", installedNavigator: true, installedDisplayMode: true, fullHeightMode: true, nativeShell: false, workerControls: true,
  runningBundle: "/assets/index-abc.js", innerW: 390, innerH: 785, visualH: 785, visualTop: 0, visualScale: 1,
  screenW: 390, screenH: 844, ratio: 3, largeH: 844, smallH: 785, dynamicH: 785, appH: 844, insetTop: 59, insetBottom: 34,
  shell: { top: 0, bottom: 844, height: 844 }, scroller: { top: 0, bottom: 769, height: 769 },
  tabBar: { top: 769, bottom: 844, height: 75 }, pageBar: null, labelsBottom: 828, ...over,
});
const line = (ls: ReturnType<typeof readoutLines>, label: string) => ls.find((l) => l.label === label)!.parts;

describe("the readout", () => {
  const running = { id: "2b1f434", date: "2026-10-17" };
  it("leads with the build, the newest build, the verdict and where it was opened from", () => {
    const ls = readoutLines(reading(), running, { id: "c772c56", date: "2026-10-18" });
    expect(ls.slice(0, 4).map((l) => l.label)).toEqual(["Running Build", "Latest Build", "This Copy", "Opened From"]);
    expect(line(ls, "Running Build")).toEqual(["2b1f434", "2026-10-17"]);
    expect(line(ls, "Latest Build")).toEqual(["c772c56", "2026-10-18"]);
    expect(line(ls, "This Copy")).toEqual(["Behind the Latest"]);
    expect(line(ls, "Opened From")).toEqual(["https://jarvis-rebuild.vercel.app"]);
  });

  it("says Checking while the answer is out and Couldn't Check when it never came, and claims nothing either way", () => {
    expect(line(readoutLines(reading(), running, "checking"), "Latest Build")).toEqual(["Checking"]);
    const none = readoutLines(reading(), running, null);
    expect(line(none, "Latest Build")).toEqual(["Couldn't Check"]);
    expect(line(none, "This Copy")).toEqual(["Not Known"]);
  });

  it("measures the labels' distance to the bottom against the window and against the screen", () => {
    expect(line(readoutLines(reading(), running, null), "Labels to Bottom")).toEqual(["Window -43", "Screen 16"]);
  });

  it("names a layer that is not on this screen instead of printing zeros, and a unit the engine lacks as Not Reported", () => {
    const ls = readoutLines(reading({ pageBar: null, largeH: null }), running, null);
    expect(line(ls, "Page Bar")).toEqual(["Not on This Screen"]);
    expect(line(ls, "Height Units")[0]).toBe("Large Not Reported");
  });

  it("keeps what iOS says about being installed apart from whether the full-height rule is on, because they have disagreed", () => {
    const ls = readoutLines(reading({ installedNavigator: false, installedDisplayMode: false, fullHeightMode: true }), running, null);
    expect(line(ls, "Installed")).toEqual(["Navigator No", "Display No"]);
    expect(line(ls, "Full Height Rule")).toEqual(["On", "Web"]);
  });

  it("reads as plain text, one line a fact, for the clipboard", () => {
    const text = readoutText(readoutLines(reading(), running, null));
    expect(text.split("\n")[0]).toBe("Running Build: 2b1f434, 2026-10-17");
    expect(text).toContain("Safe Areas: Top 59, Bottom 34");
  });

  it("no drawn line carries a middle dot or an em dash: the dots between facts are the stylesheet's", () => {
    const text = readoutText(readoutLines(reading(), running, { id: "c772c56", date: "2026-10-18" }));
    expect(text).not.toMatch(/·|—/);
  });
});

describe("readDevice", () => {
  it("never throws where the platform has nothing to say (no visual viewport, no env(), no tab bar)", () => {
    const d = readDevice("/assets/index-x.js");
    expect(d.runningBundle).toBe("/assets/index-x.js");
    expect(d.insetTop).toBe(0);
    expect(d.tabBar).toBeNull();
    expect(d.labelsBottom).toBeNull();
    expect(typeof d.origin).toBe("string");
  });
});
