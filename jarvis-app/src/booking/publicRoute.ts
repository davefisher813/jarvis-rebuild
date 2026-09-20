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

// THE CANCEL LINK (2026-09-19). The confirmation email carries
// /book/<slug>?cancel=<booking id>, and that id is the whole authorization.
//
// WHY AN ID IS ENOUGH, AND WHEN IT WOULD NOT BE. A booking id is a random v4
// uuid, which is 122 bits nobody walks. It is disclosed to exactly two people:
// the visitor, in their own receipt and in the answer to their own booking, and
// the host, who owns it. So the link is a capability held by the one person
// entitled to use it, which is the same arrangement every booking service uses
// and needs no new column and no migration.
//
// What it must therefore never do is hand anything back that the link does not
// already imply. Someone holding a forwarded email learns the meeting they can
// already read in that email, and nothing else: no address, no other booking,
// and no way to ask about one.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The booking a cancel link names, or null when the URL does not name one.
 *  Strict for the same reason the slug is: a value that cannot be an id is a
 *  URL this app does not answer, rather than a query sent on to be refused. */
export function cancelIdOf(search: string): string | null {
  let id: string | null;
  try {
    id = new URLSearchParams(search).get("cancel");
  } catch {
    return null;
  }
  return id && UUID_RE.test(id) ? id.toLowerCase() : null;
}

/** The address that email puts in front of a visitor who cannot make it. */
export function cancelUrl(origin: string, slug: string, bookingId: string): string {
  return `${origin}/book/${slug}?cancel=${bookingId}`;
}
