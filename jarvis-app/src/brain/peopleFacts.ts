import type { DerivePerson } from "./derive";
import type { PeopleService } from "../people/PeopleService";
import { loadLastContact } from "../people/lastContact";
import { loadLinks } from "../messages/threadLink";
import { loadMailSnapshot } from "../messages/home";

// WHAT THE PEOPLE DERIVATIONS ARE ALLOWED TO KNOW (UP-MIND-16, 2026-09-05).
//
// The durable log carries person IDS and nothing else, by design: no names,
// no addresses, no free text ever leaves the device through it. So the two
// people derivations need the names handed to them, and this is the one
// place that assembles them.
//
// Everything here is read from stores the app already keeps. Nothing
// fetches, nothing costs a request, and a failure anywhere gives a thinner
// list rather than a broken Today.
export async function peopleForDerivation(people: PeopleService | null): Promise<DerivePerson[]> {
  if (!people) return [];
  const list = await people.list().catch(() => []);
  if (list.length === 0) return [];
  // A thread linked to a project, and who wrote it. This is what makes the
  // proposed label "Work" rather than the weaker "Frequent".
  const links = loadLinks();
  const projectThreads = new Set(Object.entries(links).filter(([, l]) => l.type === "project").map(([id]) => id));
  const snap = loadMailSnapshot();
  const onProject = new Set(
    snap.threads.filter((t) => projectThreads.has(t.id) && t.personId).map((t) => t.personId!),
  );
  // The cached last-contact times the person card already looks up. Read
  // only: this never triggers a Gmail search of its own.
  const cache = loadLastContact();
  return list.map((p) => {
    const email = (p.data.email || "").trim().toLowerCase();
    const lastMs = email ? cache[email]?.ms ?? null : null;
    return {
      id: p.id,
      name: p.data.name,
      ...(p.data.relationship ? { label: p.data.relationship } : {}),
      ...(onProject.has(p.id) ? { onProject: true } : {}),
      ...(typeof lastMs === "number" ? { lastMs } : {}),
    };
  });
}
