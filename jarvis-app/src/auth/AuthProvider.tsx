import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { clearPreload } from "../data/preloadCache";
import { clearUndo } from "../shared/undoStack";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { emit } from "../events";
import { apiUrl } from "../shared/apiBase";

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
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

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
      if (event === "SIGNED_OUT") emit({ type: "auth.signed_out" });
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      ready,
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
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
      },
      signOut: async () => {
        await supabase?.auth.signOut();
        // One user's data on shared glass dies with the session,
        // unconditionally: the preload cache and the undo stack both.
        clearPreload();
        clearUndo();
      },
      // S3-Q18: "there is no way to delete an account," though the Privacy
      // Policy already promises one. Deleting the auth user (and everything
      // it owns) needs the service-role key, which never belongs on a
      // client, so this calls the same deployed API every other privileged
      // JARVIS call already routes through (see AIService, tracking.ts) --
      // a companion endpoint there, not in this repo, does the actual
      // deletion. This throws a real error rather than pretending success
      // until that endpoint exists.
      deleteAccount: async () => {
        if (!supabase) throw new Error("Auth backend not configured");
        const token = session?.access_token;
        if (!token) throw new Error("Not signed in.");
        const res = await fetch(apiUrl("/api/account/delete"), {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`Couldn't delete your account (${res.status}). ${detail}`.trim());
        }
        await supabase.auth.signOut();
        clearPreload();
        clearUndo();
      },
    }),
    [session, ready],
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
