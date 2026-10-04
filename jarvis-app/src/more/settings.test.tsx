// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AppearanceProvider } from "../appearance/AppearanceProvider";
import { NotesProvider } from "../data/NotesProvider";
import { AuthProvider } from "../auth/AuthProvider";
import AppearancePage from "../settings/AppearancePage";
import ProfilePage from "../settings/ProfilePage";
import MoreFlow from "./MoreFlow";
import { extrasFor } from "../shell/destinations";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Settings", () => {
  it("Appearance switches the theme", () => {
    render(<AppearanceProvider><AppearancePage onBack={() => {}} /></AppearanceProvider>);
    // the theme is a value that opens the dropdown (the sub-pages onto the rulings, 2026-09-02)
    fireEvent.click(screen.getByLabelText("Theme"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.click(screen.getByLabelText("Theme"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("Profile saves the name", async () => {
    render(<NotesProvider userId="u1"><ProfilePage onBack={() => {}} /></NotesProvider>);
    fireEvent.change(screen.getByPlaceholderText("Your Name"), { target: { value: "Alex" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });

  it("More -> Settings -> Categories and back", async () => {
    render(
      <AppearanceProvider>
        <AuthProvider>
        <NotesProvider userId="u1">
          <MoreFlow extras={extrasFor(["today", "tasks", "schedule", "brain"])} onOpenExtra={() => {}} tabKeys={["today", "tasks", "schedule", "brain"]} onToggleTab={() => {}} />
        </NotesProvider>
        </AuthProvider>
      </AppearanceProvider>,
    );
    // SPEC MOVED (Library chassis 2026-08-18): every page title renders twice
    // (large title + condensed bar title), so queries pick the large one.
    expect(screen.getAllByText("More").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText("Settings")[0]!);
    await waitFor(() => expect(screen.getByText("Areas")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Areas"));
    await waitFor(() => expect(screen.getByText("Add Area")).toBeInTheDocument());
    fireEvent.click(screen.getAllByText("Settings")[0]!);
    await waitFor(() => expect(screen.getByText("Edit Tabs")).toBeInTheDocument());
  });

  // Slice 09 QA (2026-10-04): the door to Admin only existed once the admin
  // probe had said yes, so for everyone it had not answered for, five taps did
  // nothing. The door is always wired now; the Admin screen itself says Not
  // Authorized when the server does.
  it("More -> Settings -> About -> five taps on the build line opens Admin", async () => {
    render(
      <AppearanceProvider>
        <AuthProvider>
        <NotesProvider userId="u1">
          <MoreFlow extras={extrasFor(["today", "tasks", "schedule", "brain"])} onOpenExtra={() => {}} tabKeys={["today", "tasks", "schedule", "brain"]} onToggleTab={() => {}} />
        </NotesProvider>
        </AuthProvider>
      </AppearanceProvider>,
    );
    fireEvent.click(screen.getAllByText("Settings")[0]!);
    await waitFor(() => expect(screen.getByText("About")).toBeInTheDocument());
    fireEvent.click(screen.getByText("About"));
    const line = await screen.findByRole("button", { name: /^Build / });
    for (let i = 0; i < 5; i++) fireEvent.click(line);
    // The panel is lazy; the title is what both of its branches render.
    await waitFor(() => expect(screen.getByText("Admin")).toBeInTheDocument());
  });

  it("More lists an unpicked page and can open it", () => {
    const onOpen = vi.fn();
    render(
      <AppearanceProvider>
        <AuthProvider>
        <NotesProvider userId="u1">
          <MoreFlow extras={extrasFor(["today", "tasks", "schedule", "brain"])} onOpenExtra={onOpen} tabKeys={["today", "tasks", "schedule", "brain"]} onToggleTab={() => {}} />
        </NotesProvider>
        </AuthProvider>
      </AppearanceProvider>,
    );
    fireEvent.click(screen.getByText("Notes"));
    expect(onOpen).toHaveBeenCalledWith("notes");
  });
});

// AUDIT 2026-09-29: the avatar on Today is labelled "Account" and opened the
// More hub. It now opens Settings, Account, through the shell's one-shot
// route (the same door Email's Open Connections uses).
describe("the Account avatar", () => {
  it("MoreFlow opens on Account when the shell hands it that route", async () => {
    const consumed = vi.fn();
    render(
      <AppearanceProvider>
        <AuthProvider>
        <NotesProvider userId="u1">
          <MoreFlow extras={extrasFor(["today", "tasks", "schedule", "brain"])} onOpenExtra={() => {}} tabKeys={["today", "tasks", "schedule", "brain"]} onToggleTab={() => {}} openRoute="account" onRouteConsumed={consumed} />
        </NotesProvider>
        </AuthProvider>
      </AppearanceProvider>,
    );
    expect(await screen.findByText("Edit Profile")).toBeInTheDocument(); // the Account page, not the More hub
    expect(screen.queryByText("Edit Tabs")).toBeNull();
    expect(consumed).toHaveBeenCalled();
  });

  it("Today's avatar is wired to that route, not to the bare More tab", () => {
    const shell = readFileSync(join(__dirname, "../shell/AppShell.tsx"), "utf8");
    expect(shell).toMatch(/onProfile=\{\(\) => \{ setMoreRoute\("account"\); setActive\("more"\); \}\}/);
    const page = readFileSync(join(__dirname, "../today/TodayPage.tsx"), "utf8");
    expect(page).toMatch(/className="today-av" aria-label="Account" onClick=\{onProfile\}/);
  });
});
