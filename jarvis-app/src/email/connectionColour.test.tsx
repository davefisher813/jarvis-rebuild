// @vitest-environment jsdom
// RECOVERABLE IS AMBER, ON EVERY CONNECTION SURFACE (issue 107, X2; Dave 2026-10-12, "Banner color: AMBER"; Email Build Spec
// 2.8: "Waiting and recoverable failures use amber ... unknown is amber, never green"). A lost mailbox, a stalled sync, a throttle
// and an outage can all be mended, so none of them is drawn in the colour the app keeps for late, destructive and unrecoverable.
// Reading the code for issue 107 (2026-10-13) found the banner amber and the Email tab's warning mark beside it RED, two colours for
// one problem; Today's notice and the status sheet's Sign-In row disagreed with the Email tab in the same way.
//
// What this holds, with no screen where a screen is not needed:
//   - the tab mark is the key's amber token, in both themes, and no rule for a connection warning reaches for a red;
//   - the banner is one amber class for every kind of incident (auth, degraded) and for its strip, with no inline colour;
//   - every state a mailbox can be in, run through the REAL functions (deriveStatus, viewOf, signInFacts, syncFacts, sendFacts,
//     statusHeadline), draws amber or green, never red, and is green only where something is proven working;
//   - the status sheet's Sign-In row does not say Signed In in green beside a headline that says Can't Read Mail.
// Today's own notice is held in src/today/TodayFlow.connection.test.tsx.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import ConnectionBanner from "./ConnectionBanner";
import { signInFacts, sendFacts, syncFacts } from "./AccountStatusSheet";
import { statusHeadline } from "./statusHeadline";
import type { EmailAccount } from "./emailClient";
import type { EmailFact } from "./format";
import { deriveStatus, viewOf, type AccountStatus, type ClientView } from "../connections/connectionStatus";
import type { BannerModel } from "../connections/incidentView";

const { join } = posix;
const SRC = join(process.cwd().replace(/\\/g, "/"), "src");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const SHEETS = readdirSync(join(SRC, "styles")).filter((f) => f.endsWith(".css")).map((f) => strip(readFileSync(join(SRC, "styles", f), "utf8"))).join("\n");
const rules = (css: string): { sel: string; body: string }[] =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: (m[1] ?? "").trim().replace(/\s+/g, " "), body: m[2] ?? "" })).filter((r) => r.sel && !r.sel.startsWith("@"));
const RULES = rules(SHEETS);
const bodyOf = (sel: string): string => RULES.filter((r) => r.sel === sel).map((r) => r.body).join(";");

/** The hex a custom property resolves to in one theme: its last declaration in a block scoped to that theme, else on :root. */
function tokenFor(theme: "dark" | "light", name: string): string | null {
  const scoped = RULES.filter((r) => new RegExp(`^(html|:root)?\\[data-theme="${theme}"\\]$`).test(r.sel));
  const roots = RULES.filter((r) => r.sel === ":root");
  for (const group of [scoped, roots]) {
    for (const r of [...group].reverse()) {
      const hits = [...r.body.matchAll(new RegExp(`(?:^|[;\\s])${name}:\\s*(#[0-9a-fA-F]{6})\\b`, "g"))];
      if (hits.length) return hits[hits.length - 1]![1]!;
    }
  }
  return null;
}
/** The custom property a rule paints its text or glyph with, when it is a plain var(). */
const colourToken = (r: { body: string }): string | null => /(?:^|[;\s])color:\s*var\((--[a-z0-9-]+)\)/.exec(r.body)?.[1] ?? null;
/** Hue in degrees, 0 to 360, of a #RRGGBB colour. Reds sit near 0, ambers between orange and yellow. */
function hue(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe("the Email tab's warning mark is the key's amber, not a red", () => {
  // The amber family of the key: the system amber (text and fill), and the category orange with its glyph and ink twins.
  const AMBER = /^--(warn|warn-fill|cat-orange|cat-ic-orange|cat-tx-orange)$/;
  const RED = /var\(--(red|sys-red|accent|tint|on-light-red|cat-red)\b|#[0-9a-fA-F]{3,8}\b|\brgba?\(/;
  const mark = RULES.filter((r) => /tab-warn/.test(r.sel));

  it("is drawn by a rule of its own (the check is not looking at nothing)", () => {
    expect(mark.map((r) => r.sel)).toContain(".tab .tab-warn");
  });

  it("every rule that mentions it paints with an amber token and names no red, so no theme override can paint it red later", () => {
    for (const r of mark) {
      expect(colourToken(r), `${r.sel} { ${r.body.trim()} }`).toMatch(AMBER);
      expect(r.body, r.sel).not.toMatch(RED);
    }
  });

  it("resolves to an amber in light and in dark, and the reds are not amber", () => {
    for (const theme of ["dark", "light"] as const) {
      const themed = mark.filter((r) => r.sel.includes(`[data-theme="${theme}"]`));
      const winner = themed[themed.length - 1] ?? mark.find((r) => r.sel === ".tab .tab-warn")!;
      const name = colourToken(winner)!;
      const hex = tokenFor(theme, name);
      expect(hex, `${name} is defined in the ${theme} theme`).not.toBeNull();
      expect(hue(hex!), `${theme}: ${name} ${hex} is amber`).toBeGreaterThanOrEqual(25);
      expect(hue(hex!), `${theme}: ${name} ${hex} is amber`).toBeLessThanOrEqual(50);
      for (const red of ["--red", "--sys-red"]) {
        const v = tokenFor(theme, red);
        expect(v, `${red} in ${theme}`).not.toBeNull();
        expect(hue(v!), `${theme}: ${red} ${v} is red`).toBeLessThan(15);
      }
    }
  });

  it("the banner, its strip and their buttons are drawn in the amber fill and the dark ink, never a red", () => {
    for (const sel of [".conn-banner", ".conn-strip", ".conn-banner-act", ".conn-banner-act.primary", ".conn-strip-act"]) expect(bodyOf(sel), sel).not.toMatch(RED);
  });
});

describe("the banner is one amber class for every kind of incident", () => {
  const model = (o: Partial<BannerModel> = {}): BannerModel => ({
    incidentId: "JC-0A1B2C3D", email: "dave@example.test", kind: "auth", title: "Gmail Needs Reconnecting", address: "dave@example.test",
    lines: ["Mail last updated Oct 6 at 8:12 PM.", "New mail may be missing."], paused: null, pausedCount: 0, reconnect: true, strip: false, ...o,
  });
  const draw = (m: BannerModel) => render(<ConnectionBanner models={[m]} notes={[]} onReconnect={() => {}} onAcknowledge={() => {}} onSeen={() => {}} />);

  it.each([
    ["a lost grant (auth)", model(), "conn-banner"],
    ["an outage that has lasted (degraded)", model({ kind: "degraded", reconnect: false, title: "Gmail Isn't Updating" }), "conn-banner"],
    ["an acknowledged one (the strip)", model({ strip: true }), "conn-strip"],
    ["an acknowledged degraded one", model({ kind: "degraded", reconnect: false, strip: true, title: "Gmail Isn't Updating" }), "conn-strip"],
  ])("%s draws exactly %s, with no class or inline style of its own colour", (_name, m, cls) => {
    const { unmount } = draw(m);
    const alert = screen.getByRole("alert");
    expect(alert.className).toBe(cls);
    expect(alert.querySelectorAll("[style]").length + (alert.getAttribute("style") ? 1 : 0)).toBe(0);
    for (const el of [alert, ...alert.querySelectorAll("*")]) expect(el.className.toString(), "a colour class on the banner").not.toMatch(/\b(red|cat-(fg|bg|bd)-|fact)\b/);
    unmount();
  });
});

describe("every state a mailbox can be in is amber or green, never red", () => {
  const NOW = new Date("2026-10-13T15:00:00Z");
  const ME = "dave@example.test";
  const SCOPE = "https://www.googleapis.com/auth/gmail.modify";
  const proof = (refresh: Parameters<typeof deriveStatus>[0]["refresh"], read: Parameters<typeof deriveStatus>[0]["read"] = null, lastSyncAt: string | null = NOW.toISOString()): AccountStatus =>
    deriveStatus({ email: ME, refresh, read, lastSyncAt, now: NOW });
  const READ_OK = { ok: true, status: 200, emailAddress: ME };
  const account = (o: Partial<EmailAccount> = {}): EmailAccount => ({
    id: "a-1", address: ME, state: "connected", last_sync_at: NOW.toISOString(), sync_error: null, capabilities: { archive: true, trash: true, read: true },
    connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 0, signature_text: "", signature_revision: 1, ...o,
  });

  interface Case { name: string; status: AccountStatus; online?: boolean; at?: Date; view: ClientView["state"]; headline: string; signIn: "warn" | "good"; tier: string }
  const CASES: Case[] = [
    { name: "a revoked grant (invalid_grant)", status: proof({ ok: false, error: "invalid_grant" }), view: "pending_auth", headline: "Needs Reconnecting", signIn: "warn", tier: "auth" },
    { name: "no stored sign-in at all", status: proof(null), view: "pending_auth", headline: "Needs Reconnecting", signIn: "warn", tier: "auth" },
    { name: "a 401 on the read", status: proof({ ok: true, scope: SCOPE }, { ok: false, status: 401 }), view: "pending_auth", headline: "Needs Reconnecting", signIn: "warn", tier: "auth" },
    { name: "Gmail rate limiting (429)", status: proof({ ok: true, scope: SCOPE }, { ok: false, status: 429 }), view: "warning", headline: "Temporarily Limited", signIn: "good", tier: "sync" },
    { name: "an outage (503)", status: proof({ ok: true, scope: SCOPE }, { ok: false, status: 503 }), view: "warning", headline: "Service Unavailable", signIn: "good", tier: "sync" },
    { name: "the network failing before Google answered", status: proof({ thrown: true }), view: "warning", headline: "Service Unavailable", signIn: "warn", tier: "sync" },
    { name: "Gmail refusing the check (403)", status: proof({ ok: true, scope: SCOPE }, { ok: false, status: 403 }), view: "error", headline: "Can't Read Mail", signIn: "warn", tier: "auth" },
    { name: "Gmail answering as a different account", status: proof({ ok: true, scope: SCOPE }, { ok: true, status: 200, emailAddress: "other@example.test" }), view: "error", headline: "Can't Read Mail", signIn: "warn", tier: "auth" },
    { name: "a day without a sync", status: proof({ ok: true, scope: SCOPE }, READ_OK, "2026-10-01T00:00:00Z"), view: "warning", headline: "Mail Not Updating", signIn: "good", tier: "sync" },
    { name: "an answer too old to trust", status: proof({ ok: true, scope: SCOPE }, READ_OK), at: new Date("2026-10-13T16:00:00Z"), view: "stale", headline: "Status Unconfirmed", signIn: "warn", tier: "sync" },
    { name: "the phone offline", status: proof({ ok: true, scope: SCOPE }, READ_OK), online: false, view: "offline", headline: "Offline", signIn: "warn", tier: "healthy" },
    { name: "plainly connected", status: proof({ ok: true, scope: SCOPE }, READ_OK), view: "connected", headline: "Connected", signIn: "good", tier: "healthy" },
  ];

  const tonesOf = (facts: readonly EmailFact[]): string[] => facts.map((f) => f.tone ?? "grey");

  it.each(CASES)("$name: $view, amber where something is wrong, never red", (c) => {
    const view = viewOf(c.status, c.at ?? NOW, c.online ?? true);
    expect(view.state).toBe(c.view);
    expect(view.headline).toBe(c.headline);
    const acct = account({ state: view.offerReconnect ? "reauth" : "connected" });
    const sign = signInFacts(acct, view, c.status);
    const head = statusHeadline({ accounts: [acct], views: new Map([[ME, view]]), sent: [], scope: null });
    expect(head.tier).toBe(c.tier);
    // The Sign-In row's state word: amber where the sign-in is not proven working, green only where the credential refreshed.
    expect(sign.facts[0]!.tone, `${c.name}: the Sign-In row`).toBe(c.signIn);
    // The headline the mail home draws: amber for every problem, nothing at all when healthy (or when the phone is simply offline).
    if (c.view !== "connected" && c.view !== "offline") expect(head.facts[0]!.tone, `${c.name}: the headline`).toBe("warn");
    else expect(head.facts).toEqual([]);
    // Nowhere on the mailbox's three rows or its headline is a red.
    const all = [...tonesOf(sign.facts), ...tonesOf(head.facts), ...tonesOf(sendFacts(c.status)), ...tonesOf(syncFacts(account(), c.status, NOW).facts)];
    expect(all, c.name).not.toContain("red");
    // Green belongs to something proven: a connected mailbox, or (on the Sign-In row only) a credential that refreshed.
    if (c.view !== "connected") expect(tonesOf(head.facts), `${c.name}: the headline is never green`).not.toContain("good");
  });

  it("every sync state is amber except Up to Date, and none is red", () => {
    const states = ["current", "catching_up", "syncing", "stale", "failed", "paused", "not_started"] as const;
    for (const s of states) {
      const tones = tonesOf(syncFacts(account({ sync_state: s }), undefined, NOW).facts);
      expect(tones, s).not.toContain("red");
      expect(tones[0], s).toBe(s === "current" ? "good" : "warn");
    }
  });

  it("a removed mailbox and a paused one are amber too", () => {
    const removed = statusHeadline({ accounts: [account({ state: "disconnected" })], views: new Map(), sent: [], scope: ME });
    const paused = statusHeadline({ accounts: [account({ sync_state: "paused" })], views: new Map(), sent: [], scope: null });
    expect(removed.facts[0]!.tone).toBe("warn");
    expect(paused.facts[0]!.tone).toBe("warn");
  });
});

describe("the status sheet's Sign-In row agrees with the headline (issue 107, X2 part B3)", () => {
  const NOW = new Date("2026-10-13T15:00:00Z");
  const ME = "dave@example.test";
  const SCOPE = "https://www.googleapis.com/auth/gmail.modify";
  const acct: EmailAccount = {
    id: "a-1", address: ME, state: "connected", last_sync_at: NOW.toISOString(), sync_error: null, capabilities: { archive: true, trash: true, read: true },
    connected_at: "2026-09-01T00:00:00Z", scopes: [], cached: 0, signature_text: "", signature_revision: 1,
  };
  const row = (read: Parameters<typeof deriveStatus>[0]["read"]) => {
    const status = deriveStatus({ email: ME, refresh: { ok: true, scope: SCOPE }, read, lastSyncAt: NOW.toISOString(), now: NOW });
    return { status, view: viewOf(status, NOW, true), facts: signInFacts(acct, viewOf(status, NOW, true), status) };
  };

  it("Gmail refusing the check reads Can't Read Mail in amber on the Sign-In row, with its one grey, never Signed In in green", () => {
    const r = row({ ok: false, status: 403 });
    expect(r.status.auth_state, "the credential itself refreshed").toBe("valid");
    expect(r.facts.facts).toEqual([{ text: "Can't Read Mail", tone: "warn" }, { text: "Gmail Refused the Last Check" }]);
    expect(r.facts.reconnect).toBe(false);
  });

  it("an answer from a different account reads the same on the Sign-In row", () => {
    const r = row({ ok: true, status: 200, emailAddress: "other@example.test" });
    expect(r.facts.facts).toEqual([{ text: "Can't Read Mail", tone: "warn" }, { text: "Signed In as a Different Account" }]);
  });

  it("a throttle or an outage leaves the sign-in itself working, and still says so", () => {
    for (const status of [429, 503]) expect(row({ ok: false, status }).facts.facts).toEqual([{ text: "Signed In", tone: "good" }]);
  });

  it("a healthy mailbox is Signed In in green", () => {
    expect(row({ ok: true, status: 200, emailAddress: ME }).facts.facts).toEqual([{ text: "Signed In", tone: "good" }]);
  });
});
