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
  placeholder: string;
}

export const BRAIN_DOCS: BrainDocMeta[] = [
  { topic: "philosophy", title: "Life Philosophy", placeholder: "Worldview · drives · principles" },
  { topic: "writing", title: "How You Write", placeholder: "Tone · style · words you use and avoid" },
  { topic: "values", title: "Values", placeholder: "What matters · hard lines · what to protect" },
];

export const docMeta = (topic: string): BrainDocMeta | undefined => BRAIN_DOCS.find((d) => d.topic === topic);
