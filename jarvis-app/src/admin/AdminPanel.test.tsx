// SPEC MOVED (Catalog V3.1, 2026-08-18): Title Case everywhere; copy assertions updated.
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import AdminPanel from "./AdminPanel";
import { createAdminApi, makeSampleAdminSource, type AdminService } from "./AdminService";

describe("AdminPanel", () => {
  it("blocks non-admins", () => {
    render(<AdminPanel isAdmin={false} source={makeSampleAdminSource()} />);
    expect(screen.getByText("Not Authorized")).toBeInTheDocument();
  });

  it("renders usage, billing and users for an admin", async () => {
    render(<AdminPanel isAdmin source={makeSampleAdminSource()} />);
    expect(await screen.findByText("$36")).toBeInTheDocument();
    expect(screen.getByText("you@yourdomain.com")).toBeInTheDocument();
    expect(screen.getByText(/Sample data/)).toBeInTheDocument();
  });

  // UP-LAUNCH-16 (2026-09-05): the Feedback section, and the honest empty
  // states behind it. A deploy without the endpoint says so rather than
  // showing an empty list, which would read as "nobody has written".
  it("shows what testers sent, and says so when the endpoint is not there", async () => {
    render(<AdminPanel isAdmin source={makeSampleAdminSource()} />);
    expect(await screen.findByText(/gym timer keeps running/)).toBeInTheDocument();
    const noEndpoint: AdminService = {
      available: true,
      async listUsers() { return []; }, async setUserStatus() {},
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
      async listUsers() { return [{ id: "u1", email: "a@b.com", createdAt: "2026-01-01", plan: "Pro", status: "active", role: "user" }]; },
      async setUserStatus(id, st) { called = [id, st]; },
      async usage() { return { totalUsers: 1, activeUsers: 1, signups7d: 0, aiCalls30d: 0 }; },
      async billing() { return { mrr: 0, activeSubs: 0, trialing: 0, currency: "USD" }; },
      async feedback() { return []; },
      async metrics() { throw new Error("no metrics endpoint"); },
    };
    render(<AdminPanel isAdmin source={src} />);
    fireEvent.click(await screen.findByText("Disable"));
    await waitFor(() => expect(called).toEqual(["u1", "disabled"]));
    expect(screen.getByText("Enable")).toBeInTheDocument();
  });

  // PLUMB-F-21 (2026-09-05): the row was optimistic with no rollback, so a
  // failed disable left an account reading "disabled" that was not.
  it("puts the row back when the server refuses the change", async () => {
    const src: AdminService = {
      available: true,
      async listUsers() { return [{ id: "u1", email: "a@b.com", createdAt: "2026-01-01", plan: "Pro", status: "active", role: "user" }]; },
      async setUserStatus() { throw new Error("admin 502"); },
      async usage() { return { totalUsers: 1, activeUsers: 1, signups7d: 0, aiCalls30d: 0 }; },
      async billing() { return { mrr: 0, activeSubs: 0, trialing: 0, currency: "USD" }; },
      async feedback() { return []; },
      async metrics() { throw new Error("no metrics endpoint"); },
    };
    render(<AdminPanel isAdmin source={src} />);
    fireEvent.click(await screen.findByText("Disable"));
    await waitFor(() => expect(screen.getByText("admin 502")).toBeInTheDocument());
    // The account is active, because nothing changed it. The row states its
    // status through the capsule's verb alone (§AK: one grey per row).
    expect(screen.getByText("Disable")).toBeInTheDocument();
    expect(screen.queryByText("Enable")).toBeNull();
  });

  // §AM (2026-09-22): a cost with no state is white, and an account whose
  // model has no price says so in amber on its facts line, not as a second
  // grey in the value slot.
  it("draws a spend row's cost white and an unpriced one amber", async () => {
    const src: AdminService = {
      available: true,
      async listUsers() { return []; }, async setUserStatus() {},
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
    expect(screen.getByText("Not priced")).toHaveClass("fact", "warn");
    expect(screen.getByText("12 calls")).toHaveClass("fact");
  });

  // §AK/§AM F3 (2026-09-26): the feedback row's second line was one string
  // of four greys with the middots baked in. Each part is its own fact now:
  // the build white, an attached crash red, who sent it from where the one
  // grey, and the separators are the stylesheet's.
  it("draws a feedback row's parts as separate facts with no baked separator", async () => {
    const src: AdminService = {
      available: true,
      async listUsers() { return []; }, async setUserStatus() {},
      async usage() { return { totalUsers: 0, activeUsers: 0, signups7d: 0, aiCalls30d: 0 }; },
      async billing() { return { mrr: 0, activeSubs: 0, trialing: 0, currency: "USD" }; },
      async feedback() {
        return [
          { id: "f1", text: "It froze.", meta: ["abc1234", "student", "iPhone"], at: "2026-09-05T10:00:00.000Z", lastError: "TypeError: x" },
          { id: "f2", text: "Nothing else.", meta: [], at: "2026-09-05T10:00:00.000Z", lastError: null },
        ];
      },
      async metrics() { throw new Error("no metrics endpoint"); },
    };
    render(<AdminPanel isAdmin source={src} />);
    const row = (await screen.findByText("It froze.")).closest(".row") as HTMLElement;
    const facts = row.querySelector(".facts") as HTMLElement;
    expect(facts.textContent).not.toMatch(/·/);
    expect(screen.getByText("abc1234").tagName).toBe("B");
    expect(screen.getByText("Last error")).toHaveClass("fact", "red");
    expect(screen.getByText("student on iPhone")).toHaveClass("fact");
    // A row with nothing to say shows no line at all.
    const bare = screen.getByText("Nothing else.").closest(".row") as HTMLElement;
    expect(bare.querySelector(".facts")).toBeNull();
  });

  it("is honest when there is no admin server", () => {
    const src: AdminService = {
      available: false,
      async listUsers() { return []; }, async setUserStatus() {},
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
