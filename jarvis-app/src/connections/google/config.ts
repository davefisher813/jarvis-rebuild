// Google integration config. The whole integration is dormant until a Google
// OAuth client id is provided at build time (VITE_GOOGLE_CLIENT_ID).
//
// THE SCOPE BUG (found 2026-08-26, after Dave reported delete doing nothing).
// This list was calendar.readonly + gmail.readonly + gmail.send, under a
// comment that said "we never modify the user's mail". Meanwhile the app
// grew archive, mark-read, mute, sweep, labels and trash: every one of them
// calls a Gmail endpoint that REQUIRES gmail.modify, and every one of them
// has returned 403 against a real account since the day it was built. The
// bench and the tests never caught it because fakes do not check scopes.
//
// gmail.modify is read + write EXCEPT permanent delete, which is exactly the
// app's own standing law (trash only, 30-day net, the permanent-delete
// endpoint is never called). Calendar stays readonly: the one calendar call
// is a GET, and JARVIS writes schedules to its own store, never to Google.
//
// A scope change does NOT reach accounts that already connected: their
// stored refresh tokens keep minting tokens with the old scopes forever.
// GoogleSession stamps each account with the scopes it authorized under and
// forces one interactive reconnect when the list changes. See the scope
// gate there.
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

export function googleClientId(): string {
  try {
    return (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_GOOGLE_CLIENT_ID || "";
  } catch {
    return "";
  }
}

export function googleConfigured(clientId: string = googleClientId()): boolean {
  return clientId.trim().length > 0;
}
