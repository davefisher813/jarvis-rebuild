import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { emit } from "../events";

// Auth state for the app. Wraps Supabase Auth. When no backend is configured
// (sandbox), session stays null and the methods report that clearly, so the
// Sign In screen still renders for review.
interface AuthValue {
  session: Session | null;
  ready: boolean;
  backendConfigured: boolean;
  signInWithApple: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
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
      signOut: async () => {
        await supabase?.auth.signOut();
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
