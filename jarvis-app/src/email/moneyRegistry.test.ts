// MONEY'S SENDER TEMPLATE REGISTRY (Email v1 spec 3.2 rule 4, 5.2). Every entry
// is checked for its declared shape, its positives, its same-sender negatives,
// and the four cases no parser ships without: positive, ambiguous, duplicate
// and changed source. All values in the fixtures are made up.
import { describe, it, expect } from "vitest";
import { MONEY_REQUIRED_FIELDS, MONEY_TEMPLATES, activeMoneyTemplateIds, matchMoney, type MoneyTemplate } from "./moneyRegistry";

const senderOf = (t: MoneyTemplate): string => ("address" in t.sender ? t.sender.address : `invoice+statements+acct_abc123@${t.sender.domain}`);

describe("the registry's integrity (5.2: id, version, match, schema, fixtures)", () => {
  it("every entry has a unique id, a positive version, an exact sender, account scope, an anchored subject and semantics", () => {
    const ids = MONEY_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of MONEY_TEMPLATES) {
      expect(t.id).toMatch(/^[a-z0-9]+\.[a-z_]+$/);
      expect(Number.isInteger(t.version) && t.version >= 1).toBe(true);
      if ("address" in t.sender) expect(t.sender.address).toMatch(/^[^@\s]+@[a-z0-9.-]+\.[a-z]+$/);
      else expect(t.sender.domain).toMatch(/^[a-z0-9.-]+\.[a-z]+$/);
      expect(t.accounts).toBe("any");
      expect(t.subject.source.startsWith("^")).toBe(true);
      expect(t.subject.source.endsWith("$")).toBe(true);
      expect(["invoice", "receipt", "statement"]).toContain(t.semantics);
      expect(t.issuer.trim()).not.toBe("");
      expect(t.fixtures.positive.length).toBeGreaterThan(0);
      expect(t.fixtures.negative.length).toBeGreaterThan(0);
    }
    expect(MONEY_REQUIRED_FIELDS).toEqual(["from_address", "subject"]);
    expect(activeMoneyTemplateIds()).toContain("coned.bill@1");
  });

  it("stays small and high precision: 5 to 15 senders", () => {
    const senders = new Set(MONEY_TEMPLATES.map((t) => ("address" in t.sender ? t.sender.address : t.sender.domain)));
    expect(senders.size).toBeGreaterThanOrEqual(5);
    expect(senders.size).toBeLessThanOrEqual(15);
  });
});

describe.each(MONEY_TEMPLATES.map((t) => [t.id, t] as const))("%s", (_id, t) => {
  const from = senderOf(t);

  it("positive: its own format from its own sender matches it, and only it, with the subject's offsets", () => {
    for (const subject of t.fixtures.positive) {
      const r = matchMoney({ from_address: from, subject });
      expect(r.kind).toBe("match");
      if (r.kind !== "match") continue;
      expect(r.match.template_id).toBe(t.id);
      expect(r.match.version).toBe(t.version);
      expect(r.match.semantics).toBe(t.semantics);
      expect(r.match.issuer).not.toBe("");
      const [a, b] = r.match.offsets.subject;
      expect(subject.slice(a, b)).toBe(subject);
      if (r.match.reference !== null) {
        const [ra, rb] = r.match.offsets.reference!;
        expect(subject.slice(ra, rb)).toBe(r.match.reference);
      }
      if (r.match.offsets.issuer) {
        const [ia, ib] = r.match.offsets.issuer;
        expect(subject.slice(ia, ib)).toBe(r.match.issuer);
      }
    }
  });

  it("negative: the same sender's other mail (marketing, alerts, notices) is not this template", () => {
    for (const subject of t.fixtures.negative) {
      const r = matchMoney({ from_address: from, subject });
      if (r.kind === "match") expect(r.match.template_id).not.toBe(t.id);
    }
  });

  it("ambiguous or out of bounds: another sender, a reply, a forward, or a missing required field is none", () => {
    const subject = t.fixtures.positive[0]!;
    expect(matchMoney({ from_address: "someone@example.test", subject }).kind).toBe("none");
    expect(matchMoney({ from_address: from, subject: `Re: ${subject}` }).kind).toBe("none");
    expect(matchMoney({ from_address: from, subject: `Fwd: ${subject}` }).kind).toBe("none");
    expect(matchMoney({ from_address: from, subject: "" }).kind).toBe("none");
    expect(matchMoney({ from_address: "", subject }).kind).toBe("none");
    expect(matchMoney({ from_address: null, subject: null }).kind).toBe("none");
  });

  it("duplicate: the same message twice (a refetch, or a copy in a second account) answers identically", () => {
    const subject = t.fixtures.positive[0]!;
    expect(matchMoney({ from_address: from, subject })).toEqual(matchMoney({ from_address: from.toUpperCase(), subject }));
  });

  it("changed source: a sender that moves to a subdomain or a lookalike, or rewords its subject, stops matching", () => {
    const subject = t.fixtures.positive[0]!;
    const [local, domain] = from.split("@") as [string, string];
    expect(matchMoney({ from_address: `${local}@mail.${domain}`, subject }).kind).toBe("none");
    expect(matchMoney({ from_address: `${local}@${domain}.example.test`, subject }).kind).toBe("none");
    expect(matchMoney({ from_address: from, subject: `Updated: ${subject}` }).kind).toBe("none");
    expect(matchMoney({ from_address: from, subject: subject.replace(/[A-Za-z]{4,}/, "Changed") }).kind).toBe("none");
  });
});

describe("matching across entries", () => {
  it("no fixture of one entry is claimed by two", () => {
    for (const t of MONEY_TEMPLATES) for (const subject of t.fixtures.positive) expect(matchMoney({ from_address: senderOf(t), subject }).kind).toBe("match");
  });

  it("two entries matching one message is ambiguous, never a guess", () => {
    const a: MoneyTemplate = { id: "x.bill", version: 1, sender: { address: "billing@example.test" }, accounts: "any", subject: /^Your bill$/, semantics: "invoice", issuer: "X", fixtures: { positive: ["Your bill"], negative: ["Sale"] } };
    const b: MoneyTemplate = { ...a, id: "x.receipt", semantics: "receipt" };
    expect(matchMoney({ from_address: "billing@example.test", subject: "Your bill" }, [a, b])).toEqual({ kind: "ambiguous", template_ids: ["x.bill", "x.receipt"] });
  });

  it("a domain entry holds to its local parts: Stripe's marketing address and its support address are not receipts", () => {
    const subject = "Your receipt from Example Hosting Ltd #1234-5678";
    expect(matchMoney({ from_address: "receipts+acct_zz9@stripe.com", subject }).kind).toBe("match");
    expect(matchMoney({ from_address: "updates@e.stripe.com", subject }).kind).toBe("none");
    expect(matchMoney({ from_address: "support+link-beta@stripe.com", subject }).kind).toBe("none");
  });

  it("reads the merchant a Stripe receipt names, with its offsets", () => {
    const subject = "Your Sample Foundation receipt [#2345-6789]";
    const r = matchMoney({ from_address: "receipts+acct_q1@stripe.com", subject });
    expect(r).toMatchObject({ kind: "match", match: { template_id: "stripe.receipt", issuer: "Sample Foundation", reference: "#2345-6789", semantics: "receipt" } });
  });

  it("a currency sign or an invoice word from an unregistered sender is never Money", () => {
    expect(matchMoney({ from_address: "friend@example.test", subject: "Invoice #12 from Example Athletics" }).kind).toBe("none");
    expect(matchMoney({ from_address: "shop@example.test", subject: "Your receipt from Apple." }).kind).toBe("none");
  });
});
