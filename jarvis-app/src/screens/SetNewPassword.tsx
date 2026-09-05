import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { dismissSplash } from "../shared/splash";

// SHELL-F-04 (2026-09-05): where a password reset link lands.
//
// Forgot Password sent the email and there the flow ended: tapping the link
// opened the app in a browser, Supabase signed that browser in from the URL,
// and JARVIS showed the ordinary app with nowhere to type a new password. Back
// on the phone the old password still did not work, so a locked-out person
// stayed locked out with no way through at all.
//
// AuthProvider raises `recovery` on the PASSWORD_RECOVERY event and App shows
// this screen instead of the app for exactly that window. Setting the password
// clears the flag and the app opens, already signed in, which is what the
// recovery session is for.
export default function SetNewPassword() {
  const { updatePassword, signOut } = useAuth();
  useEffect(() => { dismissSplash(); }, []);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError("");
    if (password.length < 6) {
      setError("Use at least 6 characters");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that · Try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen signin">
      <div className="nav-bar">
        <div className="nav-title">Set a New Password</div>
      </div>
      <div className="pad-x sheet-form">
        <div className="field">
          <div className="input-label">New Password</div>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="At Least 6 Characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
            autoFocus
          />
        </div>
        {error && <div className="input-error">{error}</div>}
        <button className="btn btn-primary btn-block btn-lg" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving..." : "Set Password"}
        </button>
        {/* The way out for someone who opened the link by accident, or who
            changed their mind. Signing out drops the recovery session, which
            is the only thing this screen is holding. */}
        <button className="btn btn-secondary btn-block" onClick={() => void signOut()} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
