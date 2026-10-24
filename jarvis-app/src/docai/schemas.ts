import type { DocKind } from "./types";

// WHAT THE MODEL IS ASKED, AND WHAT SHAPE IT MUST ANSWER IN. Every field comes back as an envelope (value, verbatim quote, page, basis)
// through the existing forced-tool channel (src/ai/structured.ts). Everything is optional: an empty result is a success, and the
// prompt says so, because a model that must find something will find something. Abstention is measured, never punished.

/** The fields each kind may carry. A key outside the list is refused by the schema, so the model cannot invent a field. */
export const KIND_FIELDS: Record<DocKind, { group: string; keys: string[] }> = {
  bill: { group: "bill", keys: ["payee", "amount", "dueDate", "statementDate", "accountRef", "recurrence", "minimumDue", "lineAmount"] },
  schedule: { group: "event", keys: ["title", "date", "startTime", "endTime", "location"] },
  general: { group: "item", keys: ["what", "date", "amount", "person", "ask"] },
  // Phase 2 kinds; they classify, then read as general until their own schemas land.
  "task-list": { group: "task", keys: ["what", "date", "person"] },
  letter: { group: "item", keys: ["what", "date", "amount", "person", "ask"] },
  receipt: { group: "receipt", keys: ["payee", "amount", "date", "lineAmount"] },
};

/** The kinds this build extracts with their own schema. Anything else is extracted as general. */
export const EXTRACTED_KINDS: readonly DocKind[] = ["bill", "schedule", "general"];

export const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["bill", "schedule", "task-list", "letter", "receipt", "general"] },
    actionable: { type: "boolean", description: "True only if there is something the reader may want to do: pay, attend, reply, remember." },
    title: { type: "string", description: "A short plain name for the document, from its own words." },
  },
  required: ["kind", "actionable"],
} as const;

export function extractSchema(kind: DocKind): Record<string, unknown> {
  const spec = KIND_FIELDS[kind];
  return {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            group: { type: "string", enum: [spec.group] },
            fields: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  key: { type: "string", enum: spec.keys },
                  value: { type: "string" },
                  quote: { type: "string", description: "The exact words from the document this value comes from, copied character for character." },
                  page: { type: "integer" },
                  basis: { type: "string", enum: ["stated", "computed", "inferred"] },
                },
                required: ["key", "value", "quote", "page", "basis"],
              },
            },
          },
          required: ["group", "fields"],
        },
      },
    },
    required: ["items"],
  };
}

const RULES = [
  "Use only what the document says. Copy the quote exactly, character for character, from the document text.",
  "Every value must appear inside its own quote. If you cannot quote it, leave it out.",
  "Amounts are written as plain numbers like 1234.50. Dates are YYYY-MM-DD. Times are 24-hour HH:MM.",
  "Basis is stated when the document says it in so many words, computed when you worked it out, inferred when you are guessing. Never guess an amount, a date or a time.",
  "Do not work out relative dates (\"within 30 days\", \"next Friday\"): leave them out.",
  "Never read a form's caption (\"Amount Due\", \"Date\") as an answer.",
  "If nothing here is worth acting on, return an empty items list. That is a correct answer.",
];

export const CLASSIFY_SYSTEM = "You read the start of a document and say what kind it is. " + RULES[6] + " Answer only through the tool.";

export function extractSystem(kind: DocKind): string {
  const spec = KIND_FIELDS[kind];
  const what: Record<string, string> = {
    bill: "This is a bill or statement. Return ONE item with the payee, the total amount due, the due date and, when written, the statement date, an account reference, how often it recurs, the minimum due, and each line amount.",
    schedule: "This is a schedule. Return one item per event, with its title, date, start and end time, and location when written.",
    general: "Return one item for each date, amount, person or request that someone may need to act on, using the fields what, date, amount, person, ask.",
  };
  return [
    `You extract facts from a document for a person who will check every one. Fields allowed: ${spec.keys.join(", ")}.`,
    what[kind] ?? what.general!,
    ...RULES.slice(0, 6),
    RULES[6]!,
    "Answer only through the tool.",
  ].join(" ");
}

/** Pages are marked so the model can name one; the marker is NOT part of the document text and is never quoted. */
export function sliceUser(pages: { page: number; text: string }[]): string {
  return pages.map((p) => `[Page ${p.page}]\n${p.text}`).join("\n\n");
}
