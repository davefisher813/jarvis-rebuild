// OUTREACH TRACKER, THREE WAYS (the 2026-10-13 spec: "grants/sponsors and networking are configurations"; auto-adjust rule 3 names
// "Outreach labels by kind" a flagship adjustment). One template, one page shape. A kind is a set of LABELS for the fields the page
// already has, the words its Status runs through, and a field or two the kind needs (a grant has an amount and a deadline). Keys
// never change, so a page switched from one kind to another keeps every value; only the words on the labels move, and a status
// typed under the old kind is still drawn as typed.

import { type PageData, type PageField, OUTREACH_STATUS } from "./pageModel";

export interface OutreachKind {
  key: string;
  name: string;
  /** Labels by field key. A key not named keeps the label it has. */
  labels: Record<string, string>;
  status: string[];
  /** Fields this kind adds when the page does not have them. Never removed by a later kind. */
  adds: PageField[];
}

export const OUTREACH_KINDS: OutreachKind[] = [
  {
    key: "general", name: "Outreach",
    labels: { who: "Who", org: "Organization", channel: "Channel", status: "Status", last: "Last Contact", next: "Next Step", notes: "Notes" },
    status: OUTREACH_STATUS, adds: [],
  },
  {
    key: "grants", name: "Grants and Sponsors",
    labels: { who: "Contact", org: "Funder or Sponsor", channel: "Channel", status: "Status", last: "Last Contact", next: "Next Step", notes: "Notes" },
    status: ["To Ask", "Asked", "Proposal Sent", "Funded", "Declined"],
    adds: [{ key: "amount", label: "Amount Asked", type: "money" }, { key: "deadline", label: "Deadline", type: "date" }],
  },
  {
    key: "networking", name: "Networking",
    labels: { who: "Who", org: "Where They Work", channel: "How We Met", status: "Status", last: "Last Contact", next: "Next Step", notes: "Notes" },
    status: ["To Reach Out", "Reached Out", "Replied", "Met", "Keep in Touch"], adds: [],
  },
];

export const outreachKindOf = (key: string | undefined): OutreachKind => OUTREACH_KINDS.find((k) => k.key === (key ?? "")) ?? OUTREACH_KINDS[0]!;

/** Every status word a kind offers, so the page knows an app word from one the person typed. */
export const KNOWN_STATUS = new Set(OUTREACH_KINDS.flatMap((k) => k.status));

/** What a status means on the row: waiting on us is amber, a reply or a result is green, a close with nothing more to do is plain. */
export const STATUS_TONE: Record<string, string> = {
  "To Contact": "warn", "Reached Out": "warn", Replied: "good", "Meeting Set": "good", Closed: "good",
  "To Ask": "warn", Asked: "warn", "Proposal Sent": "warn", Funded: "good", Declined: "",
  "To Reach Out": "warn", Met: "good", "Keep in Touch": "good",
};

/** The page's kind: its labels, its status words, its extra fields. Values are untouched. */
export function setOutreachKind(page: PageData, key: string): PageData {
  const kind = outreachKindOf(key);
  let fields: PageField[] = page.fields.map((f) => {
    const label = kind.labels[f.key];
    const next = label ? { ...f, label } : f;
    return f.key === "status" ? { ...next, options: [...kind.status] } : next;
  });
  for (const add of kind.adds) if (!fields.some((f) => f.key === add.key)) fields = [...fields, { ...add }];
  return { ...page, fields, meta: { ...(page.meta ?? {}), kind: kind.key } };
}
