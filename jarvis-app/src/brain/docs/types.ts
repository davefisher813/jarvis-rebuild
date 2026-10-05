export const ENTITY_BRAIN_DOC = "brain_doc";

// One free-text Brain document per topic per user. These feed the AI: your
// philosophy, your writing voice, and your values shape how JARVIS speaks/acts.
export interface BrainDocData {
  topic: string;
  text: string;
  // UP-MIND-20 (2026-09-05): the Values doc's HARD LINES, structured, edited
  // as chips beside the prose. Values stays free text and stays the user's;
  // this is the part an automatic action can be checked against without a
  // model reading a paragraph. Only ever present on the values topic, and
  // only ever written by the user on their own page. JSONB, so no migration
  // and no second entity, the same way `until` rode on an event.
  hardLines?: import("../hardLines").HardLine[];
}

export interface BrainDocMeta {
  topic: string;
  title: string;
  /** The editor's cue. Title Case, no dots typed into it (Dave 2026-10-05, the review: "Worldview · drives · principles"
   *  was lowercase after every dot, and "what to pro..." was cut off mid-word). */
  placeholder: string;
  /** The one warm line under "Nothing Written Yet": what writing here does. */
  emptyLine: string;
  /** The page's own tone for its empty-state glyph, the same hue its Brain row wears. */
  tone: string;
}

export const BRAIN_DOCS: BrainDocMeta[] = [
  { topic: "philosophy", title: "Life Philosophy", placeholder: "Worldview, Drives, and Principles", emptyLine: "How You See Life and Work Shapes How JARVIS Thinks", tone: "cat-fg-indigo" },
  { topic: "writing", title: "How You Write", placeholder: "Tone, Style, and Words You Use and Avoid", emptyLine: "Your Voice, in Your Own Words, Shapes Every Draft", tone: "cat-fg-pink" },
  { topic: "values", title: "Values", placeholder: "What Matters and What to Protect", emptyLine: "What Matters to You Guides What JARVIS Does", tone: "cat-fg-mint" },
];

export const docMeta = (topic: string): BrainDocMeta | undefined => BRAIN_DOCS.find((d) => d.topic === topic);
