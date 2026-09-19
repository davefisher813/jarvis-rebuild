// THE ONE PUBLIC ADDRESS (Track 3, 2026-09-19).
//
// Every other screen in this app is behind a session. A booking link is not:
// its whole job is to be opened by somebody who has never heard of JARVIS,
// on a phone that has never signed in. So one path, and only one, is allowed
// to render before the auth gate, and this decides whether a URL is it.
//
// Deliberately strict. A slug is what the server will look up by, so a
// character that does not belong in one is a URL this app does not answer,
// rather than a query sent on to be refused later.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i;

/** The slug in a public booking URL, or null when the URL is not one. */
export function bookingSlugOf(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 2 || parts[0] !== "book") return null;
  let slug: string;
  try {
    slug = decodeURIComponent(parts[1]!);
  } catch {
    // A malformed escape is not a slug; it is a mistyped or hostile URL.
    return null;
  }
  return SLUG_RE.test(slug) ? slug : null;
}
