import { Suspense, useEffect, useRef, useState } from "react";
import { lazyWithRecovery } from "./shell/chunkRecovery";
import { useAuth } from "./auth/AuthProvider";
import { NotesProvider, useProfile } from "./data/NotesProvider";
import { backendConfigured } from "./data/store";
import SignIn from "./screens/SignIn";
import SetNewPassword from "./screens/SetNewPassword";
import AppShell from "./shell/AppShell";
import { GoogleSessionProvider } from "./connections/google/GoogleSession";
import { FailedCard } from "./monitoring/ErrorBoundary";
import { captureError } from "./monitoring/monitor";
import { dismissSplash } from "./shared/splash";
import { useSheetEscape } from "./shared/useSheetEscape";
import { useLayerFocus } from "./shared/useLayerFocus";
import { bookingSlugOf, cancelIdOf } from "./booking/publicRoute";

// Onboarding is a one-time surface; keep it out of the startup bundle that
// every returning user pays for.
const OnboardingFlow = lazyWithRecovery(() => import("./onboarding/OnboardingFlow"));
const PublicBookingPage = lazyWithRecovery(() => import("./booking/PublicBookingPage"));
const PublicCancelPage = lazyWithRecovery(() => import("./booking/PublicCancelPage"));

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
  // 2026-09-11: every Supabase token refresh (hourly, and on resume) rebuilds
  // the services, so `profile` changes under a signed-in user. Dropping back
  // to "loading" for that unmounted the whole shell: open sheets, typed text,
  // where he was, the in-memory Google tokens. Once the gate has answered, a
  // new service re-checks quietly and moves only if the answer changed. A
  // different user never gets here: App keys this gate by user id.
  const answered = useRef(false);

  useEffect(() => {
    let on = true;
    const quiet = answered.current;
    if (!quiet) setState("loading");
    profile.isOnboarded().then(
      (ok) => {
        if (!on) return;
        answered.current = true;
        setState(ok ? "app" : "onboarding");
      },
      (e: unknown) => {
        if (!on) return;
        captureError(e, { where: "AppGate.isOnboarded" });
        // Already in: the answer we have stands rather than a failure card
        // replacing what is on screen.
        if (quiet) return;
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
  const { session, ready, recovery } = useAuth();
  // THE ONE PUBLIC ADDRESS (Track 3, 2026-09-19). A booking link is opened by
  // somebody who has never signed in and never will, so /book/<slug> renders
  // above the auth gate. It is the only path that does. The page carries no
  // provider and no store: it talks to /api/book and nothing else, so a
  // visitor standing on it has no route to the app's data at all.
  const bookingSlug = typeof window === "undefined" ? null : bookingSlugOf(window.location.pathname);
  // THE SAME ADDRESS, THE OTHER DIRECTION (2026-09-19). /book/<slug>?cancel=<id>
  // is the link in a visitor's own confirmation email. The id is a random uuid
  // disclosed only to them and to the host, which is what lets a page with no
  // session act on one booking and no other.
  const cancelId = typeof window === "undefined" ? null : cancelIdOf(window.location.search);
  // BROWSER-F-15 (2026-09-05): Escape closes the top sheet, from here, so all
  // 34 sheet call sites get it and the next one does too. Mounted above the
  // auth gate on purpose: onboarding has sheets as well.
  useSheetEscape();
  useLayerFocus();
  if (bookingSlug) {
    return (
      <Suspense fallback={null}>
        {cancelId
          ? <PublicCancelPage bookingId={cancelId} />
          : <PublicBookingPage slug={bookingSlug} />}
      </Suspense>
    );
  }
  if (!ready) return null;

  if (!backendConfigured) {
    return (
      <NotesProvider userId="local">
        <AppGate seedDemo />
      </NotesProvider>
    );
  }

  // SHELL-F-04 (2026-09-05): a session that arrived from a reset link is a
  // real session, so this branch used to hand it the ordinary app and the
  // person who came to change their password had nowhere to do it. It comes
  // before the session check because a recovery landing HAS a session.
  if (recovery) return <SetNewPassword />;

  if (!session) return <SignIn />;

  return (
    <NotesProvider userId={session.user.id} accessToken={session.access_token}>
      <AppGate key={session.user.id} />
    </NotesProvider>
  );
}
