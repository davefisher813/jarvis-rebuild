import { Brain, Mail, Apple } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";

// Matches the approved design-gate preview. Uses canonical classes plus the
// approved RULE 9 components (components.css). Real iOS draws the status bar and
// home indicator; .screen handles the safe-area insets, so no chrome is faked.
export default function SignIn() {
  const { signInWithApple, backendConfigured } = useAuth();

  const onApple = async () => {
    try {
      await signInWithApple();
    } catch (e) {
      console.error("Apple sign-in failed:", e);
    }
  };

  // "Continue with Email" opens the email-entry screen, which is the next gated
  // screen. Wired once that screen passes the design gate.
  const onEmail = () => {
    // TODO: route to the email-entry screen (next gated screen)
  };

  return (
    <div className="screen signin">
      <div className="signin-body">
        <div className="app-icon cat-bg-brain">
          <Brain size={32} />
        </div>
        <h1 className="signin-title">Welcome to JARVIS</h1>
        <p className="signin-tag">Your day, handled.</p>

        <div className="signin-actions">
          <button className="btn btn-lg btn-block btn-apple" onClick={onApple}>
            <Apple size={20} /> Continue with Apple
          </button>
          <button className="btn btn-lg btn-block btn-secondary" onClick={onEmail}>
            <Mail size={20} /> Continue with Email
          </button>
        </div>

        <p className="signin-legal">
          By continuing you agree to our <a href="#">Terms</a> and{" "}
          <a href="#">Privacy Policy</a>.
        </p>

        {!backendConfigured && (
          <p className="signin-tag">
            Auth backend not set in this build. Wire VITE_SUPABASE_URL and
            VITE_SUPABASE_ANON_KEY on device.
          </p>
        )}
      </div>
    </div>
  );
}
