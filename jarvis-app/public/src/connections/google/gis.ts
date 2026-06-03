import { GOOGLE_SCOPES, googleClientId } from "./config";

// Loads Google Identity Services and runs the OAuth token flow (PKCE, no client
// secret). Browser-only; needs a configured client id and an authorized origin.
// This is the one piece that requires a live Google project to exercise.
interface TokenClient { requestAccessToken: () => void }
interface GoogleGlobal {
  accounts?: { oauth2?: { initTokenClient: (c: {
    client_id: string;
    scope: string;
    callback: (r: { access_token?: string; error?: string }) => void;
  }) => TokenClient } };
}
function gwin(): { google?: GoogleGlobal } {
  return window as unknown as { google?: GoogleGlobal };
}

let loading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (gwin().google?.accounts?.oauth2) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Google sign-in"));
    document.head.appendChild(s);
  });
  return loading;
}

export async function requestGoogleToken(): Promise<string> {
  const clientId = googleClientId();
  if (!clientId) throw new Error("Google is not set up yet");
  await loadGis();
  const oauth2 = gwin().google?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google sign-in unavailable");
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error || "No access token"))),
    });
    client.requestAccessToken();
  });
}
