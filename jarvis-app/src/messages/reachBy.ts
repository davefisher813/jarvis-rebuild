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

// sms: with the same normalisation as tel:. Offered only when a phone exists,
// for the same reason Call is: a button that opens an empty Messages thread
// is a button that lied.
export function smsLink(phone: string): string {
  return "sms:" + phone.replace(/[^+\d]/g, "");
}

// SOMEBODY ELSE AT THE SAME PLACE.
//
// The move nobody thinks of at 11pm, and the one thing a mail app can only
// offer if it knows your people. Fifty-three days of silence from one address
// is not fifty-three days of silence from the organisation.
//
// Two rules keep it from guessing:
//   - A free mail domain is not an organisation. Everyone on gmail.com is not
//     a colleague of everyone else on gmail.com.
//   - Exactly one other known person, or none. With five candidates we do not
//     know WHICH, and picking one at random puts a stranger's name on a
//     button. Forward It already covers the general case.
export interface Colleague { name: string; email: string }

const FREE_MAIL = /^(gmail|googlemail|icloud|me|mac|yahoo|ymail|hotmail|outlook|live|msn|aol|proton|protonmail|pm|gmx|mail|zoho|fastmail|hey)\./;

export function colleagueBook(people: Reachable[]): Record<string, Colleague[]> {
  const out: Record<string, Colleague[]> = {};
  for (const p of people) {
    const email = (p.data.email ?? "").trim().toLowerCase();
    const name = (p.data.name ?? "").trim();
    if (!email || !name) continue;
    const domain = email.split("@")[1];
    if (!domain || FREE_MAIL.test(domain)) continue;
    const list = out[domain] ?? (out[domain] = []);
    if (!list.some((c) => c.email === email)) list.push({ name, email });
  }
  return out;
}

export function altFor(book: Record<string, Colleague[]>, toEmail: string | undefined): Colleague | null {
  const e = (toEmail ?? "").trim().toLowerCase();
  const domain = e.split("@")[1];
  if (!domain) return null;
  const others = (book[domain] ?? []).filter((c) => c.email !== e);
  return others.length === 1 ? others[0]! : null;
}

// The first name is what goes on the button: "Ask Marcus Instead" fits a
// 390px row, "Ask Marcus Delaney Instead" does not.
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
