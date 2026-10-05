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
  /** The empty page's own title, in its own voice (the round 2 review: all three pages said "Nothing Written Yet", so no page had a
   *  voice of its own). Title Case. */
  emptyTitle: string;
  /** The one warm line under the empty title: what writing here does. */
  emptyLine: string;
  /** The page's own tone for its empty-state glyph, the same tone its Brain row wears: the Brain's own purple for all three (they
   *  are what JARVIS knows about him), never brand red, which a glyph that cannot be tapped must not wear. */
  tone: string;
}

export const BRAIN_DOCS: BrainDocMeta[] = [
  { topic: "philosophy", title: "Life Philosophy", placeholder: "Worldview, Drives, and Principles", emptyTitle: "Your Philosophy Starts Here", emptyLine: "How You See Life and Work Shapes How JARVIS Thinks", tone: "cat-fg-purple" },
  { topic: "writing", title: "How You Write", placeholder: "Tone, Style, and Words You Use and Avoid", emptyTitle: "Teach JARVIS Your Voice", emptyLine: "Your Voice, in Your Own Words, Shapes Every Draft", tone: "cat-fg-purple" },
  { topic: "values", title: "Values", placeholder: "What Matters and What to Protect", emptyTitle: "Say What Matters", emptyLine: "What Matters to You Guides What JARVIS Does", tone: "cat-fg-purple" },
];

export const docMeta = (topic: string): BrainDocMeta | undefined => BRAIN_DOCS.find((d) => d.topic === topic);
