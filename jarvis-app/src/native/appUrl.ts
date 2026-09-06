import { Capacitor, registerPlugin } from "@capacitor/core";

// URLS THAT ARRIVE FROM OUTSIDE (UP-LAUNCH-12, 2026-09-05).
//
// On the phone, three different things hand the app a URL: the OAuth callback
// coming back from Google's sign-in sheet, a Supabase magic link or password
// reset tapped in Mail, and the widget and shortcut deep links the native
// seven will add. All three arrive through the same Capacitor event,
// App.appUrlOpen, and all three want the same thing: parse it, act, and never
// let a URL from outside do something a URL from outside should not.
//
// So there is one bus, here. Handlers subscribe; the first one that says it
// handled the URL stops the rest, because a URL means one thing.
//
// The App plugin is bound BY NAME rather than imported, the same way
// shared/badge.ts binds Badge: registerPlugin is what @capacitor/app's own
// entry point does, and binding by name keeps this module compiling and
// testable on a checkout whose node_modules predate the dependency. Before
// `npm i @capacitor/app` and `npx cap sync ios`, addListener rejects and this
// module simply never delivers anything, which is exactly what the web build
// does anyway.

export type UrlHandler = (url: URL) => boolean | Promise<boolean>;

const handlers: UrlHandler[] = [];

/** Subscribe. Returns the unsubscribe, which callers in an effect must use. */
export function onAppUrl(fn: UrlHandler): () => void {
  handlers.push(fn);
  return () => {
    const i = handlers.indexOf(fn);
    if (i >= 0) handlers.splice(i, 1);
  };
}

/**
 * Deliver one URL to the handlers, newest first: a listener registered for
 * the sign-in flow that is happening RIGHT NOW should see the callback before
 * the standing handler that was registered at boot.
 *
 * Exported rather than private because the web half calls it too: on the web
 * the "incoming URL" is the address bar at boot, and it deserves the same
 * parsing as the native event rather than a second implementation of it.
 */
export async function deliverAppUrl(raw: string): Promise<boolean> {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  for (const fn of [...handlers].reverse()) {
    try {
      if (await fn(url)) return true;
    } catch {
      /* one handler's failure must not swallow the URL for the others */
    }
  }
  return false;
}

interface AppPlugin {
  addListener(
    event: "appUrlOpen",
    fn: (data: { url: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

let started = false;

/**
 * Start listening on the native side. Safe to call more than once, and a
 * no-op on the web, where nothing hands the app a URL after boot.
 */
export async function startAppUrlListener(): Promise<void> {
  if (started || !Capacitor.isNativePlatform()) return;
  started = true;
  try {
    const App = registerPlugin<AppPlugin>("App");
    await App.addListener("appUrlOpen", (data) => { void deliverAppUrl(data.url); });
  } catch {
    // No @capacitor/app pod in this build. The app works; deep links do not,
    // and the Dave step that installs it says so.
    started = false;
  }
}

/** Tests: forget every handler and the listener state. */
export function resetAppUrlForTest(): void {
  handlers.length = 0;
  started = false;
}
