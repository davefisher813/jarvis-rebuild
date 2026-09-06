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
const signInWithApple = vi.fn();
const signInWithEmail = vi.fn();

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({
    signInWithPassword,
    signUpWithPassword,
    sendPasswordReset,
    signInWithApple,
    signInWithEmail,
    backendConfigured: true,
  }),
}));

vi.mock("../shared/splash", () => ({ dismissSplash: () => {} }));

beforeEach(() => {
  signInWithPassword.mockReset();
  signUpWithPassword.mockReset();
  sendPasswordReset.mockReset();
  signInWithApple.mockReset().mockResolvedValue(undefined);
  signInWithEmail.mockReset().mockResolvedValue(undefined);
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
    // SHELL-F-19 (2026-09-05): the numbered template sections were replaced
    // by the reviewed Terms published at public/terms.html.
    expect(screen.getByText("Acceptable Use")).toBeInTheDocument();
    // SHELL-F-26 (2026-09-05): the back button used to say "About", a screen
    // nobody who is signing in has ever seen.
    fireEvent.click(screen.getByText("Sign In"));
    expect(screen.getByText("Welcome to JARVIS")).toBeInTheDocument();
  });

  it("Privacy Policy opens the real Privacy Policy screen", () => {
    render(<SignIn />);
    fireEvent.click(screen.getByText("Privacy Policy"));
    expect(screen.getByText("What We Collect")).toBeInTheDocument();
    expect(screen.getByText(/erases your entire account/)).toBeInTheDocument();
  });
});

// UP-LAUNCH-11 (2026-09-05), fork B: the link is the primary way in and the
// password is one tap behind "Use a Password Instead", so the password
// flows are reached from there now.
const usePassword = () => { openEmailSignIn(); fireEvent.click(screen.getByText("Use a Password Instead")); };

describe("SignIn Forgot Password", () => {
  it("appears with the password, and never on the create-account form", () => {
    openEmailSignIn();
    // Not until a password is asked for: there is nothing to forget yet.
    expect(screen.queryByText("Forgot Password?")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Use a Password Instead"));
    expect(screen.getByText("Forgot Password?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Create a new account"));
    expect(screen.queryByText("Forgot Password?")).not.toBeInTheDocument();
  });

  it("without an email typed, asks for one instead of calling anything", () => {
    usePassword();
    fireEvent.click(screen.getByText("Forgot Password?"));
    expect(screen.getByText(/Enter your email first/)).toBeInTheDocument();
    expect(sendPasswordReset).not.toHaveBeenCalled();
  });

  it("with an email typed, sends the reset and says so honestly", async () => {
    sendPasswordReset.mockResolvedValue(undefined);
    usePassword();
    fireEvent.change(screen.getByPlaceholderText("you@email.com"), { target: { value: "dave@example.com" } });
    fireEvent.click(screen.getByText("Forgot Password?"));
    await waitFor(() => expect(sendPasswordReset).toHaveBeenCalledWith("dave@example.com"));
    await screen.findByText("Check your email for a reset link.");
  });

  it("a failure surfaces as a real message, not a silent no-op", async () => {
    sendPasswordReset.mockRejectedValue(new Error("rate limited, try later"));
    usePassword();
    fireEvent.change(screen.getByPlaceholderText("you@email.com"), { target: { value: "dave@example.com" } });
    fireEvent.click(screen.getByText("Forgot Password?"));
    await screen.findByText("rate limited, try later");
  });
});

// SHELL-F-18 (2026-09-05): AuthProvider has carried signInWithApple and
// signInWithEmail since it was written and no screen offered either, so a
// reader of that file was told about two flows the app did not have.
describe("SignIn: Apple and the magic link", () => {
  it("offers Apple first, and taps it", async () => {
    render(<SignIn />);
    const apple = screen.getByText("Continue with Apple");
    expect(apple).toBeInTheDocument();
    fireEvent.click(apple);
    await waitFor(() => expect(signInWithApple).toHaveBeenCalledTimes(1));
  });

  it("says what went wrong when the provider is not switched on", async () => {
    signInWithApple.mockRejectedValue(new Error("Unsupported provider: provider is not enabled"));
    render(<SignIn />);
    fireEvent.click(screen.getByText("Continue with Apple"));
    await waitFor(() => expect(screen.getByText(/provider is not enabled/)).toBeInTheDocument());
  });

  it("emails a sign-in link to the address in the field, and says so", async () => {
    openEmailSignIn();
    fireEvent.change(screen.getByPlaceholderText("you@email.com"), { target: { value: "dave@example.com" } });
    fireEvent.click(screen.getByText("Email Me a Link"));
    await waitFor(() => expect(signInWithEmail).toHaveBeenCalledWith("dave@example.com"));
    expect(screen.getByText(/Check your email for a sign-in link/)).toBeInTheDocument();
  });

  it("asks for the address before sending, instead of sending nothing", () => {
    openEmailSignIn();
    fireEvent.click(screen.getByText("Email Me a Link"));
    expect(signInWithEmail).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter your email first/)).toBeInTheDocument();
  });

  // Creating an account is a password flow; a link is for getting back in.
  it("does not offer the link on the create-account form", () => {
    openEmailSignIn();
    fireEvent.click(screen.getByText("Create a new account"));
    expect(screen.queryByText("Email Me a Link")).not.toBeInTheDocument();
  });

  // UP-LAUNCH-11: the shape of the choice, which is the whole of fork B.
  it("leads with the link and keeps the password one tap away", () => {
    openEmailSignIn();
    // No password field until it is asked for: nothing to type, nothing to
    // forget, nothing for a password manager to fight over.
    expect(screen.queryByPlaceholderText("At Least 6 Characters")).not.toBeInTheDocument();
    expect(screen.getByText("Email Me a Link")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Use a Password Instead"));
    expect(screen.getByPlaceholderText("At Least 6 Characters")).toBeInTheDocument();
    expect(screen.getByText("Sign In", { selector: "button" })).toBeInTheDocument();
  });
});
