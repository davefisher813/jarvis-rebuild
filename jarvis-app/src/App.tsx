import { Suspense, useEffect, useState } from "react";
import { lazyWithRecovery } from "./shell/chunkRecovery";
import { useAuth } from "./auth/AuthProvider";
import { NotesProvider, useProfile } from "./data/NotesProvider";
import { backendConfigured } from "./data/store";
import SignIn from "./screens/SignIn";
import AppShell from "./shell/AppShell";
import { GoogleSessionProvider } from "./connections/google/GoogleSession";
import { FailedCard } from "./monitoring/ErrorBoundary";
import { captureError } from "./monitoring/monitor";
import { dismissSplash } from "./shared/splash";

// Onboarding is a one-time surface; keep it out of the startup bundle that
// every returning user pays for.
const OnboardingFlow = lazyWithRecovery(() => import("./onboarding/OnboardingFlow"));

// First-run gate (inside the provider so it can read the profile): show the
// conversational onboarding until there is an onboarded profile, then the app.
//
// SHELL-F-13 (2026-09-05): the profile read can fail. With no cached copy
// (Clear Local Data, a fresh sign-in) and no signal, it goes to the network
// and rejects; this used to drop that rejection, so `state` stayed "loading",
// the gate rendered null, and the splash's own ten-second safety net faded
// into a black screen with no card, no button and no retry. A rejection now
// lands on the same card the error boundaries wear, with Try Again re-running
// the read (a reload without signal would only fail the same way), and the
// splash is dismissed so the card can be seen.
export function AppGate({ seedDemo = false }: { seedDemo?: boolean }) {
  const profile = useProfile();
  const [state, setState] = useState<"loading" | "onboarding" | "app" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let on = true;
    setState("loading");
    profile.isOnboarded().then(
      (ok) => { if (on) setState(ok ? "app" : "onboarding"); },
      (e: unknown) => {
        if (!on) return;
        captureError(e, { where: "AppGate.isOnboarded" });
        setState("failed");
        dismissSplash();
      },
    );
    return () => {
      on = false;
    };
  }, [profile, attempt]);

  if (state === "loading") return null;
  if (state === "failed") {
    return <FailedCard sub="Couldn't reach your profile · Check your connection" actionLabel="Try Again" onAction={() => setAttempt((n) => n + 1)} />;
  }
  if (state === "onboarding") {
    return (
      <div className="ob-host">
        <Suspense fallback={null}>
          {/* Its own GoogleSessionProvider (2026-08-09): the connect step used
              to promise "Connect Gmail and Calendar" and then render two
              static rows, because the only provider lived inside the shell
              the user had not reached yet. Accounts connected here persist
              and the shell's provider picks them up. */}
          <GoogleSessionProvider>
            <OnboardingFlow onFinish={() => setState("app")} />
          </GoogleSessionProvider>
        </Suspense>
      </div>
    );
  }
  return <AppShell seedDemo={seedDemo} />;
}

// Three modes:
//  - no Supabase env (local / demo build): skip auth, in-memory store
//  - backend set, no session: Sign In
//  - signed in: gated app on the Supabase store
export default function App() {
  const { session, ready } = useAuth();
  if (!ready) return null;

  if (!backendConfigured) {
    return (
      <NotesProvider userId="local">
        <AppGate seedDemo />
      </NotesProvider>
    );
  }

  if (!session) return <SignIn />;

  return (
    <NotesProvider userId={session.user.id} accessToken={session.access_token}>
      <AppGate />
    </NotesProvider>
  );
}
