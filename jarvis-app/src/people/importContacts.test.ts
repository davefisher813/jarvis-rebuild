import { describe, it, expect } from "vitest";
import { parseVCard, parseContactsCSV, parseContactsFile, csvMapping } from "./importContacts";

const VCF = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "N:Ridgeley;Mike;;;",
  "FN:Mike Ridgeley",
  "TEL;TYPE=CELL:+1 555 0100",
  "EMAIL:mike@elitesquad.org",
  "BDAY:1985-04-20",
  "ORG:Elite Squad;",
  "END:VCARD",
  "BEGIN:VCARD",
  "FN;CHARSET=UTF-8:Sarah Lee",
  "BDAY:19900101",
  "END:VCARD",
].join("\r\n");

describe("parseVCard", () => {
  it("parses multiple cards, with every method kept and labelled", () => {
    const c = parseVCard(VCF);
    expect(c).toHaveLength(2);
    // Person pass (2026-08-03): EMAIL/TEL land in real fields, not note lines.
    // People handoff (2026-09-16): and the full labelled lists beside them,
    // with the organization in its own field instead of the notes blob.
    expect(c[0]).toEqual({
      name: "Mike Ridgeley", birthday: "1985-04-20",
      email: "mike@elitesquad.org", emails: [{ value: "mike@elitesquad.org" }],
      phone: "+1 555 0100", phones: [{ value: "+1 555 0100", label: "mobile" }],
      org: "Elite Squad",
    });
    expect(c[1]).toEqual({ name: "Sarah Lee", birthday: "1990-01-01" });
  });

  it("falls back to N when FN is missing and skips nameless cards", () => {
    const c = parseVCard("BEGIN:VCARD\nN:Smith;Jane;;;\nEND:VCARD\nBEGIN:VCARD\nTEL:555\nEND:VCARD");
    expect(c).toEqual([{ name: "Jane Smith" }]);
  });

  it("unfolds continuation lines", () => {
    const c = parseVCard("BEGIN:VCARD\nFN:Jonathan\n Longname\nEND:VCARD");
    expect(c[0]?.name).toBe("JonathanLongname");
  });

  // BRAIN-F-22 (2026-09-05): this asserted the bug. A withheld YEAR is not a
  // withheld birthday: --04-20 is what an iPhone exports for a contact whose
  // birthday has no year, and birthdays.ts has read MM-DD since it shipped,
  // so dropping it lost a real date the app could already use.
  it("keeps a year-withheld birthday as its month and day", () => {
    expect(parseVCard("BEGIN:VCARD\nFN:X Y\nBDAY:--0420\nEND:VCARD")[0]?.birthday).toBe("04-20");
    expect(parseVCard("BEGIN:VCARD\nFN:X Y\nBDAY:--04-20\nEND:VCARD")[0]?.birthday).toBe("04-20");
  });

  it("still drops what it cannot read, rather than guessing", () => {
    expect(parseVCard("BEGIN:VCARD\nFN:X Y\nBDAY:sometime in spring\nEND:VCARD")[0]?.birthday).toBeUndefined();
  });
});

describe("parseContactsCSV", () => {
  // BRAIN-F-22 (2026-09-05): this asserted the bug too. A phone number in a
  // notes blob is not a phone number: the card's Call, Text and Email rows
  // read the real fields, which the vCard parser has written since the person
  // pass and the CSV parser never did.
  it("reads name/birthday/phone columns into the real fields", () => {
    const c = parseContactsCSV("Name,Birthday,Phone\nMike Ridgeley,1985-04-20,555-0100\nSarah Lee,,\n");
    expect(c).toEqual([
      // A bare "Phone" header names the kind, not a label, so the number
      // carries none rather than a made-up one.
      { name: "Mike Ridgeley", birthday: "1985-04-20", phone: "555-0100", phones: [{ value: "555-0100" }] },
      { name: "Sarah Lee" },
    ]);
  });

  it("keeps EVERY numbered column an export carries, not just the first", () => {
    const c = parseContactsCSV([
      "Name,E-mail 1 - Value,E-mail 2 - Value,Phone 1 - Value,Phone 2 - Value,Organization,Notes",
      "Marco Vidal,,marco@club.org,555-0142,555-0199,Cortland Club,Met at the clinic",
    ].join("\n"));
    // People handoff (2026-09-16): the old parser took the first populated
    // column of each kind and dropped the rest on the floor, so a contact
    // with a mobile and a work line silently lost one. An empty column is
    // still skipped -- an export usually carries several, most of them blank.
    expect(c).toEqual([{
      name: "Marco Vidal",
      email: "marco@club.org", emails: [{ value: "marco@club.org" }],
      phone: "555-0142", phones: [{ value: "555-0142" }, { value: "555-0199" }],
      notes: "Cortland Club\nMet at the clinic",
    }]);
  });

  it("labels a column when its header actually says which line it is", () => {
    const c = parseContactsCSV("Name,Mobile Phone,Home Phone\nLinda Fisher,555-0111,555-0122");
    expect(c[0]?.phones).toEqual([
      { value: "555-0111", label: "mobile" },
      { value: "555-0122", label: "home" },
    ]);
  });

  it("builds names from First/Last columns and honors quoted commas", () => {
    const c = parseContactsCSV('First Name,Last Name,Company\nJane,Smith,"Acme, Inc."');
    expect(c).toEqual([{ name: "Jane Smith", notes: "Acme, Inc." }]);
  });

  it("refuses a file with no recognizable name column", () => {
    expect(parseContactsCSV("Foo,Bar\n1,2")).toEqual([]);
  });
});

describe("parseContactsFile", () => {
  it("routes by extension and content", () => {
    expect(parseContactsFile("team.vcf", VCF)).toHaveLength(2);
    expect(parseContactsFile("roster.csv", "Name\nA B")).toHaveLength(1);
    expect(parseContactsFile("weird.txt", VCF)).toHaveLength(2); // content sniff
    expect(parseContactsFile("weird.txt", "hello")).toEqual([]);
  });
});

// THE ACCEPTANCE CHECKS THE HANDOFF NAMES (People handoff, 2026-09-16):
// "A multi-field import retains repeated phone/email fields and preserves
// notes" and "Preserve unknown fields or report them; do not silently
// discard."
describe("a real contact file loses nothing", () => {
  const RICH = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "UID:urn:uuid:9a1f-linda",
    "FN:Linda Fisher",
    "N:Fisher;Linda;;;",
    "TEL;TYPE=CELL:+1 (555) 010-3311",
    "TEL;TYPE=HOME:555-010-9922",
    "TEL;TYPE=WORK,VOICE:555-010-7788",
    "EMAIL;TYPE=HOME:linda@example.com",
    "EMAIL;TYPE=WORK:l.fisher@bridgeclub.org",
    "ORG:Cedar Bridge Club;Board",
    "TITLE:Secretary",
    "URL:https://bridgeclub.org/board",
    "ADR;TYPE=HOME:;;1 Vine St;Cedar;OH;44121;USA",
    "NOTE:Prefers email for documents.\\nAllergic to shellfish.",
    "X-SOCIALPROFILE;TYPE=linkedin:linda-fisher",
    "BDAY:--04-20",
    "END:VCARD",
  ].join("\r\n");

  it("keeps all three numbers and both addresses, labelled", () => {
    const c = parseVCard(RICH)[0]!;
    expect(c.phones).toEqual([
      { value: "+1 (555) 010-3311", label: "mobile" },
      { value: "555-010-9922", label: "home" },
      { value: "555-010-7788", label: "work" },
    ]);
    expect(c.emails).toEqual([
      { value: "linda@example.com", label: "home" },
      { value: "l.fisher@bridgeclub.org", label: "work" },
    ]);
    // The primary is the first of each, which is the field the rest of the
    // app already reads.
    expect(c.phone).toBe("+1 (555) 010-3311");
    expect(c.email).toBe("linda@example.com");
  });

  // This is the bug Dave photographed, at its source: a number that ended up
  // in the notes blob because there was nowhere else for it to go.
  it("puts no phone number in the notes", () => {
    const c = parseVCard(RICH)[0]!;
    expect(c.notes).toBe("Prefers email for documents.\nAllergic to shellfish.");
    expect(c.notes).not.toMatch(/555/);
  });

  it("keeps the organization, title, url, address and source id", () => {
    const c = parseVCard(RICH)[0]!;
    expect(c.org).toBe("Cedar Bridge Club · Board");
    expect(c.title).toBe("Secretary");
    expect(c.urls).toEqual(["https://bridgeclub.org/board"]);
    expect(c.addresses).toEqual(["1 Vine St, Cedar, OH 44121, USA"]);
    // The stable id a reimport matches on, so it never rests on a name.
    expect(c.uid).toBe("urn:uuid:9a1f-linda");
    expect(c.birthday).toBe("04-20");
  });

  it("reports what it did not understand instead of dropping it", () => {
    const c = parseVCard(RICH)[0]!;
    expect(c.unknown).toEqual(["X-SOCIALPROFILE: linda-fisher"]);
  });

  it("says nothing about a card that had nothing unusual in it", () => {
    expect(parseVCard("BEGIN:VCARD\nFN:Plain Person\nEND:VCARD")[0]?.unknown).toBeUndefined();
  });
});

describe("the CSV mapping a file can be shown before anything is created", () => {
  it("reports each column and what it was read as", () => {
    const m = csvMapping("Name,Mobile Phone,Notes\nA,1,2")!;
    expect(m.headers).toEqual(["Name", "Mobile Phone", "Notes"]);
    expect(m.field).toEqual({ 0: "name", 1: "phone", 2: "note" });
  });

  it("leaves a column it does not recognize unmapped rather than guessing", () => {
    const m = csvMapping("Handle,Vibe\n@a,good")!;
    expect(m.field).toEqual({});
  });

  // A file this parser cannot read on its own is no longer a dead end: the
  // user says which column is which and the same parser runs.
  it("parses a file with unrecognizable headers once the user maps it", () => {
    const text = "Handle,Digits\nLinda Fisher,555-0111";
    expect(parseContactsCSV(text)).toEqual([]);
    expect(parseContactsCSV(text, { 0: "name", 1: "phone" })).toEqual([
      { name: "Linda Fisher", phone: "555-0111", phones: [{ value: "555-0111" }] },
    ]);
  });
});
