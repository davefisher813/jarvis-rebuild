import { describe, it, expect } from "vitest";
import { phoneBook, phoneFor, telLink, smsLink, colleagueBook, altFor, firstName } from "./reachBy";
import { loadLetGo, letGo, undoLetGo } from "./letGo";

const P = (name: string, email?: string, phone?: string) => ({ data: { name, email, phone } });

describe("reaching the person who owes the reply", () => {
  it("matches on email regardless of case", () => {
    const b = phoneBook([P("Mike Ridgeley", "Mike@ElitesQuad.org", "555 0100")]);
    expect(phoneFor(b, "mike@elitesquad.org", "someone else")).toBe("555 0100");
  });

  it("falls back to an exact name when no email matches", () => {
    const b = phoneBook([P("Coach Tucci", undefined, "555 0111")]);
    expect(phoneFor(b, "unknown@x.org", "coach tucci")).toBe("555 0111");
  });

  // Dialing the wrong human is worse than showing no Call button.
  it("refuses an ambiguous name", () => {
    const b = phoneBook([P("Mike", undefined, "555 0100"), P("Mike", undefined, "555 0222")]);
    expect(phoneFor(b, undefined, "Mike")).toBeUndefined();
  });

  it("ignores people with no phone", () => {
    const b = phoneBook([P("No Phone", "np@x.org")]);
    expect(phoneFor(b, "np@x.org", "No Phone")).toBeUndefined();
  });

  it("normalises the dialer link the same way everywhere", () => {
    expect(telLink("(607) 555-0142")).toBe("tel:6075550142");
    expect(telLink("+1 555 0100")).toBe("tel:+15550100");
    // Text Them rides the same number and the same normalisation, so it can
    // never drift into a second phone format (2026-08-21).
    expect(smsLink("(607) 555-0142")).toBe("sms:6075550142");
    expect(smsLink("+1 555 0100")).toBe("sms:+15550100");
  });
});

describe("letting a dead thread go", () => {
  const mem = () => {
    const m: Record<string, string> = {};
    return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => { m[k] = v; } };
  };

  it("remembers across reloads and reverses cleanly", () => {
    const s = mem();
    expect(loadLetGo(s)).toEqual([]);
    letGo("t1", s);
    letGo("t2", s);
    letGo("t1", s); // idempotent
    expect(loadLetGo(s)).toEqual(["t1", "t2"]);
    undoLetGo("t1", s);
    expect(loadLetGo(s)).toEqual(["t2"]);
  });

  it("survives junk in storage", () => {
    const s = mem();
    s.setItem("jarvis.mail.letgo.v1", "{not json");
    expect(loadLetGo(s)).toEqual([]);
  });
});

// WHO ELSE IS AT THE SAME PLACE (2026-08-21, wiring the mail alternates).
// Ask X Instead names a specific human on a button, so the rules that keep it
// from naming the wrong one are the feature.
describe("who else is at the same place", () => {
  const list = [
    P("Wei Chen", "wei@bffsa.org"),
    P("Marcus Delaney", "marcus@bffsa.org"),
    P("Dana Reed", "dana@gmail.com"),
    P("Sam Reed", "sam@gmail.com"),
  ];

  it("offers the one other person we know at that organisation", () => {
    const alt = altFor(colleagueBook(list), "wei@bffsa.org");
    expect(alt?.email).toBe("marcus@bffsa.org");
    expect(firstName(alt!.name)).toBe("Marcus");
  });

  // Everyone on gmail.com is not a colleague of everyone else on gmail.com.
  it("[edge] a free mail domain is not an organisation", () => {
    expect(altFor(colleagueBook(list), "dana@gmail.com")).toBeNull();
  });

  // Same rule as the ambiguous name above: with five candidates we do not know
  // WHICH, and Forward It already covers the general case.
  it("[edge] with several candidates we offer none", () => {
    const many = [...list, P("Ana Ruiz", "ana@bffsa.org")];
    expect(altFor(colleagueBook(many), "wei@bffsa.org")).toBeNull();
  });

  it("[edge] the only person we know there is the one who went quiet", () => {
    expect(altFor(colleagueBook([P("Wei", "wei@bffsa.org")]), "wei@bffsa.org")).toBeNull();
  });

  it("[edge] case and whitespace never split one person into two", () => {
    const b = colleagueBook([P("Wei", " WEI@BFFSA.ORG "), P("Marcus", "marcus@bffsa.org")]);
    expect(altFor(b, "wei@bffsa.org")?.email).toBe("marcus@bffsa.org");
  });
});
