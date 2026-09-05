// @vitest-environment jsdom
// SHELL-F-04 (2026-09-05): the screen a reset link lands on. Before it, the
// link opened the app, Supabase signed the browser in, and there was nowhere
// to type a new password, so the person who had forgotten theirs was in
// exactly the position they started in.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import SetNewPassword from "./SetNewPassword";

const updatePassword = vi.fn();
const signOut = vi.fn();
vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ updatePassword, signOut }),
}));

beforeEach(() => {
  updatePassword.mockReset().mockResolvedValue(undefined);
  signOut.mockReset().mockResolvedValue(undefined);
});

describe("Set a New Password", () => {
  it("sets the password the person typed", async () => {
    render(<SetNewPassword />);
    fireEvent.change(screen.getByPlaceholderText("At Least 6 Characters"), { target: { value: "hunter2!" } });
    fireEvent.click(screen.getByText("Set Password"));
    await waitFor(() => expect(updatePassword).toHaveBeenCalledWith("hunter2!"));
  });

  it("refuses a password too short to be one, without calling the server", () => {
    render(<SetNewPassword />);
    fireEvent.change(screen.getByPlaceholderText("At Least 6 Characters"), { target: { value: "abc" } });
    fireEvent.click(screen.getByText("Set Password"));
    expect(screen.getByText("Use at least 6 characters")).toBeInTheDocument();
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it("says what the server said when the save is refused", async () => {
    updatePassword.mockRejectedValue(new Error("New password should be different from the old password"));
    render(<SetNewPassword />);
    fireEvent.change(screen.getByPlaceholderText("At Least 6 Characters"), { target: { value: "hunter2!" } });
    fireEvent.click(screen.getByText("Set Password"));
    await waitFor(() => expect(screen.getByText(/should be different/)).toBeInTheDocument());
    // Still here, still holding what was typed, so it can be fixed.
    expect(screen.getByText("Set Password")).toBeInTheDocument();
  });

  it("Cancel drops the recovery session, for a link opened by mistake", async () => {
    render(<SetNewPassword />);
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });
});
