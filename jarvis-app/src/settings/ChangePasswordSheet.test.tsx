// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ChangePasswordSheet from "./ChangePasswordSheet";
import { subscribeToast, resetToasts } from "../shared/toast";

// The sheet is Account > Change Password (2026-10-04, Dave). It is proven here
// against a stand-in for the auth provider: what it refuses before asking,
// what it says when Supabase refuses, and what a good change does.

const changePassword = vi.fn();
vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ changePassword: (...a: unknown[]) => changePassword(...a) }) }));

const toasts: string[] = [];
let stop = () => {};
beforeEach(() => { changePassword.mockReset().mockResolvedValue(undefined); toasts.length = 0; stop = subscribeToast((t) => { if (t) toasts.push(t.message); }); });
afterEach(() => { stop(); resetToasts(); });

const open = (onClose = vi.fn()) => { render(<ChangePasswordSheet onClose={onClose} />); return onClose; };
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const fill = (cur = "old-pass-1", next = "new-pass-2", conf = next) => { type("Current password", cur); type("New password", next); type("Confirm new password", conf); };
const save = () => fireEvent.click(screen.getByRole("button", { name: /^(Save|Saving)$/ }));

describe("Change Password sheet", () => {
  it("is a sheet with the three fields, password-typed, and tells the password manager which is which", () => {
    open();
    expect(screen.getByText("Change Password")).toBeInTheDocument();
    for (const [label, ac] of [["Current password", "current-password"], ["New password", "new-password"], ["Confirm new password", "new-password"]] as const) {
      const f = screen.getByLabelText(label);
      expect(f).toHaveAttribute("type", "password");
      expect(f).toHaveAttribute("autocomplete", ac);
    }
  });

  it("Save is dimmed until all three have something in them, and a tap on it asks for nothing yet", () => {
    open();
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("dim");
    type("Current password", "x");
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("dim");
    fill();
    expect(screen.getByRole("button", { name: "Save" })).not.toHaveClass("dim");
  });

  it("a tap on a dimmed Save says what is missing and sends nothing", () => {
    open();
    save();
    expect(screen.getByText("Enter your current password")).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("refuses a new password under six characters", () => {
    open(); fill("old-pass-1", "12345"); save();
    expect(screen.getByText("Use at least 6 characters")).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("refuses a new password that is the current one", () => {
    open(); fill("same-pass", "same-pass"); save();
    expect(screen.getByText("Your new password has to be different from your current one")).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("refuses a confirmation that does not match, and marks that field", () => {
    open(); fill("old-pass-1", "new-pass-2", "new-pass-3"); save();
    expect(screen.getByText("The two new passwords don't match")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm new password")).toHaveClass("input-error");
    expect(screen.getByLabelText("New password")).not.toHaveClass("input-error");
  });

  it("typing again clears the message", () => {
    open(); fill("old-pass-1", "12345"); save();
    expect(screen.getByText("Use at least 6 characters")).toBeInTheDocument();
    type("New password", "123456");
    expect(screen.queryByText("Use at least 6 characters")).not.toBeInTheDocument();
  });

  it("a good change sends both passwords once, says it worked, and closes", async () => {
    const onClose = open(); fill(); save();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(changePassword).toHaveBeenCalledTimes(1);
    expect(changePassword).toHaveBeenCalledWith("old-pass-1", "new-pass-2");
    expect(toasts).toContain("Password Updated");
  });

  it("a wrong current password is said in words, marks the field, and keeps what was typed", async () => {
    changePassword.mockRejectedValue({ code: "invalid_credentials", message: "Invalid login credentials" });
    const onClose = open(); fill("wrong-one", "new-pass-2"); save();
    expect(await screen.findByText(/isn't your current password/)).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toHaveClass("input-error");
    expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("new-pass-2");
    expect(onClose).not.toHaveBeenCalled();
    expect(toasts).not.toContain("Password Updated");
  });

  it("a dropped connection says so and the sheet stays open to try again", async () => {
    changePassword.mockRejectedValue(new TypeError("Failed to fetch"));
    const onClose = open(); fill(); save();
    expect(await screen.findByText(/Couldn't reach JARVIS/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    changePassword.mockResolvedValue(undefined);
    save();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("a second tap while it is saving does not send a second change", async () => {
    let release!: () => void;
    changePassword.mockReturnValue(new Promise<void>((r) => { release = r; }));
    open(); fill(); save(); save();
    expect(changePassword).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Saving" })).toBeInTheDocument();
    release();
  });

  it("Cancel closes without sending anything", () => {
    const onClose = open(); fill();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("Enter in the last field saves", async () => {
    const onClose = open(); fill();
    fireEvent.keyDown(screen.getByLabelText("Confirm new password"), { key: "Enter" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(changePassword).toHaveBeenCalledWith("old-pass-1", "new-pass-2");
  });
});
