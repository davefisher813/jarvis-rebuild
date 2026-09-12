import { describe, it, expect } from "vitest";
import { leadFor, faceSlot, FACE_SLOTS } from "./rowAnatomy";

// EM3 (2026-09-12): the leading column is one decision, tested here, so the
// "machine keeps the rail, person gets a face, rail lights only for a
// deadline" rule cannot drift inside JSX again.

const person = { from: "Wei Chang <wei@bffsa.org>", fromEmail: "wei@bffsa.org", displayName: "Wei Chang" };
const machine = { from: "Railway <no-reply@railway.app>", fromEmail: "no-reply@railway.app", displayName: "Railway" };
const NOW = new Date("2026-09-12T12:00:00");

describe("leadFor", () => {
  it("a person gets a face carrying their initial", () => {
    const l = leadFor(person, NOW);
    expect(l.kind).toBe("avatar");
    if (l.kind === "avatar") expect(l.initial).toBe("W");
  });

  it("a no-reply address is a machine and keeps the rail", () => {
    expect(leadFor(machine, NOW).kind).toBe("rail");
  });

  it("the noise bucket is a machine whatever the address", () => {
    expect(leadFor({ ...person, bucket: "noise" }, NOW).kind).toBe("rail");
  });

  it("the rail lights for a deadline and never for silence", () => {
    const quiet = leadFor(machine, NOW);
    const due = leadFor({ ...machine, by: "tomorrow" }, NOW);
    if (quiet.kind === "rail") expect(quiet.railTone).toBe("default");
    if (due.kind === "rail") expect(due.railTone).toBe("warn");
  });

  it("both shapes carry the same hue for the same sender", () => {
    const a = leadFor(person, NOW);
    const b = leadFor({ ...person, bucket: "noise" }, NOW);
    expect(a.face).toBe(b.face);
  });

  it("an empty name still gets a placeholder initial rather than an empty disc", () => {
    const l = leadFor({ ...person, displayName: "" }, NOW);
    if (l.kind === "avatar") expect(l.initial).toBe("?");
  });
});

describe("faceSlot", () => {
  it("is stable per key and never red", () => {
    expect(faceSlot("wei@bffsa.org")).toBe(faceSlot("wei@bffsa.org"));
    expect(FACE_SLOTS).not.toContain("red");
    for (const k of ["a", "bb", "ccc", "dave@x.com", "no-reply@github.com"]) expect(FACE_SLOTS).toContain(faceSlot(k));
  });
});
