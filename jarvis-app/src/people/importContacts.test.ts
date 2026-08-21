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

  it("drops year-withheld birthdays instead of guessing", () => {
    const c = parseVCard("BEGIN:VCARD\nFN:X Y\nBDAY:--0420\nEND:VCARD");
    expect(c[0]?.birthday).toBeUndefined();
  });
});

describe("parseContactsCSV", () => {
  it("reads name/birthday/phone columns", () => {
    const c = parseContactsCSV("Name,Birthday,Phone\nMike Ridgeley,1985-04-20,555-0100\nSarah Lee,,\n");
    expect(c).toEqual([
      { name: "Mike Ridgeley", birthday: "1985-04-20", notes: "555-0100" },
      { name: "Sarah Lee" },
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
