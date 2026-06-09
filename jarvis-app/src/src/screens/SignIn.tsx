import { useState } from "react";
import { Brain, Mail } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";

// Sign in. "Continue with Email" opens an email + password form (create account
// or sign in). Apple sign-in returns once an Apple Developer account is set up.
export default function SignIn() {
  const { signInWithPassword, signUpWithPassword, backendConfigured } = useAuth();
  const [view, setView] = useState<"choose" | "email">("choose");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (!email.trim() || password.length < 6) {
      setError("Enter your email and a password of at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") await signUpWithPassword(email.trim(), password);
      else await signInWithPassword(email.trim(), password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (view === "email") {
    return (
      <div className="screen signin">
        <div className="nav-bar">
          <button className="nav-back" aria-label="Back" onClick={() => { setView("choose"); setError(""); }}>
            <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div className="nav-title">{mode === "signup" ? "Create Account" : "Sign In"}</div>
        </div>
        <div className="pad-x sheet-form">
          <div className="field">
            <div className="input-label">Email</div>
            <input className="input" type="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <div className="input-label">Password</div>
            <input className="input" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder="At least 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <div className="input-error">{error}</div>}
          <button className="btn btn-primary btn-block btn-lg" onClick={submit} disabled={busy}>
            {busy ? "Working..." : mode === "signup" ? "Create Account" : "Sign In"}
          </button>
          <button className="btn btn-secondary btn-block" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setError(""); }}>
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
          By continuing you agree to our <a href="#">Terms</a> and <a href="#">Privacy Policy</a>.
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
