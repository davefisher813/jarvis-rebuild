import { Capacitor, registerPlugin } from "@capacitor/core";
import { supabase } from "../auth/supabaseClient";

// REMOTE PUSH, THE PHONE'S HALF (2026-10-05, iOS preparation).
//
// @capacitor/push-notifications asks iOS for a device token (APNs) and hands it
// to us; we keep it on the account (device_token, migration 0054) so a server
// can address a push to this phone. THE SENDER IS NOT BUILT: it needs an Apple
// Developer account's APNs key, which is Dave's. Until it exists the token is
// stored and nothing is sent, which is why nothing here shows the person
// anything: a prompt or a switch for an alert that cannot arrive would be a
// dead control (the rule this file's neighbours were audited against).
//
// The permission is the same one the local reminders ask for (iOS has one
// notification permission), so the first request rides the existing ask in
// shared/notifications.ts (requestNotificationPermission), made on the
// Notifications page the first time a switch goes on. After that the token is
// refreshed at every sign-in WITHOUT asking again, because an APNs token can
// change, and cleared at sign-out so an account stops being addressable at a
// phone it left.
//
// Bound BY NAME (registerPlugin), like every native seam here, so this
// compiles and tests on a checkout with no native layer.

interface PushPlugin {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(event: "registration", fn: (t: { value: string }) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(event: "registrationError", fn: (e: { error: string }) => void): Promise<{ remove: () => Promise<void> }>;
}

export type PushResult = "registered" | "denied" | "unavailable" | "failed";

export const PUSH_TOKEN_KEY = "jarvis.push.token.v1";

export interface PushDeps {
  isNative?: () => boolean;
  plugin?: PushPlugin;
  /** Writes the token to the account. Resolves when the server has it. */
  save?: (token: string, environment: "development" | "production", build: string) => Promise<void>;
  remove?: (token: string) => Promise<void>;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  environment?: "development" | "production";
  build?: string;
  /** How long to wait for the token before giving up. */
  timeoutMs?: number;
}

function defaults(deps: PushDeps) {
  const store = (() => { try { return deps.storage ?? localStorage; } catch { return null; } })();
  return {
    isNative: deps.isNative ?? (() => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios"),
    plugin: deps.plugin ?? registerPlugin<PushPlugin>("PushNotifications"),
    save: deps.save ?? (async (token: string, environment: string, build: string) => {
      if (!supabase) throw new Error("no backend");
      const { error } = await supabase.rpc("register_device_token", { p_token: token, p_environment: environment, p_build: build });
      if (error) throw error;
    }),
    remove: deps.remove ?? (async (token: string) => {
      if (!supabase) return;
      const { error } = await supabase.rpc("unregister_device_token", { p_token: token });
      if (error) throw error;
    }),
    store,
    environment: deps.environment ?? (import.meta.env.DEV ? "development" : "production"),
    build: deps.build ?? (typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev"),
    timeoutMs: deps.timeoutMs ?? 10_000,
  };
}

function tokenFromRegister(plugin: PushPlugin, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let done = false;
    const handles: { remove: () => Promise<void> }[] = [];
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const h of handles) void h.remove().catch(() => {});
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("push registration timed out"))), timeoutMs);
    void (async () => {
      try {
        handles.push(await plugin.addListener("registration", (t) => finish(() => resolve(t.value))));
        handles.push(await plugin.addListener("registrationError", (e) => finish(() => reject(new Error(e.error)))));
        await plugin.register();
      } catch (e) {
        finish(() => reject(e instanceof Error ? e : new Error(String(e))));
      }
    })();
  });
}

async function register(prompt: boolean, deps: PushDeps): Promise<PushResult> {
  const d = defaults(deps);
  if (!d.isNative()) return "unavailable";
  try {
    let perm = (await d.plugin.checkPermissions()).receive;
    if (perm === "prompt" || perm === "prompt-with-rationale") {
      if (!prompt) return "denied";
      perm = (await d.plugin.requestPermissions()).receive;
    }
    if (perm !== "granted") return "denied";
    const token = await tokenFromRegister(d.plugin, d.timeoutMs);
    await d.save(token, d.environment, d.build);
    try { d.store?.setItem(PUSH_TOKEN_KEY, token); } catch { /* the token is on the server; only the sign-out cleanup needs this */ }
    return "registered";
  } catch {
    return "failed";
  }
}

/** The first ask: may show iOS's permission dialog. Call from a person's own tap. */
export function registerForRemotePush(deps: PushDeps = {}): Promise<PushResult> {
  return register(true, deps);
}

/** At sign-in: refresh the token if the person already said yes; never asks. */
export function refreshRemotePushToken(deps: PushDeps = {}): Promise<PushResult> {
  return register(false, deps);
}

/** At sign-out: this account stops being addressable at this phone. Best effort. */
export async function unregisterRemotePush(deps: PushDeps = {}): Promise<void> {
  const d = defaults(deps);
  let token: string | null = null;
  try { token = d.store?.getItem(PUSH_TOKEN_KEY) ?? null; } catch { token = null; }
  if (!token) return;
  try { await d.remove(token); } catch { /* the next sign-in on this phone moves the token anyway */ }
  try { d.store?.removeItem(PUSH_TOKEN_KEY); } catch { /* nothing to do */ }
}
