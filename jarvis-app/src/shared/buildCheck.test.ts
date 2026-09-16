import { describe, it, expect, vi } from "vitest";
import { runningBundle, deployedBundle, isStale, checkBuild } from "./buildCheck";

// THE DAY OF SHIPPED WORK NOBODY COULD SEE (Dave 2026-09-16: "I don't see any
// difference... it's been the same push forever").
//
// Two halves, and fixing either alone changes nothing:
//  1. A home-screen app on iOS SUSPENDS and RESUMES. No `load`, no
//     navigation, so the service worker's network-first HTML handler -- the
//     thing that would have caught a deploy -- never runs.
//  2. reg.update() cannot cover for it, because the browser installs a new
//     worker only when /sw.js differs byte for byte, and sw.js is static. It
//     is identical across every deploy that does not edit it.
//
// So the check reads the thing that DOES change: the hashed entry bundle.

const HTML = (name: string) =>
  `<!doctype html><html><head><script type="module" crossorigin src="${name}"></script>` +
  `<link rel="stylesheet" href="/assets/index-zzz.css"></head><body><div id="root"></div></body></html>`;

const res = (body: string, ok = true) => ({ ok, text: async () => body }) as Response;

describe("which bundle is running", () => {
  it("reads the path out of the module URL, however it is spelled", () => {
    expect(runningBundle("https://app.example.com/assets/index-a1b2c3.js")).toBe("/assets/index-a1b2c3.js");
    expect(runningBundle("/assets/index-a1b2c3.js")).toBe("/assets/index-a1b2c3.js");
  });
  it("is null where there is no module URL to read", () => {
    expect(runningBundle(undefined)).toBeNull();
    expect(runningBundle("")).toBeNull();
  });
});

describe("which bundle is deployed", () => {
  it("reads the entry script out of the served HTML", () => {
    expect(deployedBundle(HTML("/assets/index-NEW.js"))).toBe("/assets/index-NEW.js");
  });
  it("is null when the document names none, rather than guessing", () => {
    expect(deployedBundle("<!doctype html><html><body>nope</body></html>")).toBeNull();
    expect(deployedBundle("")).toBeNull();
  });
});

// A reload on a bad read is a reload LOOP, which is worse than a stale tab by
// a wide margin. Unknown is never stale.
describe("staleness is only ever claimed on two known values", () => {
  it("says stale when the two disagree", () => {
    expect(isStale("/assets/index-OLD.js", "/assets/index-NEW.js")).toBe(true);
  });
  it("says fresh when they match", () => {
    expect(isStale("/assets/index-SAME.js", "/assets/index-SAME.js")).toBe(false);
  });
  it("never says stale on an unknown", () => {
    expect(isStale(null, "/assets/index-NEW.js")).toBe(false);
    expect(isStale("/assets/index-OLD.js", null)).toBe(false);
    expect(isStale(null, null)).toBe(false);
  });
});

describe("checkBuild", () => {
  const moduleUrl = "https://app.example.com/assets/index-OLD.js";

  it("reloads when the server is serving a different build", async () => {
    const reload = vi.fn();
    const fetchImpl = vi.fn(async () => res(HTML("/assets/index-NEW.js"))) as unknown as typeof fetch;
    expect(await checkBuild({ fetchImpl, reload, moduleUrl })).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("asks the network, never the HTTP cache -- a deploy behind a cached 200 is the bug", async () => {
    const fetchImpl = vi.fn(async () => res(HTML("/assets/index-OLD.js"))) as unknown as typeof fetch;
    await checkBuild({ fetchImpl, reload: () => {}, moduleUrl });
    expect(fetchImpl).toHaveBeenCalledWith("/index.html", { cache: "no-store" });
  });

  it("does nothing when this IS the deployed build", async () => {
    const reload = vi.fn();
    const fetchImpl = vi.fn(async () => res(HTML("/assets/index-OLD.js"))) as unknown as typeof fetch;
    expect(await checkBuild({ fetchImpl, reload, moduleUrl })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does nothing offline, on an error page, or on a body that names no bundle", async () => {
    const reload = vi.fn();
    const offline = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await checkBuild({ fetchImpl: offline, reload, moduleUrl })).toBe(false);
    const notFound = (async () => res("", false)) as unknown as typeof fetch;
    expect(await checkBuild({ fetchImpl: notFound, reload, moduleUrl })).toBe(false);
    const junk = (async () => res("<html>captive portal</html>")) as unknown as typeof fetch;
    expect(await checkBuild({ fetchImpl: junk, reload, moduleUrl })).toBe(false);
    expect(reload, "no failure path may reload").not.toHaveBeenCalled();
  });

  it("does nothing when it cannot tell what it is running", async () => {
    const reload = vi.fn();
    const fetchImpl = vi.fn(async () => res(HTML("/assets/index-NEW.js"))) as unknown as typeof fetch;
    expect(await checkBuild({ fetchImpl, reload, moduleUrl: undefined })).toBe(false);
    expect(fetchImpl, "and does not even ask").not.toHaveBeenCalled();
  });
});

// The wiring, pinned: the check has to run when the app comes back to the
// FRONT, because that is the only moment a suspended app rejoins the world.
describe("it runs on the event that actually happens", () => {
  const main = () => require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "main.tsx"), "utf8") as string;
  it("checks on visibility and on a bfcache restore, not only on load", () => {
    const src = main();
    expect(src).toMatch(/document\.addEventListener\("visibilitychange"/);
    expect(src).toMatch(/window\.addEventListener\("pageshow"/);
    expect(src).toMatch(/checkBuild\(/);
  });
  it("still runs when the service worker failed to register, which is the stuck case", () => {
    expect(main()).toMatch(/\.catch\(\(\) => \{[\s\S]{0,260}watch\(null\)/);
  });
});
