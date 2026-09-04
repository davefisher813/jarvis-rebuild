// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import SignIn from "./SignIn";

// S3-Q18 (2026-09-04): SignIn had no test file before this one. Three
// separate gaps closed here: no Forgot Password anywhere, and the Terms /
// Privacy links were href="#" (real screens now render in place, since Sign
// In has no signed-in navigation to route through yet).

const signInWithPassword = vi.fn();
const signUpWithPassword = vi.fn();
const sendPasswordReset = vi.fn();

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    signInWithPassword,
    signUpWithPassword,
    sendPasswordReset,
    backendConfigured: true,
  }),
}));

vi.mock("../shared/splash", () => ({ dismissSplash: () => {} }));

beforeEach(() => {
  signInWithPassword.mockReset();
  signUpWithPassword.mockReset();
  sendPasswordReset.mockReset();
});

function openEmailSignIn() {
  render(<SignIn />);
  fireEvent.click(screen.getByText("Continue with Email"));
}

describe("SignIn legal links", () => {
  it("Terms opens the real Terms of Service screen, and Back returns to Sign In", () => {
    render(<SignIn />);
    fireEvent.click(screen.getByText("Terms"));
    expect(screen.getAllByText("Terms of Service").length).toBeGreaterThan(0);
    expect(screen.getByText(/1\. Acceptance/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("About"));
    expect(screen.getByText("Welcome to JARVIS")).toBeInTheDocument();
  });

  it("Privacy Policy opens the real Privacy Policy screen", () => {
    render(<SignIn />);
    fireEvent.click(screen.getByText("Privacy Policy"));
    expect(screen.getByText(/request deletion of your account/)).toBeInTheDocument();
  });
});

describe("SignIn Forgot Password", () => {
  it("only appears in sign-in mode, not create-account mode", () => {
    openEmailSignIn();
    expect(screen.getByText("Forgot Password?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Create a new account"));
    expect(screen.queryByText("Forgot Password?")).not.toBeInTheDocument();
  });

  it("without an email typed, asks for one instead of calling anything", () => {
    openEmailSignIn();
    fireEvent.click(screen.getByText("Forgot Password?"));
    expect(screen.getByText(/Enter your email first/)).toBeInTheDocument();
    expect(sendPasswordReset).not.toHaveBeenCalled();
  });

  it("with an email typed, sends the reset and says so honestly", async () => {
    sendPasswordReset.mockResolvedValue(undefined);
    openEmailSignIn();
    fireEvent.change(screen.getByPlaceholderText("you@email.com"), { target: { value: "dave@example.com" } });
    fireEvent.click(screen.getByText("Forgot Password?"));
    await waitFor(() => expect(sendPasswordReset).toHaveBeenCalledWith("dave@example.com"));
    await screen.findByText("Check your email for a reset link.");
  });

  it("a failure surfaces as a real message, not a silent no-op", async () => {
    sendPasswordReset.mockRejectedValue(new Error("rate limited, try later"));
    openEmailSignIn();
    fireEvent.change(screen.getByPlaceholderText("you@email.com"), { target: { value: "dave@example.com" } });
    fireEvent.click(screen.getByText("Forgot Password?"));
    await screen.findByText("rate limited, try later");
  });
});
