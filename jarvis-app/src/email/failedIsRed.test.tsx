// @vitest-environment jsdom
// A FAILED SEND IS AN ERROR AND READS AS ONE (Alfred's ruling 2026-11-06 under Dave's word, issue 107 B4: "Failed-send and
// Connections line: RED"). Recoverable connection states stay amber (connectionColour.test.tsx), and the Email tab's warning mark stays
// amber in light as in dark (same file; the ruling's "Tab mark in light mode: keep AMBER"). What is red, and stays red:
//   - the line on a send proven not sent (Send Outcome's .input-error);
//   - the Connections page's sign-in failure line (.conn-error).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import SendOutcomeScreen from "./SendOutcomeScreen";
import type { DraftRow } from "./drafts";

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const SHEETS = readdirSync(join(SRC, "styles")).filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(SRC, "styles", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).join("\n");
const bodyOf = (sel: string) => [...SHEETS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => (m[1] ?? "").trim().replace(/\s+/g, " ") === sel).map((m) => m[2]).join(";");
const RED = /color:\s*var\(--(sys-red|red)\)/;

describe("red where a send failed", () => {
  it("the error line's rule paints the key's red", () => {
    expect(bodyOf(".input-error:not(input)")).toMatch(RED);
    expect(bodyOf(".conn-error")).toMatch(RED);
  });
  it("a send proven not sent draws its why in that red line", () => {
    const draft = { id: "d1", account_id: "a", subject: "Tuesday", to_addresses: ["sam@x.test"], cc_addresses: [], bcc_addresses: [], body_text: "Tuesday works.", attachment_refs: [], send_state: "failed", action_verb: "Not Sent · Gmail Refused It", error_code: null } as unknown as DraftRow;
    const { container } = render(<SendOutcomeScreen draft={draft} offline={false} checking={false} checkLine={null} onBack={() => {}} onReviewAgain={() => {}} onCheckAgain={() => {}} onReceipt={() => {}} />);
    const line = container.querySelector(".input-error");
    expect(line).toBeTruthy();
    expect(line).toHaveTextContent(/Not Sent/);
  });
});
