// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { lineCase } from "../shared/casing";
import AdminPanel from "./AdminPanel";
import type { AdminService, AdminUser } from "./AdminService";
import type { AdminMetrics } from "./adminMetrics";

// THE VISUAL CATALOG, HELD ON THE ADMIN PANEL (Dave 2026-10-05, "I am sick
// of this"). The panel is rendered whole, through its real component and the
// kit it shares with Settings, and read from the DOM.
//
// What it pins, each of which was drift before today:
//   - a section head is the one .sh2 head (§AM F7), not a second .grp eyebrow;
//   - no typed middle dot inside a meta line or a fact (§AM F3), which the AI
//     Allowed row had ("On · a@b.com");
//   - a row with nothing to say shows no line (the switch's own state is not
//     repeated under it, and the account's email is not said a second time);
//   - one grey per line, and every tile label, count and grey line Title Case.

const MIDDOT = "·";
const norm = (e: Element) => (e.textContent ?? "").replace(/\s+/g, " ").trim();
const TONES = ["warn", "red", "good", "est", "date", "st", "cat"];

const USERS: AdminUser[] = [
  { id: "u1", email: "boss@x.com", createdAt: "2026-01-01T00:00:00Z", plan: "personal", status: "active", role: "admin", aiAllowed: true },
  { id: "u2", email: "kid@x.com", createdAt: "2026-02-02T00:00:00Z", plan: "student", status: "disabled", role: "user", aiAllowed: false },
];
const METRICS: AdminMetrics = {
  signups7d: 3, signups30d: 9, weeklyActive: 5, onboardingRate: 0.5,
  funnel: { started: 4, finished: 2, skipped: 1 }, d1: 0.4, d7: 0.2, d1Basis: 5, d7Basis: 4, aiCallsPerActive: 2, truncated: true,
} as AdminMetrics;

const source = (over: Partial<AdminService> = {}): AdminService => ({
  available: true,
  async listUsers() { return USERS; },
  async setUserStatus() {}, async setUserAiAllowed() {},
  async usage() {
    return { totalUsers: 2, activeUsers: 1, signups7d: 1, aiCalls30d: 13, aiCost30d: 4.2, spend: [
      { id: "u1", email: "boss@x.com", calls: 12, usd: 4.2 },
      { id: "u2", email: "kid@x.com", calls: 1, usd: null },
    ] };
  },
  async billing() { return { mrr: 36, activeSubs: 3, trialing: 1, currency: "USD" }; },
  async feedback() {
    return [
      { id: "f1", text: "It froze", meta: { build: "abc1234", from: ["student", "iPhone"] }, at: "2026-09-05T10:00:00Z", lastError: "TypeError: x" },
      { id: "f2", text: "Nothing else", meta: { from: [] }, at: "2026-09-05T10:00:00Z", lastError: null },
    ];
  },
  async metrics() { return METRICS; },
  async errors() { return []; },
  ...over,
});

async function mount(over: Partial<AdminService> = {}) {
  const view = render(<AdminPanel isAdmin source={source(over)} />);
  // Feedback, then metrics, load after the first answers: wait for the last.
  await screen.findByText("Finished Onboarding");
  return view;
}

describe("AdminPanel follows the catalog", () => {
  it("every section head is the one .sh2 head with its count, and there is no second head style", async () => {
    const { container } = await mount();
    const heads = [...container.querySelectorAll(".sh2")].map((h) => norm(h.querySelector(".t")!));
    expect(heads).toEqual(["Usage", "AI Spend 30d", "Billing", "Metrics", "Feedback", "Errors", "Users"]);
    expect(norm(container.querySelector(".sh2 .n")!)).toBe("2");
    expect(container.querySelector(".grp, .eyebrow")).toBeNull();
    for (const h of container.querySelectorAll(".sh2")) expect(h).toHaveClass("sh2-quiet");
  });

  it("the AI Allowed row says nothing under its switch, and carries no typed dot or second copy of the email", async () => {
    const { container } = await mount();
    const rows = [...container.querySelectorAll(".row")].filter((r) => norm(r.querySelector(".conn-name") ?? r) === "AI Allowed");
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.querySelector(".conn-meta"), "the switch beside it already says on or off").toBeNull();
      expect(r.textContent).not.toContain(MIDDOT);
    }
    // A screen reader still hears which account the switch is for.
    expect(screen.getByRole("switch", { name: "AI allowed for kid@x.com" })).toHaveAttribute("aria-checked", "false");
  });

  it("no meta line, fact or facts line carries a typed dot, and no line has two greys", async () => {
    const { container } = await mount();
    fireEvent.click(screen.getAllByText("boss@x.com", { selector: ".conn-name" })[0]!.closest(".row")!);
    for (const el of container.querySelectorAll(".conn-meta, .fact, .facts")) expect(norm(el), el.className).not.toContain(MIDDOT);
    for (const line of container.querySelectorAll(".facts")) {
      expect(norm(line), "an empty facts line is a placeholder").not.toBe("");
      const grey = [...line.querySelectorAll(":scope > .fact")].filter((f) => !TONES.some((t) => f.classList.contains(t)) && !f.querySelector(":scope > b"));
      expect(grey.length, norm(line)).toBeLessThanOrEqual(1);
    }
  });

  it("every tile label, count, plan and grey line the panel writes is Title Case", async () => {
    const { container } = await mount();
    const bad: string[] = [];
    for (const el of container.querySelectorAll(".adm-label, .fact, .empty-title, .empty-sub, .list-floor, .adm-banner")) {
      const t = norm(el);
      if (/^[\w.+-]+@[\w.-]+$/.test(t) || /^[a-f0-9]{7}$/.test(t)) continue;
      if (lineCase(t) !== t) bad.push(`${el.className}: "${t}" should be "${lineCase(t)}"`);
    }
    expect(bad).toEqual([]);
    expect(screen.getByText("Student on iPhone")).toBeInTheDocument();
    expect(screen.getByText("Personal")).toHaveClass("fact");
    expect(screen.getByText("12 Calls")).toHaveClass("fact");
    expect(screen.getByText("Finished Onboarding")).toBeInTheDocument();
    expect(screen.getByText("History Too Long, Return Numbers Withheld")).toHaveClass("list-floor");
  });

  it("the sample banner and the could-not-load states are Title Case too", async () => {
    const { container } = render(<AdminPanel isAdmin source={source({ sample: true, async metrics() { throw new Error("none"); }, async feedback() { throw new Error("none"); } })} />);
    await screen.findByText("Feedback Is Not Loaded");
    const bad: string[] = [];
    for (const el of container.querySelectorAll(".adm-banner, .empty-title, .empty-sub")) if (lineCase(norm(el)) !== norm(el)) bad.push(norm(el));
    expect(bad).toEqual([]);
    expect(norm(container.querySelector(".adm-banner")!)).toBe("Sample Data, for Layout Preview Only");
    expect(screen.getByText("This Deploy Has No Metrics Endpoint Yet")).toHaveClass("empty-sub");
  });

  it("the not-authorized and could-not-check screens are Title Case", () => {
    const a = render(<AdminPanel isAdmin={false} source={source()} />);
    expect(norm(a.container.querySelector(".empty-sub")!)).toBe("Master Account Only");
    a.unmount();
    const b = render(<AdminPanel isAdmin={false} probe="error" source={source()} />);
    expect(norm(b.container.querySelector(".empty-sub")!)).toBe("The Admin Server Did Not Answer");
  });
});
