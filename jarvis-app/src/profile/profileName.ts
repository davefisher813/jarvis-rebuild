// A CHANGED NAME REACHES EVERY SCREEN THAT SHOWS IT (2026-10-04, Dave: "verify
// username change persists and shows everywhere the name appears").
//
// Edit Profile saves the name on the profile record, and every screen reads it
// from there, but Today reads it once when it loads and its tab can still be
// mounted behind Settings, so it kept showing the old initials and greeting
// until a reload. One window event says the name changed, the way the avatar's
// does (avatarPhoto.ts), so what is mounted follows without a reload and what
// mounts later reads the saved record.
const NAME_EVENT = "jarvis:profile-name";

export function announceProfileName(name: string): void {
  window.dispatchEvent(new CustomEvent<string>(NAME_EVENT, { detail: name }));
}

/** Calls back with each new name; returns the unsubscribe. */
export function onProfileName(cb: (name: string) => void): () => void {
  const on = (e: Event) => cb((e as CustomEvent<string>).detail ?? "");
  window.addEventListener(NAME_EVENT, on);
  return () => window.removeEventListener(NAME_EVENT, on);
}
