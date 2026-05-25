import { useEffect, useState } from "react";
import { useAuth } from "./auth/AuthProvider";
import { NotesProvider, useProfile } from "./data/NotesProvider";
import { backendConfigured } from "./data/store";
import SignIn from "./screens/SignIn";
import AppShell from "./shell/AppShell";
import OnboardingFlow from "./onboarding/OnboardingFlow";

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
        <OnboardingFlow onFinish={() => setState("app")} />
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
