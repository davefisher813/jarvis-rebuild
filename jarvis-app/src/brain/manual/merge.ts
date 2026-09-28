import type { Person, PersonData } from "../../people/types";
import { emailsOf, phonesOf, withEmails, withPhones, matchKeys } from "../../people/contactMethods";

/** Contact merge for the triage screen (Brain Manual v1, fixed 2026-09-28).
 *
 *  Dave's rules for it: a confirm first, Undo after, keep every field, move
 *  every link to the kept contact, and never treat two people as one on a
 *  name alone. This is the pure half (who is a duplicate, what the kept row
 *  holds); the store half, moving links and putting them back, is
 *  people/relink.ts behind PeopleService. */

/** Two rows are the same person only when they share an email address or a
 *  phone number. A name alone is not evidence: two different John Smiths is
 *  the common case (importMatch.ts says the same about imports). */
export function duplicatesOf(p: Person, people: Person[]): Person[] {
  const keys = new Set(matchKeys(p.data));
  if (keys.size === 0) return [];
  return people.filter((q) => q.id !== p.id && matchKeys(q.data).some((k) => keys.has(k)));
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function joinText(a: unknown, b: unknown): string | undefined {
  const sa = text(a);
  const sb = text(b);
  if (sa && sb && sa !== sb) return `${sa}\n\n${sb}`;
  return sa || sb || undefined;
}

function unionBy<T>(a: T[] | undefined, b: T[] | undefined, key: (v: T) => string): T[] | undefined {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const v of [...(a ?? []), ...(b ?? [])]) {
    const k = key(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out.length ? out : undefined;
}

/** The kept row after a merge: the survivor's own values win where both
 *  have one, and nothing the other row held is dropped. Lists are unioned,
 *  the two free-text fields (notes, the triage note) are joined, the other
 *  row's name becomes an alias, and any field only the other row has is
 *  carried over as it is. */
export function mergedPersonData(survivor: Person, loser: Person): PersonData {
  const s = survivor.data as PersonData & Record<string, unknown>;
  const l = loser.data as PersonData & Record<string, unknown>;
  const out: Record<string, unknown> = { ...l, ...s };
  // Fields only the survivor lacks keep the loser's value (the spread above);
  // an empty survivor value is not a value.
  for (const k of Object.keys(l)) {
    const sv = s[k];
    if (sv === undefined || sv === null || sv === "") out[k] = l[k];
  }
  Object.assign(out, withEmails(emailsOf(s).concat(emailsOf(l))));
  Object.assign(out, withPhones(phonesOf(s).concat(phonesOf(l))));
  const lName = text(l.name);
  const aliases = unionBy<string>(s.aliases, [...(l.aliases ?? []), ...(lName && lName !== text(s.name) ? [lName] : [])], (v) => v.trim().toLowerCase());
  out.aliases = aliases;
  out.roles = unionBy(s.roles, l.roles, (v) => JSON.stringify(v));
  out.categoryIds = unionBy(s.categoryIds, l.categoryIds, (v) => v);
  out.talkingPoints = unionBy(s.talkingPoints, l.talkingPoints, (v) => v.id);
  out.urls = unionBy(s.urls, l.urls, (v) => v);
  out.addresses = unionBy(s.addresses, l.addresses, (v) => v);
  out.notes = joinText(s.notes, l.notes);
  out.roleNote = joinText(s.roleNote, l.roleNote);
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as PersonData;
}
