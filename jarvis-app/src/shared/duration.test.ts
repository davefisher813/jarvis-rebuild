import { describe, it, expect } from "vitest";
import { aboutLabel, clockLabel, hoursLabel, minutesLabel, secondsLabel, spanLabel } from "./duration";
import { lineCase } from "./casing";

// Dave 2026-09-26 (the pass-off, second round): "45 Min" spelled and
// capitalized for minutes-only, "+30 Sec"; hours use the compact clock
// "1h 30m"; running clocks m:ss, h:mm:ss past an hour.
describe("the one duration formatter", () => {
  it("spells a count of minutes, capitalized, never fused", () => {
    expect(minutesLabel(45)).toBe("45 Min");
    expect(minutesLabel(1)).toBe("1 Min");
    expect(minutesLabel(0)).toBe("0 Min");
    expect(minutesLabel(90)).toBe("90 Min");
    expect(minutesLabel(4.6)).toBe("5 Min");
    expect(minutesLabel(-3)).toBe("0 Min");
  });

  it("a span is minutes under an hour and the compact clock from an hour up", () => {
    expect(spanLabel(0)).toBe("0 Min");
    expect(spanLabel(45)).toBe("45 Min");
    expect(spanLabel(59)).toBe("59 Min");
    expect(spanLabel(60)).toBe("1h");
    expect(spanLabel(90)).toBe("1h 30m");
    expect(spanLabel(120)).toBe("2h");
    expect(spanLabel(200)).toBe("3h 20m");
    expect(spanLabel(1110)).toBe("18h 30m");
    expect(spanLabel(-10)).toBe("0 Min");
    expect(spanLabel(Number.NaN)).toBe("0 Min");
  });

  it("decimal hours read as a span", () => {
    expect(hoursLabel(7.4)).toBe("7h 24m");
    expect(hoursLabel(8)).toBe("8h");
    expect(hoursLabel(0.5)).toBe("30 Min");
  });

  it("seconds are spelled, and signed on request", () => {
    expect(secondsLabel(30)).toBe("30 Sec");
    expect(secondsLabel(90)).toBe("90 Sec");
    expect(secondsLabel(30, { signed: true })).toBe("+30 Sec");
    expect(secondsLabel(-15, { signed: true })).toBe("-15 Sec");
    expect(secondsLabel(-15)).toBe("15 Sec");
  });

  it("a running clock is m:ss, and h:mm:ss once it passes an hour", () => {
    expect(clockLabel(462)).toBe("7:42");
    expect(clockLabel(7)).toBe("0:07");
    expect(clockLabel(720)).toBe("12:00");
    expect(clockLabel(3599)).toBe("59:59");
    expect(clockLabel(3600)).toBe("1:00:00");
    expect(clockLabel(3605)).toBe("1:00:05");
    expect(clockLabel(5525)).toBe("1:32:05");
    expect(clockLabel(-3)).toBe("0:00");
    expect(clockLabel(59.6)).toBe("1:00");
  });

  it("an estimate says About, never a tilde", () => {
    expect(aboutLabel(8)).toBe("About 8 Min");
    expect(aboutLabel(200)).toBe("About 3h 20m");
  });

  // The compact clock is not a word, so a line built from one and then run
  // through the casing formatter keeps it exactly.
  it("survives lineCase unchanged, so a builder can case the words around it", () => {
    for (const s of [spanLabel(45), spanLabel(90), clockLabel(3605), secondsLabel(30, { signed: true }), aboutLabel(200)]) {
      expect(lineCase(s)).toBe(s);
    }
    expect(lineCase(`${spanLabel(90)} left`)).toBe("1h 30m Left");
    expect(lineCase(`checked ${spanLabel(40)} ago`)).toBe("Checked 40 Min Ago");
  });
});
