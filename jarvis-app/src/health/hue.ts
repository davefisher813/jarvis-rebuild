// HUE BY MEANING (Health R4 / H-04, Dave's picks 2026-09-12; Build Master
// section 3). The one place the activity ramp is assigned.
//
// Before this, the log grid handed every tile a hue BY ITS POSITION -- first
// tile lime, second cyan, and so on round the ramp. That was stable, which
// was the whole argument for it, but it was stable the way a seating chart
// is: add a shortcut above a tile and the tile changes colour, and two
// readings with nothing in common wear the same hue because they happen to be
// neighbours. A colour that moves is not carrying meaning, it is decoration
// with a rule attached.
//
// So a surface asks what a thing MEANS and gets its hue:
//   lime    logged work, sets, PRs, done
//   cyan    the rest timer, the current set, readings and reference values
//   amber   time, duration, load, plates
//   violet  sleep and bedtime
//   hblue   medication
//   pink    discomfort
//
// "hblue" rather than "blue" is deliberate and is the harness's own name: the
// app has an accent blue already, and in Health blue means medication and
// nothing else. The names resolve to a --h-hue / --h-tint pair through the
// [data-hue] block in styles/components.css; nothing here knows a hex.
//
// PRIVACY NOTE: this file maps a KIND to a colour. It never sees a value, a
// name, an amount or a timestamp, and it draws no conclusion about any of
// them -- a hue says what a tile measures, never how the person is doing.

import type { MetricDef } from "../gym/metrics";

export type HueName = "lime" | "cyan" | "amber" | "violet" | "hblue" | "pink";

/** What a health surface can be showing. One entry per meaning, not per
 *  screen: two screens showing the same kind of thing get the same hue. */
export type HueKind =
  | "sets"
  | "pr"
  | "rest"
  | "reading"
  | "time"
  | "load"
  | "sleep"
  | "medication"
  | "discomfort"
  | "water";

const BY_KIND: Record<HueKind, HueName> = {
  sets: "lime",
  pr: "lime",
  rest: "cyan",
  reading: "cyan",
  time: "amber",
  load: "amber",
  sleep: "violet",
  medication: "hblue",
  discomfort: "pink",
  // Water is a count of a thing done, so it reads as a reading rather than as
  // logged work: it is the number itself a person is looking at, not proof
  // that a session happened.
  water: "cyan",
};

/** The hue for a kind of thing. Total over HueKind, so a new kind is a
 *  compile error here rather than a silently grey tile. */
export function hueFor(kind: HueKind): HueName {
  return BY_KIND[kind];
}

/** The hue for one of the athlete's own metrics. A metric is a reading unless
 *  he has said otherwise, so cyan is the default and `hue` on the definition
 *  is his override -- the same shape as every other user-chosen field on a
 *  MetricDef, and the reason MetricDef.hue is optional rather than seeded. */
export function hueForMetric(def: MetricDef): HueName {
  return def.data.hue ?? hueFor("reading");
}
