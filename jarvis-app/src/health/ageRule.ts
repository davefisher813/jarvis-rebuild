// THE AGE RULE (catalog Part 2, "build carefully"). Once per season, states
// hours/week vs age in years, months in-season, days off -- paired with an
// offer, never a verdict. The catalog is explicit this edges toward advice;
// the mitigation it names is citing the source on the row and never saying
// "too much", both of which this file holds to literally: every string this
// module returns states a number and names NATA, and none of them contains
// a verdict word.
//
// The once-per-season gate itself lives in HealthService (wasAgeRuleShown /
// markAgeRuleShown) -- this file is pure formatting over numbers the caller
// already has (ageYears, weeklyHours, monthsInSeason, daysOffPerWeek).

export const NATA_SOURCE = "NATA";

export interface AgeRuleInput {
  ageYears: number;
  weeklyHours: number;
  monthsInSeason: number;
  daysOffPerWeek: number;
}

export interface AgeRuleFact {
  label: string; // what NATA's own guideline says, restated, never authored
  value: string; // the athlete's actual number, plain
  source: string; // always NATA_SOURCE, named on the row per catalog rail 8
}

/** Four restated guideline lines, one per NATA figure the catalog cites:
 *  weekly hours vs age, months in one sport, and rest days a week. Each
 *  line states A NUMBER; none of them says whether the number is fine. */
export function ageRuleFacts(input: AgeRuleInput): AgeRuleFact[] {
  return [
    {
      label: "Weekly Hours, Against Age In Years",
      value: input.weeklyHours + " Hours A Week At Age " + input.ageYears,
      source: NATA_SOURCE,
    },
    {
      label: "Months In One Sport This Year",
      value: input.monthsInSeason + " Months",
      source: NATA_SOURCE,
    },
    {
      label: "Rest Days A Week",
      value: input.daysOffPerWeek + " Days Off",
      source: NATA_SOURCE,
    },
  ];
}

const VERDICT_WORDS = /\b(too much|overtraining|excessive|dangerous|unsafe)\b/i;

/** Guards the module's own output at the boundary: nothing returned by
 *  ageRuleFacts may ever contain a verdict word. Exported so a caller (and
 *  this file's own test) can check it directly rather than trusting intent. */
export function isVerdictFree(facts: AgeRuleFact[]): boolean {
  return facts.every((f) => !VERDICT_WORDS.test(f.label) && !VERDICT_WORDS.test(f.value));
}
