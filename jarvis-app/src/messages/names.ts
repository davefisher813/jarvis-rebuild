// WHO THAT ACTUALLY IS (Dave, 2026-08-23: "handles to names")
//
// A waiting row said "jrubino" and "wei@bffsa.org" where a person's name
// belongs. Both come from `findWaiting`, which reads the To header and falls
// back to the localpart when the header carries no display name
// (waiting.ts:53). That fallback is correct as a fallback and wrong as
// something to show a human.
//
// Three sources, in order of how much they are trusted:
//
//   1. People. The app already knows this person's name. Use it.
//   2. The address itself, and only ever by CHANGING CASE or splitting on a
//      separator the sender typed. "wei.chen" becomes "Wei Chen" because
//      they wrote two words. "wei" becomes "Wei" because they wrote one.
//   3. Nothing. Show what was there.
//
// The line rule 2 does not cross: it never adds, removes or regroups
// characters. "jrubino" titlecases to "Jrubino", which still reads as the
// handle it is, and is NOT split into "J Rubino" because we do not know that
// the j is an initial. "dfisher2424" is left exactly alone, because a digit
// means we are looking at a handle and not at a name at all.
//
// Inventing a person's name out of a string of characters is the same class
// of mistake as dialing the wrong human, and reachBy.ts already refuses to
// do that.

// The transport quotes around a display name that contains a comma. Stripped
// at the Gmail boundary now (map.ts displayFrom), so this is for the paths
// that do NOT come through that mapper: the To header on a waiting row, a
// draft recipient, a rule key.
export const displayName = (n: string): string => n.replace(/^"+|"+$/g, "").trim();

export interface Named {
  data: { name: string; email?: string };
}

export interface NameBook {
  byEmail: Record<string, string>;
}

export function nameBook(people: Named[]): NameBook {
  const byEmail: Record<string, string> = {};
  for (const p of people) {
    const email = (p.data.email ?? "").trim().toLowerCase();
    const name = (p.data.name ?? "").trim();
    if (!email || !name) continue;
    if (!byEmail[email]) byEmail[email] = name;
  }
  return { byEmail };
}

// A localpart is safe to titlecase only when every piece of it is letters.
// One digit anywhere and we stop guessing.
const ALPHA = /^[a-z]+$/i;

export function prettyHandle(handle: string): string | null {
  const raw = handle.trim();
  if (!raw || raw.includes("@")) return null;
  const parts = raw.split(/[._-]+/).filter(Boolean);
  if (!parts.length || parts.length > 3) return null;
  if (!parts.every((p) => ALPHA.test(p) && p.length > 1)) return null;
  return parts.map((p) => p[0]!.toUpperCase() + p.slice(1).toLowerCase()).join(" ");
}

// `fallback` is whatever the row already carries, so the worst case here is
// exactly what shipped before this file existed.
export function nameFor(book: NameBook, email: string | undefined, fallback: string): string {
  const e = (email ?? "").trim().toLowerCase();
  if (e && book.byEmail[e]) return book.byEmail[e]!;

  // Headers quote display names ("Joseph T. Pareres" <j@x.com>), and when
  // the name part IS an address the quotes survive into the UI verbatim:
  // Dave's Waiting On read '"wei@bffsa.org" · Invoice'. Strip them the same
  // way displayName does.
  const raw = fallback.replace(/^"+|"+$/g, "").trim();
  // A bare address in the name slot: try its localpart, else leave it alone.
  if (raw.includes("@")) {
    const local = raw.split("@")[0] ?? "";
    return prettyHandle(local) ?? raw;
  }
  return prettyHandle(raw) ?? raw;
}
