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

describe("Settings", () => {
  it("Appearance switches the theme", () => {
    render(<AppearanceProvider><AppearancePage onBack={() => {}} /></AppearanceProvider>);
    fireEvent.click(screen.getByText("Light"));
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.click(screen.getByText("Dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("Profile saves the name", async () => {
    render(<NotesProvider userId="u1"><ProfilePage onBack={() => {}} /></NotesProvider>);
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Alex" } });
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
    expect(screen.getByText("More")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Settings"));
    await waitFor(() => expect(screen.getByText("Categories")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Categories"));
    await waitFor(() => expect(screen.getByText("Add Category")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Settings"));
    await waitFor(() => expect(screen.getByText("Edit Tabs")).toBeInTheDocument());
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
