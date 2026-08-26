import { describe, it, expect } from "vitest";
import { googleConfigured } from "./config";

describe("googleConfigured", () => {
  it("is off without a client id", () => {
    expect(googleConfigured("")).toBe(false);
    expect(googleConfigured("   ")).toBe(false);
  });
  it("is on with a client id", () => {
    expect(googleConfigured("abc.apps.googleusercontent.com")).toBe(true);
  });
});

// LAW: EVERY ENDPOINT THE CLIENT CALLS IS COVERED BY A SCOPE IT ASKS FOR
// (2026-08-26, written the day Dave reported that delete does nothing).
//
// The app shipped archive, mark-read, mute, sweep and trash on top of
// gmail.readonly, and every one of them 403'd against a real account from
// the day it was built. No test could see it, because tests talk to fakes
// and fakes do not check scopes. This law closes that hole statically: it
// reads api.ts, finds every Gmail/Calendar call the client can make, maps
// each to the scope Google's documentation requires, and fails if
// GOOGLE_SCOPES does not cover it. Add an endpoint without a scope and the
// suite goes red before a phone ever does.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GOOGLE_SCOPES } from "./config";

describe("LAW: no endpoint without its scope", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "api.ts"), "utf8");
  const MODIFY = "https://www.googleapis.com/auth/gmail.modify";
  const READ_OK = [MODIFY, "https://www.googleapis.com/auth/gmail.readonly"];
  const SEND_OK = [MODIFY, "https://www.googleapis.com/auth/gmail.send"];

  // Endpoint fingerprints in api.ts -> scopes that satisfy them (any one).
  // The mapping is Google's, not ours: https://developers.google.com/gmail/api/auth/scopes
  const NEEDS: [string, RegExp, string[]][] = [
    ["threads.modify (archive, mute, labels, read state)", /threads\/["'+ \w]*\+ id \+ ["']\/modify/, [MODIFY]],
    ["messages.modify", /messages\/["'+ \w]*\+ id \+ ["']\/modify/, [MODIFY]],
    ["threads.trash (delete)", /\/trash["']/, [MODIFY]],
    ["threads.untrash (undo delete)", /\/untrash["']/, [MODIFY]],
    ["drafts.delete", /users\/me\/drafts\/["'+ \w]*\+ id/, [MODIFY, "https://www.googleapis.com/auth/gmail.compose"]],
    ["messages.send", /messages\/send/, SEND_OK],
    ["messages/threads read", /format=metadata|format=full/, READ_OK],
    ["calendar events read", /calendar\/v3\/calendars/, [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar",
    ]],
  ];

  it("every call in api.ts is satisfied by the scopes we request", () => {
    const granted = GOOGLE_SCOPES.split(/\s+/);
    const bad: string[] = [];
    for (const [name, fingerprint, satisfiedBy] of NEEDS) {
      if (!fingerprint.test(src)) continue; // endpoint not in the client
      if (!satisfiedBy.some((s) => granted.includes(s))) {
        bad.push(name + " needs one of [" + satisfiedBy.join(", ") + "]");
      }
    }
    expect(bad, "an endpoint the scopes cannot reach fails on every real account").toEqual([]);
  });

  it("the mapping actually matched the client (fingerprints are not stale)", () => {
    // If api.ts is refactored so a fingerprint stops matching, this law
    // silently stops guarding that endpoint. Assert the core ones matched.
    for (const [name, fingerprint] of NEEDS.slice(0, 4)) {
      expect(fingerprint.test(src), name + " fingerprint no longer matches api.ts").toBe(true);
    }
  });

  it("the app never asks for the permanent-delete scope", () => {
    // https://mail.google.com/ is full access INCLUDING permanent delete.
    // The app's standing law is trash-only; the scope list must agree.
    expect(GOOGLE_SCOPES).not.toContain("https://mail.google.com/");
  });
});
