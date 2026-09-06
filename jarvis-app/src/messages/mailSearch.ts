import { namePatterns } from "../people/mentions";
import { displayName } from "./names";

// SEARCH FOR ONE WORD AND A NAME (UP-MIND-15, Email E2 and 5.3).
//
// 94% of mail queries are one word and about 40% of them name a person, and
// the thing people do on a phone is give up and open webmail. The field
// answered on Enter only, passed the raw string to Gmail, and sorted by
// date: type "marco" and you got whichever threads happen to contain the
// string "marco", in date order, with mail TO him and mail FROM him and a
// newsletter that mentions him all mixed together.
//
// Three changes, all deterministic and none of them AI:
//   - It answers AS YOU TYPE, from three characters.
//   - A query that is a NAME becomes a question about that person:
//     "from:them OR to:them", grouped under their name.
//   - The groups are ranked by who they are to you, then by how much there
//     is, so a labelled contact or someone on an active project comes above
//     a stranger with the same name.
//
// The raw query stays the fallback for everything that is not a name, which
// is most searches, and an operator the user types themselves is passed
// straight through untouched.

// Long enough that "ma" does not fire three requests on the way to "marco",
// short enough that a real query answers while you are still typing.
export const MIN_CHARS = 3;
export const DEBOUNCE_MS = 350;

const RECENTS_KEY = "jarvis.mail.recents.v1";
const RECENTS_CAP = 6;

export function loadRecents(storage: Pick<Storage, "getItem"> = localStorage): string[] {
  try {
    const raw = JSON.parse(storage.getItem(RECENTS_KEY) || "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string").slice(0, RECENTS_CAP) : [];
  } catch {
    return [];
  }
}

/** Remembered only when the search actually found something: a list of
 *  queries that returned nothing is a list of dead ends. */
export function rememberSearch(
  q: string,
  storage: Pick<Storage, "getItem" | "setItem"> = localStorage,
): string[] {
  const query = q.trim();
  if (!query) return loadRecents(storage);
  const next = [query, ...loadRecents(storage).filter((r) => r.toLowerCase() !== query.toLowerCase())].slice(0, RECENTS_CAP);
  try { storage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

export interface SearchPerson {
  name: string;
  email: string;
  /** A relationship label ("Sister", "Client"), when Contacts has one. */
  label?: string;
  /** True when a thread with them is linked to a live project. */
  onProject?: boolean;
}

// Anything with a colon in it is the user speaking Gmail. Left alone: they
// know what they asked for better than this does.
const HAS_OPERATOR = /[a-z]+:/i;

export interface ExpandedQuery {
  query: string;
  /** Present when the query resolved to one person. */
  person?: SearchPerson;
}

/** Turns a bare name into a question about that person. Uses the same narrow
 *  matcher the person card uses, so "Will" does not match everyone whose mail
 *  contains the word. */
export function expandQuery(raw: string, people: SearchPerson[]): ExpandedQuery {
  const q = raw.trim();
  if (q.length < MIN_CHARS || HAS_OPERATOR.test(q)) return { query: q };
  const hits = people.filter((p) => p.email && namePatterns(p.name).some((re) => re.test(q)));
  // Two people answering to one name is not a person query: the plain search
  // is the honest answer, and the groups below still separate them.
  if (hits.length !== 1) return { query: q };
  const p = hits[0]!;
  return { query: `from:${p.email} OR to:${p.email}`, person: p };
}

export interface SearchRow { id: string; from: string; fromEmail: string; dateMs: number }

export interface SearchGroup<T extends SearchRow> {
  email: string;
  name: string;
  rows: T[];
  /** Lower sorts first. */
  rank: number;
}

// WHO THEY ARE TO YOU DECIDES THE ORDER. A labelled contact first, then
// someone on a live project, then a frequent correspondent, then everyone
// else; ties broken by how much there is, then by name so the order is
// stable between renders.
export function rankPerson(p: SearchPerson | undefined): number {
  if (!p) return 3;
  if (p.label?.trim()) return 0;
  if (p.onProject) return 1;
  return 2;
}

export function groupByPerson<T extends SearchRow>(rows: T[], people: SearchPerson[]): SearchGroup<T>[] {
  const known = new Map(people.map((p) => [p.email.toLowerCase(), p]));
  const groups = new Map<string, SearchGroup<T>>();
  for (const r of rows) {
    const email = (r.fromEmail || "").toLowerCase();
    const key = email || "unknown";
    const g = groups.get(key);
    if (g) { g.rows.push(r); continue; }
    const p = known.get(email);
    groups.set(key, { email, name: p?.name ?? displayName(r.from) ?? email, rows: [r], rank: rankPerson(p) });
  }
  return [...groups.values()].sort((a, b) =>
    a.rank - b.rank || b.rows.length - a.rows.length || a.name.localeCompare(b.name));
}
