import { describe, it, expect } from "vitest";
import { routeFile, parseRouteAnswer, isPdf, DESTINATION_LABEL } from "./route";

// UP-PLAT-08 (2026-09-06), A23. Chat deferred file routing from the day it
// shipped (chat/types.ts's own note), so a photo of a receipt had to be
// carried to the Money page by hand. The deterministic half decides most of
// them for nothing; the vision call is the fallback, not the mechanism.

describe("what the person says decides it", () => {
  it("a receipt is a receipt", () => {
    expect(routeFile({ name: "IMG_4021.jpg", mime: "image/jpeg", text: "here's the receipt from lunch" })?.to).toBe("money");
  });

  it("a season schedule is a schedule", () => {
    expect(routeFile({ name: "IMG_4021.jpg", mime: "image/jpeg", text: "the season schedule" })?.to).toBe("schedule");
  });

  it("a workout is a workout", () => {
    expect(routeFile({ name: "IMG_4021.jpg", mime: "image/jpeg", text: "this week's training program" })?.to).toBe("gym");
  });

  it("their words beat the filename, because only they know what it is for", () => {
    const r = routeFile({ name: "receipt-scan.jpg", mime: "image/jpeg", text: "our fall schedule" });
    expect(r?.to).toBe("schedule");
  });
});

describe("the filename is the second-best signal", () => {
  it("names it when nothing was typed", () => {
    expect(routeFile({ name: "Whole-Foods-receipt.pdf", mime: "application/pdf" })?.to).toBe("money");
    expect(routeFile({ name: "fall-schedule.pdf", mime: "application/pdf" })?.to).toBe("schedule");
    expect(routeFile({ name: "upper-body-workout.png", mime: "image/png" })?.to).toBe("gym");
  });

  it("a PDF with dates in its name reads as a schedule", () => {
    expect(routeFile({ name: "Elite-Squad-Fall-2026.pdf", mime: "application/pdf" })?.to).toBe("schedule");
    expect(routeFile({ name: "Sept-14.pdf", mime: "application/pdf" })?.to).toBe("schedule");
  });

  it("a PDF with nothing to go on stays undecided, rather than guessing", () => {
    expect(routeFile({ name: "document.pdf", mime: "application/pdf" })).toBeNull();
  });

  it("a bare photo stays undecided: that is what the vision call is for", () => {
    expect(routeFile({ name: "IMG_4021.jpg", mime: "image/jpeg" })).toBeNull();
    expect(routeFile({ name: "IMG_4021.jpg", mime: "image/jpeg", text: "look at this" })).toBeNull();
  });

  it("every decision carries the reason the receipt bubble shows", () => {
    const r = routeFile({ name: "x.jpg", mime: "image/jpeg", text: "receipt" })!;
    expect(r.why).toBe("You called it a receipt");
  });
});

describe("the fallback's answer", () => {
  it("reads the one word, in any dressing", () => {
    expect(parseRouteAnswer("money")).toBe("money");
    expect(parseRouteAnswer("Schedule.")).toBe("schedule");
    expect(parseRouteAnswer(" GYM \n")).toBe("gym");
    expect(parseRouteAnswer("note")).toBe("note");
  });

  it("anything else is not an answer, and the caller falls back to a note", () => {
    expect(parseRouteAnswer("I think this might be a receipt?")).toBeNull();
    expect(parseRouteAnswer("")).toBeNull();
    expect(parseRouteAnswer("{}")).toBeNull();
  });
});

describe("the small facts", () => {
  it("knows a PDF by mime or by name", () => {
    expect(isPdf("application/pdf", "x")).toBe(true);
    expect(isPdf("", "season.PDF")).toBe(true);
    expect(isPdf("image/jpeg", "x.jpg")).toBe(false);
  });

  it("names each destination the way the app names it", () => {
    // Title Case: these name places in the app.
    expect(Object.values(DESTINATION_LABEL)).toEqual(["Money", "Schedule", "Gym", "Notes"]);
  });
});
