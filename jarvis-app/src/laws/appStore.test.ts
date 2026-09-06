import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// THE SHIPPING BUILD'S LAWS (UP-LAUNCH-03, 2026-09-05).
//
// Everything in laws.test.ts is about what the app says and does. This file
// is about the two files that decide whether the app runs at all on a
// stranger's phone: ios/App/App/Info.plist and the privacy manifest beside
// it. Both are edited by hand, both are invisible in the web build, and both
// fail LOUDLY and late: a missing usage string is not a degraded feature, it
// is iOS terminating the process the first time a tester taps Take Photo,
// and a privacy manifest that is not in the Resources build phase is a file
// that exists in the repo and not in the bundle.
//
// So the rule is: every permission the SOURCE asks for has a string in the
// PLIST, checked here rather than discovered in TestFlight.

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const IOS = join(ROOT, "ios", "App");
const read = (f: string) => readFileSync(f, "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const SOURCES = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f));
const ALL_SOURCE = SOURCES.map(read).join("\n");

const plist = read(join(IOS, "App", "Info.plist"));
// The plist's comments say why each key is there, and one of them names the
// key it replaced, so a check on a VALUE reads the file without them.
const plistValues = plist.replace(/<!--[\s\S]*?-->/g, " ");
// A plist string value, by key. Deliberately a regex over the text rather
// than a plist parser: the file carries comments that say WHY each key is
// there, and every parser drops them.
function plistString(key: string): string | null {
  const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist);
  return m ? m[1]! : null;
}

describe("APP STORE LAW: every permission the code asks for has a usage string", () => {
  it("the weather line asks for location, so the plist explains location", () => {
    expect(ALL_SOURCE, "this law is only meaningful while something asks").toContain("navigator.geolocation");
    const s = plistString("NSLocationWhenInUseUsageDescription");
    expect(s, "NSLocationWhenInUseUsageDescription is missing").toBeTruthy();
    // Apple rejects a string that does not say what the data is used FOR.
    expect(s!.length).toBeGreaterThan(30);
  });

  it("an image input offers Take Photo, so the plist explains the camera", () => {
    // The system sheet behind <input type="file" accept="image/*"> offers the
    // camera, which is a camera access as far as iOS is concerned.
    expect(ALL_SOURCE).toMatch(/accept=\{?["']?image\/\*/);
    const s = plistString("NSCameraUsageDescription");
    expect(s, "NSCameraUsageDescription is missing").toBeTruthy();
    expect(s!.length).toBeGreaterThan(30);
  });

  it("nothing saves to the photo library, so no library string is claimed", () => {
    // If a save-to-library path ever appears, this test is the reminder that
    // NSPhotoLibraryAddUsageDescription has to appear with it. Files leave
    // through the share sheet from the app's own cache directory today.
    const savesToLibrary = /saveToPhotos|PHPhotoLibrary|Directory\.Photos/.test(ALL_SOURCE);
    if (!savesToLibrary) expect(plistString("NSPhotoLibraryAddUsageDescription")).toBeNull();
  });

  it("the app never writes to Apple Health, and never says it might", () => {
    // The staged strings file says it in prose; here it cannot be forgotten.
    expect(plistValues).not.toContain("NSHealthUpdateUsageDescription");
  });

  it("the staged native seven strings stay staged until their plugin compiles", () => {
    // Asking for HealthKit, Calendar, Reminders or Contacts before the plugin
    // exists is a permission prompt with nothing behind it. src/native is
    // still every method throwing NotStagedError.
    const bridge = read(join(SRC, "native", "bridge.ts"));
    if (bridge.includes("NotStagedError")) {
      for (const key of [
        "NSHealthShareUsageDescription",
        "NSCalendarsFullAccessUsageDescription",
        "NSRemindersFullAccessUsageDescription",
        "NSContactsUsageDescription",
      ]) expect(plistValues, key + " ships before its plugin does").not.toContain(key);
    }
  });
});

describe("APP STORE LAW: the build settings match the app that exists", () => {
  it("portrait only, the same as the web manifest", () => {
    const manifest = JSON.parse(read(join(ROOT, "public", "manifest.webmanifest"))) as { orientation?: string };
    expect(manifest.orientation).toBe("portrait");
    const block = /<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plistValues);
    expect(block, "UISupportedInterfaceOrientations must exist").toBeTruthy();
    expect(block![1]).not.toContain("Landscape");
  });

  it("no armv7 device capability: no iOS 12 or later device is 32 bit", () => {
    expect(plistValues).not.toContain("armv7");
  });
});

describe("APP STORE LAW: the privacy manifest ships and is true", () => {
  const manifestPath = join(IOS, "App", "PrivacyInfo.xcprivacy");
  const manifest = existsSync(manifestPath) ? read(manifestPath) : "";

  it("exists in the App target's own directory", () => {
    expect(existsSync(manifestPath), "ios/App/App/PrivacyInfo.xcprivacy is missing").toBe(true);
  });

  it("is in the Resources build phase, or it is a file that never ships", () => {
    // The failure this catches is silent: Xcode builds fine, the bundle has
    // no manifest, and App Store Connect rejects the upload.
    const pbx = read(join(IOS, "App.xcodeproj", "project.pbxproj"));
    expect(pbx).toContain("PrivacyInfo.xcprivacy in Resources");
    const phase = /PBXResourcesBuildPhase[\s\S]*?files = \(([\s\S]*?)\);/.exec(pbx);
    expect(phase![1]).toContain("PrivacyInfo.xcprivacy");
  });

  it("declares no tracking and no tracking domains", () => {
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    expect(manifest).toMatch(/<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
  });

  it("declares no data type the shipping binary cannot collect", () => {
    // Same reasoning as the usage strings above, from the other end: the
    // manifest has to agree with the App Privacy answers in App Store
    // Connect, and a type the app cannot reach is a question with no answer.
    const bridge = read(join(SRC, "native", "bridge.ts"));
    if (bridge.includes("NotStagedError")) {
      for (const type of ["TypeHealth", "TypeFitness", "TypeContacts"]) {
        expect(manifest, type + " is declared before its plugin compiles").not.toContain(type);
      }
    }
  });

  it("keeps the three required-reason API declarations", () => {
    for (const reason of ["CA92.1", "C617.1", "E174.1"]) expect(manifest).toContain(reason);
  });
});
