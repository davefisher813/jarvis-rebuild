import { useEffect, useState } from "react";
import { Brain, Mail } from "../shared/icons";
import { useAuth } from "../auth/AuthProvider";
import { dismissSplash } from "../shared/splash";
import TermsPage from "../settings/TermsPage";
import PrivacyPage from "../settings/PrivacyPage";

// Sign in. "Continue with Email" opens an email + password form (create account
// or sign in). Apple sign-in returns once an Apple Developer account is set up.
export default function SignIn() {
  const { signInWithPassword, signUpWithPassword, sendPasswordReset, backendConfigured } = useAuth();
  useEffect(() => { dismissSplash(); }, []);
  const [view, setView] = useState<"choose" | "email">("choose");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // S3-Q18 (2026-09-04): there was no Forgot Password anywhere, so a user
  // who mistyped or forgot their password was locked out for good. This is
  // the whole fix: send the reset email and say so, honestly, either way.
  const [resetBusy, setResetBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  // Real Terms/Privacy Policy links (S3-Q18), shown right here since Sign In
  // renders before any signed-in navigation exists to route through.
  const [legal, setLegal] = useState<"terms" | "privacy" | null>(null);

  const submit = async () => {
    setError("");
    setResetSent(false);
    if (!email.trim() || password.length < 6) {
      setError("Email + password · 6 characters minimum");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") await signUpWithPassword(email.trim(), password);
      else await signInWithPassword(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong · Try again");
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    setError("");
    setResetSent(false);
    if (!email.trim()) {
      setError("Enter your email first, then tap Forgot Password again");
      return;
    }
    setResetBusy(true);
    try {
      await sendPasswordReset(email.trim());
      setResetSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that · Try again");
    } finally {
      setResetBusy(false);
    }
  };

  if (legal === "terms") return <TermsPage onBack={() => setLegal(null)} />;
  if (legal === "privacy") return <PrivacyPage onBack={() => setLegal(null)} />;

  if (view === "email") {
    return (
      <div className="screen signin">
        <div className="nav-bar">
          <button className="nav-back" aria-label="Back" onClick={() => { setView("choose"); setError(""); }}>          </button>
          <div className="nav-title">{mode === "signup" ? "Create Account" : "Sign In"}</div>
        </div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Email</div>
            <input className="input" type="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <div className="input-label">Password</div>
            <input className="input" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="At Least 6 Characters" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <div className="input-error">{error}</div>}
          {resetSent && <div className="input-hint">Check your email for a reset link.</div>}
          <button className="btn btn-primary btn-block btn-lg" onClick={submit} disabled={busy}>
            {busy ? "Working..." : mode === "signup" ? "Create Account" : "Sign In"}
          </button>
          {mode === "signin" && (
            <button className="btn btn-secondary btn-block" onClick={() => void forgotPassword()} disabled={resetBusy || busy}>
              {resetBusy ? "Sending..." : "Forgot Password?"}
            </button>
          )}
          <button className="btn btn-secondary btn-block" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); setResetSent(false); }}>
            {mode === "signup" ? "I already have an account" : "Create a new account"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen signin">
      <div className="signin-body">
        <div className="app-icon cat-bg-blue"><Brain size={32} /></div>
        <h1 className="signin-title">Welcome to JARVIS</h1>
        <p className="signin-tag">Your day, handled.</p>

        <div className="signin-actions">
          <button className="btn btn-lg btn-block btn-primary" onClick={() => setView("email")}>
            <Mail size={20} /> Continue with Email
          </button>
        </div>

        <p className="signin-legal">
          By continuing you agree to our{" "}
          <button type="button" className="legal-link" onClick={() => setLegal("terms")}>Terms</button> and{" "}
          <button type="button" className="legal-link" onClick={() => setLegal("privacy")}>Privacy Policy</button>.
        </p>

        {!backendConfigured && (
          <p className="signin-tag">
            Auth backend not set in this build. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable login.
          </p>
        )}
      </div>
    </div>
  );
}
