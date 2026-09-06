// EVERY MAIL FACT REMEMBERS WHO IT IS ABOUT (UP-MIND-10, Email E10 "schema
// now", Part 6).
//
// Waiting rows carry a display name, tasks carry a thread id, promises carry
// a sentence. None of them carried the PERSON, so the person card could not
// show what is still open with someone the app had been watching for months,
// and nothing built later could recover the link: a display name is not an
// identity, and matching one against Contacts after the fact is exactly the
// wrong-link problem people/mentions.ts exists to avoid.
//
// This is the resolver, and deliberately nothing more. Address equality,
// case-insensitive, no fuzzy matching and no name matching at all: a wrong
// person id attached to a promise is worse than no person id, because
// everything downstream would then believe it.
//
// Built once per snapshot build and handed around, because a snapshot can
// touch thirty rows and reading the People list thirty times is thirty reads
// of the same list.

export interface PersonEmail { id: string; email?: string }

export type PersonIdFor = (email: string | undefined) => string | undefined;

export function makePersonIdFor(people: PersonEmail[]): PersonIdFor {
  const byEmail = new Map<string, string>();
  for (const p of people) {
    const e = (p.email || "").trim().toLowerCase();
    // First one wins: two contacts sharing an address is a duplicate the
    // user has to settle, and picking a different one on each build would
    // make the link flicker between them.
    if (e && !byEmail.has(e)) byEmail.set(e, p.id);
  }
  return (email) => {
    const e = (email || "").trim().toLowerCase();
    return e ? byEmail.get(e) : undefined;
  };
}

/** The empty resolver, for a surface with no People service above it. Every
 *  caller degrades to exactly the behaviour it had before this shipped. */
export const noPersonId: PersonIdFor = () => undefined;
