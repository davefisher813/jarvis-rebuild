import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { clearSignedOutData } from "../settings/clearLocalData";
import { clearUndo } from "../shared/undoStack";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { emit } from "../events";
import { apiUrl, webOrigin } from "../shared/apiBase";

// Auth state for the app. Wraps Supabase Auth. When no backend is configured
// (sandbox), session stays null and the methods report that clearly, so the
// Sign In screen still renders for review.
interface AuthValue {
  session: Session | null;
  ready: boolean;
  backendConfigured: boolean;
  signInWithApple: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  // SHELL-F-04 (2026-09-05): true while this session came from a recovery
  // link and no new password has been set yet. The app shows the Set a New
  // Password screen instead of the app for exactly that window.
  recovery: boolean;
  updatePassword: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN") emit({ type: "auth.signed_in" });
      if (event === "SIGNED_OUT") { setRecovery(false); emit({ type: "auth.signed_out" }); }
      // SHELL-F-04 (2026-09-05): the reset email's link opens the app in a
      // browser and detectSessionInUrl signs that browser in, so JARVIS
      // showed the ordinary app and offered nowhere to type a new password.
      // The old one still did not work, and the locked-out user stayed
      // locked out. This is the event Supabase raises for exactly that
      // landing, and it is the whole signal the app needs.
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      ready,
      recovery,
      backendConfigured: !!supabase,
      signInWithApple: async () => {
        if (!supabase) throw new Error("Auth backend not configured");
        // Real build swaps in Apple's official Sign in with Apple flow.
        await supabase.auth.signInWithOAuth({ provider: "apple" });
      },
      signInWithEmail: async (email: string) => {
        if (!supabase) throw new Error("Auth backend not configured");
        await supabase.auth.signInWithOtp({ email });
      },
      signUpWithPassword: async (email: string, password: string) => {
        if (!supabase) throw new Error("Auth backend not configured");
        const res = await supabase.auth.signUp({ email, password });
        if (res.error) throw res.error;
        // With email confirmation off, a session comes back immediately. If not,
        // fall back to an explicit password sign-in.
        if (!res.data.session) {
          const si = await supabase.auth.signInWithPassword({ email, password });
          if (si.error) throw si.error;
        }
      },
      signInWithPassword: async (email: string, password: string) => {
        if (!supabase) throw new Error("Auth backend not configured");
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      // S3-Q18 (2026-09-04): "there is no Forgot Password anywhere, so a user
      // who forgets it is locked out for good." One Supabase call: it emails
      // a recovery link the user follows in a browser to set a new password,
      // then comes back and signs in as normal.
      sendPasswordReset: async (email: string) => {
        if (!supabase) throw new Error("Auth backend not configured");
        // SHELL-F-04: the link has to land somewhere that runs this app. With
        // no redirectTo it went to the project's Site URL, which on the phone
        // is not this app at all.
        const to = webOrigin();
        const { error } = await supabase.auth.resetPasswordForEmail(email, to ? { redirectTo: to } : undefined);
        if (error) throw error;
      },
      // SHELL-F-04: the second half of the reset. The recovery session is a
      // real session, so this is the ordinary updateUser call; what matters
      // is that the flag drops only after the write landed, so a failed save
      // leaves the person on the screen that can still fix it.
      updatePassword: async (password: string) => {
        if (!supabase) throw new Error("Auth backend not configured");
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setRecovery(false);
      },
      signOut: async () => {
        await supabase?.auth.signOut();
        setRecovery(false);
        // One user's data on shared glass dies with the session,
        // unconditionally.
        //
        // SHELL-F-10 (2026-09-05): this used to be the preload cache and the
        // undo stack, two of roughly forty device-local keys, so a family
        // member signing in on the same phone got Dave's last ten capture
        // titles in Quick Capture, his recent searches, his VIP and mute
        // rules in Email, and his notification dismissals. See
        // settings/clearLocalData.ts for what goes, what stays, and why.
        clearSignedOutData();
        clearUndo();
      },
      // S3-Q18: "there is no way to delete an account," though the Privacy
      // Policy already promises one. Deleting the auth user (and everything
      // it owns) needs the service-role key, which never belongs on a
      // client, so this calls the same deployed API every other privileged
      // JARVIS call already routes through (see AIService, tracking.ts).
      //
      // SHELL-F-03 (2026-09-05): that endpoint is api/account/delete.ts in
      // this repo now. It was described here as "a companion endpoint there,
      // not in this repo" and was never written, so this tap answered
      // "Couldn't delete your account (404)" every time it was made.
      deleteAccount: async () => {
        if (!supabase) throw new Error("Auth backend not configured");
        const token = session?.access_token;
        if (!token) throw new Error("Not signed in.");
        const res = await fetch(apiUrl("/api/account/delete"), {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          // The endpoint replies { error } in its own words when it has any
          // (the not-configured case is the one worth reading); otherwise
          // the status is all there is to say.
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || `Couldn't delete your account (${res.status})`);
        }
        await supabase.auth.signOut();
        clearSignedOutData();
        clearUndo();
      },
    }),
    [session, ready, recovery],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}

// For features where auth is an ENHANCEMENT, not a requirement (open-tracking
// registration, for one): outside AuthProvider this returns null instead of
// throwing, so demo mode, the bench, and component tests need no auth stack.
export function useOptionalSession(): Session | null {
  return useContext(AuthContext)?.session ?? null;
}
