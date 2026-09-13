import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// THE SHELL ALWAYS OPENS (audit 2026-09-11 item 6, fixed 2026-09-13). The
// boot effect read the profile, seeded areas, listed categories and pulled
// settings with no guard, so any one of them throwing skipped setReady and
// left a blank screen until relaunch. The whole sequence sits in one try now,
// the failure is said out loud, and the tab bar and setReady come after the
// guard so the shell opens on whatever loaded. Read from source, the way the
// other shell laws are, because the boot is not something a component test
// can make throw halfway without rebuilding the app.
describe("AppShell boot", () => {
  const src = readFileSync(join(process.cwd(), "src", "shell", "AppShell.tsx"), "utf8");
  const start = src.indexOf("const firstBoot = useRef(true);");
  const boot = src.slice(start, src.indexOf("}, [seedDemo,", start));

  it("guards every read in the boot, says so when one fails, and still opens the shell", () => {
    expect(start).toBeGreaterThan(-1);
    const tryAt = boot.indexOf("try {");
    const getAt = boot.indexOf("await profile.get()");
    const catchAt = boot.indexOf("} catch (");
    const readyAt = boot.indexOf("setReady(true)");
    expect(tryAt, "the boot must open a try").toBeGreaterThan(-1);
    expect(getAt, "profile.get must sit inside it").toBeGreaterThan(tryAt);
    expect(boot.indexOf("categories.seedDefaults(")).toBeGreaterThan(tryAt);
    expect(boot.indexOf("categories.list()")).toBeGreaterThan(tryAt);
    expect(catchAt, "and it must be caught").toBeGreaterThan(getAt);
    expect(boot.slice(catchAt, catchAt + 400)).toMatch(/showToast\(/);
    expect(readyAt, "setReady(true) comes after the catch, so a failed read still opens the shell").toBeGreaterThan(catchAt);
    expect(boot.indexOf("setTabKeys(keys)")).toBeGreaterThan(catchAt);
  });
});
