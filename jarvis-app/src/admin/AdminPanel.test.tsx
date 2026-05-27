// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import AdminPanel from "./AdminPanel";
import { makeSampleAdminSource, type AdminService } from "./AdminService";

describe("AdminPanel", () => {
  it("blocks non-admins", () => {
    render(<AdminPanel isAdmin={false} source={makeSampleAdminSource()} />);
    expect(screen.getByText("Not authorized")).toBeInTheDocument();
  });

  it("renders usage, billing and users for an admin", async () => {
    render(<AdminPanel isAdmin source={makeSampleAdminSource()} />);
    expect(await screen.findByText("$36")).toBeInTheDocument();
    expect(screen.getByText("you@yourdomain.com")).toBeInTheDocument();
    expect(screen.getByText(/Sample data/)).toBeInTheDocument();
  });

  it("disables a user through the source", async () => {
    let called: [string, string] | null = null;
    const src: AdminService = {
      available: true,
      async listUsers() { return [{ id: "u1", email: "a@b.com", createdAt: "2026-01-01", plan: "Pro", status: "active", role: "user" }]; },
      async setUserStatus(id, st) { called = [id, st]; },
      async usage() { return { totalUsers: 1, activeUsers: 1, signups7d: 0, aiCalls30d: 0 }; },
      async billing() { return { mrr: 0, activeSubs: 0, trialing: 0, currency: "USD" }; },
    };
    render(<AdminPanel isAdmin source={src} />);
    fireEvent.click(await screen.findByText("Disable"));
    await waitFor(() => expect(called).toEqual(["u1", "disabled"]));
    expect(screen.getByText("Enable")).toBeInTheDocument();
  });

  it("is honest when there is no admin server", () => {
    const src: AdminService = {
      available: false,
      async listUsers() { return []; }, async setUserStatus() {},
      async usage() { return { totalUsers: 0, activeUsers: 0, signups7d: 0, aiCalls30d: 0 }; },
      async billing() { return { mrr: 0, activeSubs: 0, trialing: 0, currency: "USD" }; },
    };
    render(<AdminPanel isAdmin source={src} />);
    expect(screen.getAllByText("Live data needs the admin server").length).toBeGreaterThan(0);
  });
});
