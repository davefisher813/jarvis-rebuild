import { describe, it, expect } from "vitest";
import { parseVCard, parseContactsCSV, parseContactsFile } from "./importContacts";

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
  it("parses multiple cards with name, birthday, and extras in notes", () => {
    const c = parseVCard(VCF);
    expect(c).toHaveLength(2);
    // Person pass (2026-08-03): EMAIL/TEL land in real fields, not note lines.
    expect(c[0]).toEqual({ name: "Mike Ridgeley", birthday: "1985-04-20", email: "mike@elitesquad.org", phone: "+1 555 0100", notes: "Elite Squad" });
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
      { name: "Mike Ridgeley", birthday: "1985-04-20", phone: "555-0100" },
      { name: "Sarah Lee" },
    ]);
  });

  it("takes email and phone from an export's numbered columns, notes keep the rest", () => {
    const c = parseContactsCSV([
      "Name,E-mail 1 - Value,E-mail 2 - Value,Phone 1 - Value,Organization,Notes",
      "Marco Vidal,,marco@club.org,555-0142,Cortland Club,Met at the clinic",
    ].join("\n"));
    expect(c).toEqual([{
      name: "Marco Vidal", email: "marco@club.org", phone: "555-0142",
      notes: "Cortland Club\nMet at the clinic",
    }]);
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
