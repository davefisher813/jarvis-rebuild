import { describe, it, expect } from "vitest";
import { phoneBook, phoneFor, telLink } from "./reachBy";
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
