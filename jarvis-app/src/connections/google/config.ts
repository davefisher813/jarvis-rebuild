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
//
// GOOGLE DRIVE (Dave 2026-09-29). The account can now be linked to Drive so
// the "Grant Access" button on a Drive access-request email can be a true
// one-tap grant (a Drive permissions.create call) instead of opening the
// share page. The scope that permits it is the full
// https://www.googleapis.com/auth/drive, and the narrower ones do not:
//   - drive.file only covers files this app CREATED or the user OPENED WITH
//     it (through a picker). The files people ask Dave for access to were made
//     in Docs and Sheets, not by JARVIS, so a permissions.create on them
//     fails with a 403 under drive.file.
//   - drive.readonly, drive.metadata.readonly and drive.appdata cannot change
//     sharing at all.
// permissions.create lists drive and drive.file as the scopes it accepts, so
// drive is the one that covers a file JARVIS did not create. This is written
// from Google's documented scope table; the network here could not reach
// developers.google.com to re-check it, so the first real grant on a phone is
// the proof. The Drive scope is a RESTRICTED one: an app with more than a
// handful of users needs Google's verification before it can ask for it.
//
// Nothing calls Drive yet. The grant itself stays one tap, by Dave, each time;
// nothing grants, shares or moves a file on its own.
//
// Adding a scope reaches no account that already connected. Every account is
// stamped with the exact scope string it authorized under (GoogleSession's
// scope gate compares it to this string), so the moment this list changes,
// each connected account is refused a silent token and shows Signed out until
// its one interactive reconnect authorizes the new list.
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  DRIVE_SCOPE,
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
