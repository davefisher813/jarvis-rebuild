// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import AdminPanel from "./AdminPanel";
import { capsulesInCards } from "../laws/catalogCheck";
import { createAdminApi, makeSampleAdminSource, type AdminService } from "./AdminService";

describe("AdminPanel", () => {
  it("blocks non-admins", () => {
    render(<AdminPanel isAdmin={false} source={makeSampleAdminSource()} />);
    expect(screen.getByText("Not Authorized")).toBeInTheDocument();
  });

  // Slice 09 QA (2026-10-04): the door opens for everyone now, so "still
  // asking" and "could not ask" must not read as a verdict.
  it("while the server is still being asked, shows a load, not Not Authorized", () => {
    render(<AdminPanel isAdmin={false} probe="checking" source={makeSampleAdminSource()} />);
    expect(screen.queryByText("Not Authorized")).not.toBeInTheDocument();
    expect(document.querySelector(".skel-row")).not.toBeNull();
  });

  it("when the server could not be asked, offers Try Again instead of a dead end", () => {
    const onRecheck = vi.fn();
    render(<AdminPanel isAdmin={false} probe="error" onRecheck={onRecheck} source={makeSampleAdminSource()} />);
    expect(screen.queryByText("Not Authorized")).not.toBeInTheDocument();
    expect(screen.getByText("Couldn't Check Access")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Try Again"));
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it("a real no from the server still says Not Authorized", () => {
    render(<AdminPanel isAdmin={false} probe="no" source={makeSampleAdminSource()} />);
    expect(screen.getByText("Not Authorized")).toBeInTheDocument();
  });

  it("renders usage, billing and users for an admin", async () => {
    render(<AdminPanel isAdmin source={makeSampleAdminSource()} />);
    expect(await screen.findByText("$36")).toBeInTheDocument();
    expect(screen.getByText("you@yourdomain.com")).toBeInTheDocument();
    expect(screen.getByText(/Sample Data/)).toBeInTheDocument();
  });

  // UP-LAUNCH-16 (2026-09-05): the Feedback section, and the honest empty
  // states behind it. A deploy without the endpoint says so rather than
  // showing an empty list, which would read as "nobody has written".
  it("shows what testers sent, and says so when the endpoint is not there", async () => {
    render(<AdminPanel isAdmin source={makeSampleAdminSource()} />);
    expect(await screen.findByText(/gym timer keeps running/)).toBeInTheDocument();
    const noEndpoint: AdminService = {
      available: true,
      async listUsers() { return []; }, async setUserStatus() {}, async setUserAiAllowed() {},
      async usage() { return { totalUsers: 0, activeUsers: 0, signups7d: 0, aiCalls30d: 0 }; },
      async billing() { return { mrr: 0, activeSubs: 0, trialing: 0, currency: "USD" }; },
      async feedback() { throw new Error("admin 404"); },
      async metrics() { throw new Error("admin 404"); },
    };
    render(<AdminPanel isAdmin source={noEndpoint} />);
    expect(await screen.findByText("Feedback Is Not Loaded")).toBeInTheDocument();
  });

  it("disables a user through the source", async () => {
    let called: [string, string] | null = null;
    const src: AdminService = {
      available: true,
      async listUsers() { return [{ id: "u1", email: "a@b.com", createdAt: "2026-01-01", plan: "Pro", status: "active", role: "user", aiAllowed: true }]; },
      async setUserStatus(id, st) { called = [id, st]; }, async setUserAiAllowed() {},
      async usage() { return { totalUsers: 1, activeUsers: 1, signups7d: 0, aiCalls30d: 0 }; },
      async billing() { return { mrr: 0, activeSubs: 0, trialing: 0, currency: "USD" }; },
      async feedback() { return []; },
      async metrics() { throw new Error("no metrics endpoint"); },
    };
    render(<AdminPanel isAdmin source={src} />);
    // THE ROW HAS NO PILL (Dave 2026-10-05, locked): a tap opens its sheet and the sheet holds Disable. It is not a swipe,
    // because it locks someone out.
    fireEvent.click(await screen.findByText("a@b.com"));
    fireEvent.click(await screen.findByText("Disable Account"));
    await waitFor(() => expect(called).toEqual(["u1", "disabled"]));
    fireEvent.click(await screen.findByText("a@b.com"));
    expect(await screen.findByText("Enable Account")).toBeInTheDocument();
  });

  // PLUMB-F-21 (2026-09-05): the row was optimistic with no rollback, so a
  // failed disable left an account reading "disabled" that was not.
  it("puts the row back when the server refuses the change", async () => {
    const src: AdminService = {
      available: true,
      async listUsers() { return [{ id: "u1", email: "a@b.com", createdAt: "2026-01-01", plan: "Pro", status: "active", role: "user", aiAllowed: true }]; },
      async setUserStatus() { throw new Error("admin 502"); }, async setUserAiAllowed() {},
      async usage() { return { totalUsers: 1, activeUsers: 1, signups7d: 0, aiCalls30d: 0 }; },
      async billing() { return { mrr: 0, activeSubs: 0, trialing: 0, currency: "USD" }; },
      async feedback() { return []; },
      async metrics() { throw new Error("no metrics endpoint"); },
    };
    render(<AdminPanel isAdmin source={src} />);
    fireEvent.click(await screen.findByText("a@b.com"));
    fireEvent.click(await screen.findByText("Disable Account"));
    await waitFor(() => expect(screen.getByText("admin 502")).toBeInTheDocument());
    // The account is active, because nothing changed it: its sheet still offers Disable.
    fireEvent.click(screen.getByText("a@b.com"));
    expect(await screen.findByText("Disable Account")).toBeInTheDocument();
    expect(screen.queryByText("Enable Account")).toBeNull();
  });

  // §AM (2026-09-22): a cost with no state is white, and an account whose
  // model has no price says so in amber on its facts line, not as a second
  // grey in the value slot.
  it("draws a spend row's cost white and an unpriced one amber", async () => {
    const src: AdminService = {
      available: true,
      async listUsers() { return []; }, async setUserStatus() {}, async setUserAiAllowed() {},
      async usage() {
        return { totalUsers: 2, activeUsers: 2, signups7d: 0, aiCalls30d: 13, spend: [
          { id: "u1", email: "a@b.com", calls: 12, usd: 4.2 },
          { id: "u2", email: "c@d.com", calls: 1, usd: null },
        ] };
      },
      async billing() { return { mrr: 0, activeSubs: 0, trialing: 0, currency: "USD" }; },
      async feedback() { return []; },
      async metrics() { throw new Error("no metrics endpoint"); },
    };
    render(<AdminPanel isAdmin source={src} />);
    expect(await screen.findByText("$4.20")).toHaveClass("money-amt");
    expect(screen.getByText("Not Priced")).toHaveClass("fact", "warn");
    expect(screen.getByText("12 Calls")).toHaveClass("fact");
  });

  // §AK/§AM F3 (2026-09-26): the feedback row's second line was one string
  // of four greys with the middots baked in. Each part is its own fact now:
  // the build white, an attached crash red, who sent it from where the one
  // grey, and the separators are the stylesheet's. The parts arrive NAMED:
  // read by position, a report with no build drew its template as the build.
  it("draws a feedback row's parts as separate facts with no baked separator", async () => {
    const src: AdminService = {
      available: true,
      async listUsers() { return []; }, async setUserStatus() {}, async setUserAiAllowed() {},
      async usage() { return { totalUsers: 0, activeUsers: 0, signups7d: 0, aiCalls30d: 0 }; },
      async billing() { return { mrr: 0, activeSubs: 0, trialing: 0, currency: "USD" }; },
      async feedback() {
        return [
          { id: "f1", text: "It froze.", meta: { build: "abc1234", from: ["student", "iPhone"] }, at: "2026-09-05T10:00:00.000Z", lastError: "TypeError: x" },
          { id: "f2", text: "Nothing else.", meta: { from: [] }, at: "2026-09-05T10:00:00.000Z", lastError: null },
          { id: "f3", text: "No build on this one.", meta: { from: ["parent", "iPad"] }, at: "2026-09-05T10:00:00.000Z", lastError: null },
        ];
      },
      async metrics() { throw new Error("no metrics endpoint"); },
    };
    render(<AdminPanel isAdmin source={src} />);
    const row = (await screen.findByText("It froze.")).closest(".row") as HTMLElement;
    const facts = row.querySelector(".facts") as HTMLElement;
    expect(facts.textContent).not.toMatch(/·/);
    expect(screen.getByText("abc1234").tagName).toBe("B");
    expect(screen.getByText("Last Error")).toHaveClass("fact", "red");
    expect(screen.getByText("Student on iPhone")).toHaveClass("fact");
    // A row with nothing to say shows no line at all.
    const bare = screen.getByText("Nothing else.").closest(".row") as HTMLElement;
    expect(bare.querySelector(".facts")).toBeNull();
    // No build: the template stays in who-sent-it-from-where, and nothing
    // on the line is drawn as the white build number.
    const noBuild = screen.getByText("No build on this one.").closest(".row") as HTMLElement;
    expect(noBuild.querySelector(".facts b")).toBeNull();
    expect(screen.getByText("Parent on iPad")).toHaveClass("fact");
  });

  // 2026-09-26: the panel keeps the account id, the one place it shows what an admin looks a user up by. 2026-10-05: the row
  // says only its plan, and the id and the join date are in the row's sheet with its one verb.
  it("shows the account id and the join date in the user's sheet, and the row itself says only its plan", async () => {
    const src: AdminService = {
      available: true,
      async listUsers() { return [{ id: "u1", email: "a@b.com", createdAt: "2026-01-01", plan: "Pro", status: "active", role: "user", aiAllowed: true }]; },
      async setUserStatus() {}, async setUserAiAllowed() {},
      async usage() { return { totalUsers: 1, activeUsers: 1, signups7d: 0, aiCalls30d: 0 }; },
      async billing() { return { mrr: 0, activeSubs: 0, trialing: 0, currency: "USD" }; },
      async feedback() { return []; },
      async metrics() { throw new Error("no metrics endpoint"); },
    };
    const { container } = render(<AdminPanel isAdmin source={src} />);
    const row = (await screen.findByText("a@b.com")).closest(".row") as HTMLElement;
    expect([...row.querySelectorAll(".fact")].map((f) => f.textContent)).toEqual(["Pro"]);
    expect(row.querySelector(".pill-act, .row-act, .btn-sm, .quiet-action")).toBeNull();
    expect(screen.queryByText("u1")).toBeNull();
    fireEvent.click(row);
    expect(await screen.findByText("Account Id")).toBeInTheDocument();
    expect(screen.getByText("u1")).toBeInTheDocument();
    expect(screen.getByText("2026-01-01")).toBeInTheDocument();
    expect(capsulesInCards(container)).toEqual([]);
  });

  it("is honest when there is no admin server", () => {
    const src: AdminService = {
      available: false,
      async listUsers() { return []; }, async setUserStatus() {}, async setUserAiAllowed() {},
      async usage() { return { totalUsers: 0, activeUsers: 0, signups7d: 0, aiCalls30d: 0 }; },
      async billing() { return { mrr: 0, activeSubs: 0, trialing: 0, currency: "USD" }; },
      async feedback() { return []; },
      async metrics() { throw new Error("no metrics endpoint"); },
    };
    render(<AdminPanel isAdmin source={src} />);
    expect(screen.getAllByText("Live Data Needs the Admin Server").length).toBeGreaterThan(0);
  });
});

// PLUMB-F-21 (2026-09-05): availability used to be the VITE_ADMIN_API build
// flag and nothing else, and that flag was never set on the deployed build,
// so a real admin was told the server was "Wired at launch" while
// api/admin/{users,usage,billing} were live and answering.
describe("createAdminApi availability", () => {
  it("follows what the caller already proved, not only the build flag", () => {
    expect(createAdminApi("tok", true).available).toBe(true);
    expect(createAdminApi("tok", false).available).toBe(false);
  });
});

// THE ADMIN SWITCH FOR AI (Dave 2026-09-30): one toggle per account, one tap.
describe("AdminPanel: AI Allowed per account", () => {
  const mk = (over: Partial<AdminService> = {}): AdminService => ({
    available: true,
    async listUsers() {
      return [
        { id: "u1", email: "on@b.com", createdAt: "2026-01-01", plan: "Pro", status: "active", role: "user", aiAllowed: true },
        { id: "u2", email: "off@b.com", createdAt: "2026-01-01", plan: "Pro", status: "active", role: "user", aiAllowed: false },
      ];
    },
    async setUserStatus() {}, async setUserAiAllowed() {},
    async usage() { return { totalUsers: 2, activeUsers: 1, signups7d: 0, aiCalls30d: 0 }; },
    async billing() { return { mrr: 0, activeSubs: 0, trialing: 0, currency: "USD" }; },
    async feedback() { return []; },
    async metrics() { throw new Error("no metrics endpoint"); },
    ...over,
  });

  it("shows each account's state and flips it both ways through the source", async () => {
    const calls: [string, boolean][] = [];
    render(<AdminPanel isAdmin source={mk({ async setUserAiAllowed(id, a) { calls.push([id, a]); } })} />);
    const on = await screen.findByRole("switch", { name: "AI allowed for on@b.com" });
    const off = screen.getByRole("switch", { name: "AI allowed for off@b.com" });
    expect(on.getAttribute("aria-checked")).toBe("true");
    expect(off.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(on);
    await waitFor(() => expect(calls).toEqual([["u1", false]]));
    expect(screen.getByRole("switch", { name: "AI allowed for on@b.com" }).getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("switch", { name: "AI allowed for off@b.com" }));
    await waitFor(() => expect(calls).toEqual([["u1", false], ["u2", true]]));
    expect(screen.getByRole("switch", { name: "AI allowed for off@b.com" }).getAttribute("aria-checked")).toBe("true");
  });

  it("puts the switch back when the server refuses, and does not touch the account status", async () => {
    let status = 0;
    render(<AdminPanel isAdmin source={mk({ async setUserAiAllowed() { throw new Error("admin 502"); }, async setUserStatus() { status += 1; } })} />);
    fireEvent.click(await screen.findByRole("switch", { name: "AI allowed for on@b.com" }));
    expect(await screen.findByText(/admin 502/)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "AI allowed for on@b.com" }).getAttribute("aria-checked")).toBe("true");
    expect(status).toBe(0);
  });
});
