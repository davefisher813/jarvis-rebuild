/** The Health Insights page's "not enough days" foot, as ONE string.
 *
 *  It was JSX text with four interpolations, which React renders as nine text
 *  nodes; a reader that takes each node and trims it (the evening audit's did)
 *  read "Not enough days yet forBodyweightandRDLs (dumbbell),1of10paired
 *  sessions." One string is one text node, so every reader gets the words. */
export function notEnoughDaysLine(n: { def: string; ex: string; p: { paired: number; needed: number } }): string {
  return `Not enough days yet for ${n.def} and ${n.ex}, ${n.p.paired} of ${n.p.needed} paired sessions.`;
}
