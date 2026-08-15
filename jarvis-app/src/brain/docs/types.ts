export const ENTITY_BRAIN_DOC = "brain_doc";

// One free-text Brain document per topic per user. These feed the AI: your
// philosophy, your writing voice, and your values shape how JARVIS speaks/acts.
export interface BrainDocData {
  topic: string;
  text: string;
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
