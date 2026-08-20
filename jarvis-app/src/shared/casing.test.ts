import { describe, it, expect } from "vitest";
import { capAfterNumber, titleCase } from "./casing";

// Dave 2026-08-20: "If a number leads a line the first letter after should be
// capitalized." He caught it on "14 emails need you".
describe("the number-lead capital", () => {
  it("capitalizes the word behind a leading number", () => {
    expect(capAfterNumber("14 emails need you")).toBe("14 Emails need you");
    expect(capAfterNumber("1 email needs you")).toBe("1 Email needs you");
    expect(capAfterNumber("55 days")).toBe("55 Days");
  });

  it("reads past a small word that joins two numbers: that is one quantity", () => {
    expect(capAfterNumber("2 of 5 done")).toBe("2 of 5 Done");
    expect(capAfterNumber("$500 of $2,000 saved")).toBe("$500 of $2,000 Saved");
  });

  it("but a small word NOT joining two numbers starts the line", () => {
    expect(capAfterNumber("88 at the peak")).toBe("88 At the peak");
    expect(capAfterNumber("3 of the crew")).toBe("3 Of the crew");
  });

  it("applies inside every dot segment, not just the first", () => {
    expect(capAfterNumber("2 events · 3 tasks due")).toBe("2 Events · 3 Tasks due");
    expect(capAfterNumber("55 days · no reply")).toBe("55 Days · no reply");
  });

  it("leaves lines that do not start with a number alone", () => {
    expect(capAfterNumber("Due in 3 days")).toBe("Due in 3 days");
    expect(capAfterNumber("Rent")).toBe("Rent");
  });

  it("never lowercases anything", () => {
    expect(capAfterNumber("3 Tasks Moved to Today")).toBe("3 Tasks Moved to Today");
  });

  it("needs a word to capitalize", () => {
    expect(capAfterNumber("14")).toBe("14");
    expect(capAfterNumber("")).toBe("");
  });
});

describe("titleCase is number-aware", () => {
  it("gives the edge slot to the word behind the number", () => {
    expect(titleCase("14 emails need you")).toBe("14 Emails Need You");
  });
  it("keeps small words down in the middle", () => {
    expect(titleCase("the state of the union")).toBe("The State of the Union");
  });
  it("keeps existing capitals inside a word", () => {
    expect(titleCase("book AA1187 now")).toBe("Book AA1187 Now");
  });
});
