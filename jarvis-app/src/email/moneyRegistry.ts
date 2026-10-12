// MONEY'S SENDER TEMPLATE REGISTRY, v1 (Email v1 spec 3.2 rule 4, 5.2 parser
// registry). A message is Money only when its exact registered sender (an exact
// address, or an exact domain with no subdomains) AND its subject format match
// one entry below, and that entry says what the message is: an invoice (owed),
// a receipt (paid) or a statement (ready to read). Nothing else qualifies: a
// currency sign, an attachment name, an "invoice" word from anyone else, a
// lookalike domain, a display name, or a reply or forward ("Re:", "Fwd:") of a
// registered message. Marketing from the same sender is a different subject and
// does not match (each entry carries the real ones as negative fixtures).
//
// List-time metadata only (from address and subject), so a message lands here
// on arrival, before it is opened. No body is read and nothing is extracted
// beyond what the subject itself names; amounts are never read here.
//
// The entries were chosen from the senders that actually send Dave bills and
// receipts (2026-10-12). Fixtures are synthetic: the subject FORMAT is the
// real one, every name, number and reference in them is made up.
//
// Adding or changing an entry: bump `version`, add positive, negative
// (same-sender marketing), ambiguous, duplicate and changed-source cases to
// moneyRegistry.test.ts. The integrity test refuses an entry without them.

export type MoneySemantics = "invoice" | "receipt" | "statement";

export type SenderMatch =
  | { address: string }
  /** The exact domain (never a subdomain or a lookalike), optionally narrowed to local parts the sender really uses. */
  | { domain: string; local?: RegExp };

export interface MoneyTemplate {
  id: string;
  version: number;
  /** Who sends it. */
  sender: SenderMatch;
  /** Which connected mailbox it may arrive in. v1: any of Dave's accounts. */
  accounts: "any";
  /** The whole subject, anchored at both ends. Named groups `issuer` and `ref` are read out with their offsets. */
  subject: RegExp;
  semantics: MoneySemantics;
  /** Who the money is with when the subject does not name it. */
  issuer: string;
  fixtures: {
    /** Subjects that must match, in the sender's real format, with made-up values. */
    positive: string[];
    /** Subjects the same sender really sends that are NOT bills or receipts (marketing, alerts, notices). */
    negative: string[];
  };
}

/** What a match says, and where in the source it says it (spec 5.2: output schema and source offsets). */
export interface MoneyMatch {
  template_id: string;
  version: number;
  semantics: MoneySemantics;
  issuer: string;
  reference: string | null;
  /** Offsets into the subject exactly as received. */
  offsets: { subject: [number, number]; issuer?: [number, number]; reference?: [number, number] };
}

export type MoneyResult = { kind: "match"; match: MoneyMatch } | { kind: "ambiguous"; template_ids: string[] } | { kind: "none" };

/** The required source fields: without both, nothing matches. */
export const MONEY_REQUIRED_FIELDS = ["from_address", "subject"] as const;

export const MONEY_TEMPLATES: readonly MoneyTemplate[] = [
  {
    id: "coned.bill", version: 1, sender: { address: "noreply@billing.coned.com" }, accounts: "any",
    subject: /^\s*Your Con Edison Bill Is (?:Due|Ready)\s*$/i, semantics: "invoice", issuer: "Con Edison",
    fixtures: { positive: ["Your Con Edison Bill Is Due", "Your Con Edison Bill Is Ready"], negative: ["Save energy this summer with Con Edison", "Your Con Edison Bill Is Due Soon? Try Paperless"] },
  },
  {
    id: "apple.receipt", version: 1, sender: { address: "no_reply@email.apple.com" }, accounts: "any",
    subject: /^\s*Your receipt from Apple\.?\s*$/i, semantics: "receipt", issuer: "Apple",
    fixtures: { positive: ["Your receipt from Apple.", "Your receipt from Apple"], negative: ["Your Subscription Price Increase", "Your Subscription is Confirmed", "Your Subscription is Expiring"] },
  },
  {
    id: "chase.statement", version: 1, sender: { address: "no.reply.alerts@chase.com" }, accounts: "any",
    subject: /^\s*Your latest statement is now available\s*$/i, semantics: "statement", issuer: "Chase",
    fixtures: { positive: ["Your latest statement is now available"], negative: ["You updated your digital wallet", "You added or edited Pat Example as a Zelle recipient", "Chase security alert: You signed in with a new device", "You received money with Zelle®"] },
  },
  {
    id: "wellsfargo.statement", version: 1, sender: { address: "alerts@notify.wellsfargo.com" }, accounts: "any",
    subject: /^\s*Your statement for (?:credit card )?account (?<ref>\.\.\.\d{4})\s*$/i, semantics: "statement", issuer: "Wells Fargo",
    fixtures: { positive: ["Your statement for account ...1234", "Your statement for credit card account ...5678"], negative: ["Your account update is here", "Your new FICO® Score is ready", "Your balance is at or below zero", "You received money with Zelle"] },
  },
  {
    id: "zoom.payment", version: 1, sender: { address: "billing@zoom.us" }, accounts: "any",
    subject: /^\s*Payment Processed for (?<ref>\d{6,})\s*$/i, semantics: "receipt", issuer: "Zoom",
    fixtures: { positive: ["Payment Processed for 1234567890"], negative: ["Update Your Card Now", "Welcome to Zoom!", "Important Update: Changes to Zoom Scheduler Basic"] },
  },
  {
    id: "ally.statement", version: 1, sender: { address: "email@alert.ally.com" }, accounts: "any",
    subject: /^\s*Your Ally billing statement is available\s*$/i, semantics: "statement", issuer: "Ally",
    fixtures: { positive: ["Your Ally billing statement is available"], negative: ["Reminder: 1/15/2027 is your scheduled payment date", "We've received your vehicle payment."] },
  },
  {
    id: "ally.payment", version: 1, sender: { address: "email@alert.ally.com" }, accounts: "any",
    subject: /^\s*We've received your vehicle payment\.?\s*$/i, semantics: "receipt", issuer: "Ally",
    fixtures: { positive: ["We've received your vehicle payment."], negative: ["Your Ally billing statement is available", "Reminder: 1/15/2027 is your scheduled payment date"] },
  },
  {
    // Stripe sends receipts on behalf of the merchant; the merchant is named in the subject.
    id: "stripe.receipt", version: 1, sender: { domain: "stripe.com", local: /^(?:invoice\+statements|receipts)(?:\+acct_[a-z0-9]+)?$/i }, accounts: "any",
    subject: /^\s*Your (?:receipt from (?<issuer>.+?) (?<ref>#\d{4}-\d{4})|(?<issuer2>.+?) receipt \[(?<ref2>#\d{4}-\d{4})\])\s*$/i, semantics: "receipt", issuer: "Stripe",
    fixtures: { positive: ["Your receipt from Example Hosting Ltd #1234-5678", "Your Sample Foundation receipt [#2345-6789]"], negative: ["Your Stripe account update", "Introducing Link: check out faster", "Your receipt from Example Hosting Ltd"] },
  },
  {
    // Supabase's and Netlify's paid-invoice mail share Stripe's format; each is registered by its own exact address.
    id: "supabase.invoice_paid", version: 1, sender: { address: "invoice+statements@supabase.com" }, accounts: "any",
    subject: /^\s*Payment received for (?<issuer>.+?) invoice \((?<ref>#[A-Z0-9]+-\d+)\)\s*$/i, semantics: "receipt", issuer: "Supabase",
    fixtures: { positive: ["Payment received for Example Data Pte Ltd invoice (#ABCDEF-00012)"], negative: ["Your Supabase project is paused", "Upcoming changes to Supabase pricing"] },
  },
  {
    id: "netlify.invoice_paid", version: 1, sender: { address: "noreply@netlify.com" }, accounts: "any",
    subject: /^\s*Payment received for (?<issuer>.+?) invoice \((?<ref>#[A-Z0-9]+-\d+)\)\s*$/i, semantics: "receipt", issuer: "Netlify",
    fixtures: { positive: ["Payment received for Netlify, Inc. invoice (#QWERTY-00034)"], negative: ["Deploy failed for example-site", "Your site is approaching its bandwidth limit"] },
  },
  {
    id: "square.invoice", version: 1, sender: { address: "messenger@messaging.squareup.com" }, accounts: "any",
    subject: /^\s*You (?:received a new invoice|have an invoice waiting) \((?<ref>#[0-9A-Z-]+)\)\s*$/i, semantics: "invoice", issuer: "Square",
    fixtures: { positive: ["You received a new invoice (#000123-R-0001)", "You have an invoice waiting (#000123-R-0002)"], negative: ["You paid an invoice! (#000123-R-0001)", "Rate your experience with Example Cafe"] },
  },
  {
    id: "square.invoice_paid", version: 1, sender: { address: "messenger@messaging.squareup.com" }, accounts: "any",
    subject: /^\s*You paid an invoice! \((?<ref>#[0-9A-Z-]+)\)\s*$/i, semantics: "receipt", issuer: "Square",
    fixtures: { positive: ["You paid an invoice! (#000123-R-0001)"], negative: ["You received a new invoice (#000123-R-0001)", "Rate your experience with Example Cafe"] },
  },
  {
    id: "tofu.invoice", version: 1, sender: { address: "invoice@tofu.com" }, accounts: "any",
    subject: /^\s*Invoice\s+(?<ref>#\d+) from (?<issuer>.+?)\s*$/i, semantics: "invoice", issuer: "Tofu",
    fixtures: { positive: ["Invoice  #123 from Example Athletics", "Invoice #9 from Sample Studio"], negative: ["Example Athletics sent you a message", "Invoice from Example Athletics"] },
  },
  {
    id: "paypal.invoice", version: 1, sender: { address: "service@paypal.com" }, accounts: "any",
    subject: /^\s*Invoice from (?<issuer>.+?) \((?<ref>[0-9A-Z-]+)\)\s*$/i, semantics: "invoice", issuer: "PayPal",
    fixtures: { positive: ["Invoice from EXAMPLE TRADING INC (0042)"], negative: ["You've got money", "Your PayPal account statement is available online", "Earn rewards with PayPal"] },
  },
  {
    id: "nycfinance.receipt", version: 1, sender: { address: "noreply@finance.nyc.gov" }, accounts: "any",
    subject: /^\s*Payment Receipt (?<ref>#[A-Z]{3}\d+) from NYC CityPay\s*$/i, semantics: "receipt", issuer: "NYC CityPay",
    fixtures: { positive: ["Payment Receipt #CPY000111222 from NYC CityPay"], negative: ["Your NYC CityPay account was updated", "Payment Receipt from NYC CityPay"] },
  },
  {
    id: "usli.payment", version: 1, sender: { address: "no-reply@usli.com" }, accounts: "any",
    subject: /^\s*Payment Confirmation\s*$/i, semantics: "receipt", issuer: "USLI",
    fixtures: { positive: ["Payment Confirmation"], negative: ["Your policy documents are ready", "Payment Confirmation Request"] },
  },
];

function senderMatches(s: SenderMatch, address: string): boolean {
  const a = address.trim().toLowerCase();
  const at = a.lastIndexOf("@");
  if (at <= 0) return false;
  if ("address" in s) return a === s.address;
  const local = a.slice(0, at);
  const domain = a.slice(at + 1);
  return domain === s.domain && (!s.local || s.local.test(local));
}

function withIndices(re: RegExp): RegExp {
  return re.flags.includes("d") ? re : new RegExp(re.source, re.flags + "d");
}

function readMatch(t: MoneyTemplate, subject: string): MoneyMatch | null {
  const m = withIndices(t.subject).exec(subject);
  if (!m) return null;
  const g = m.groups ?? {};
  const gi = (m as RegExpExecArray & { indices?: { groups?: Record<string, [number, number] | undefined> } }).indices?.groups ?? {};
  const issuerKey = g.issuer !== undefined ? "issuer" : g.issuer2 !== undefined ? "issuer2" : null;
  const refKey = g.ref !== undefined ? "ref" : g.ref2 !== undefined ? "ref2" : null;
  const issuer = issuerKey ? g[issuerKey]!.trim() : t.issuer;
  const offsets: MoneyMatch["offsets"] = { subject: [m.index, m.index + m[0].length] };
  if (issuerKey && gi[issuerKey]) offsets.issuer = gi[issuerKey];
  if (refKey && gi[refKey]) offsets.reference = gi[refKey];
  return { template_id: t.id, version: t.version, semantics: t.semantics, issuer: issuer || t.issuer, reference: refKey ? g[refKey]! : null, offsets };
}

/**
 * The registry's answer for one message's list-time facts. More than one entry matching is ambiguous, and ambiguous
 * material is Other (3.2 rule 6), never a guess between them.
 */
export function matchMoney(r: { from_address?: string | null; subject?: string | null }, registry: readonly MoneyTemplate[] = MONEY_TEMPLATES): MoneyResult {
  const from = r.from_address ?? "";
  const subject = r.subject ?? "";
  if (!from.trim() || !subject.trim()) return { kind: "none" };
  const hits: MoneyMatch[] = [];
  for (const t of registry) {
    if (!senderMatches(t.sender, from)) continue;
    const m = readMatch(t, subject);
    if (m) hits.push(m);
  }
  if (hits.length === 1) return { kind: "match", match: hits[0]! };
  if (hits.length > 1) return { kind: "ambiguous", template_ids: hits.map((h) => h.template_id) };
  return { kind: "none" };
}

/** The exact active registry ids (spec: parser capability display lists them). */
export function activeMoneyTemplateIds(registry: readonly MoneyTemplate[] = MONEY_TEMPLATES): string[] {
  return registry.map((t) => `${t.id}@${t.version}`);
}
