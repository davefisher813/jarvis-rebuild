import { Suspense, useEffect, useState } from "react";
import { lazyWithRecovery } from "./shell/chunkRecovery";
import { useAuth } from "./auth/AuthProvider";
import { NotesProvider, useProfile } from "./data/NotesProvider";
import { backendConfigured } from "./data/store";
import SignIn from "./screens/SignIn";
import AppShell from "./shell/AppShell";
import { GoogleSessionProvider } from "./connections/google/GoogleSession";

// Onboarding is a one-time surface; keep it out of the startup bundle that
// every returning user pays for.
const OnboardingFlow = lazyWithRecovery(() => import("./onboarding/OnboardingFlow"));

// First-run gate (inside the provider so it can read the profile): show the
// conversational onboarding until there is an onboarded profile, then the app.
function AppGate({ seedDemo = false }: { seedDemo?: boolean }) {
  const profile = useProfile();
  const [state, setState] = useState<"loading" | "onboarding" | "app">("loading");

  useEffect(() => {
    let on = true;
    profile.isOnboarded().then((ok) => {
      if (on) setState(ok ? "app" : "onboarding");
    });
    return () => {
      on = false;
    };
  }, [profile]);

  if (state === "loading") return null;
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
