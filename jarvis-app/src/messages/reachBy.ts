// HOW TO REACH THEM (Dave, 2026-08-21: "Email buttons suck. Make them useful.")
//
// The escalation ladder's top rung said "Try Calling" and then drafted an
// email. That is the button lying about what it does. A button that says
// Call has to dial, so the ladder needs to know whether a phone number
// exists for the person who owes the reply.
//
// Match on email first, because email is the identity the mail row actually
// carries. Name is the fallback, exact and case-insensitive only: a fuzzy
// name match would dial the wrong human, and dialing the wrong human is a
// worse failure than showing no Call button at all.

export interface Reachable {
  data: { name: string; email?: string; phone?: string };
}

export interface PhoneBook {
  byEmail: Record<string, string>;
  byName: Record<string, string>;
}

export function phoneBook(people: Reachable[]): PhoneBook {
  const byEmail: Record<string, string> = {};
  const byName: Record<string, string> = {};
  for (const p of people) {
    const phone = (p.data.phone ?? "").trim();
    if (!phone) continue;
    const email = (p.data.email ?? "").trim().toLowerCase();
    if (email && !byEmail[email]) byEmail[email] = phone;
    const name = (p.data.name ?? "").trim().toLowerCase();
    // A duplicated name is ambiguous, so it disqualifies itself rather than
    // picking one at random.
    if (!name) continue;
    if (name in byName) byName[name] = "";
    else byName[name] = phone;
  }
  return { byEmail, byName };
}

export function phoneFor(book: PhoneBook, email: string | undefined, name: string | undefined): string | undefined {
  const e = (email ?? "").trim().toLowerCase();
  if (e && book.byEmail[e]) return book.byEmail[e];
  const n = (name ?? "").trim().toLowerCase();
  if (n && book.byName[n]) return book.byName[n];
  return undefined;
}

// tel: with only digits and +, same normalisation the person detail and call
// prep card already use. One dialer format in the app, not three.
export function telLink(phone: string): string {
  return "tel:" + phone.replace(/[^+\d]/g, "");
}
