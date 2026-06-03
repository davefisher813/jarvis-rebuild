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
  { topic: "philosophy", title: "Life Philosophy", placeholder: "How you see the world, what drives you, the principles you live by." },
  { topic: "writing", title: "How You Write", placeholder: "Your tone and style. Formal or casual? Short or detailed? Words you use, words you avoid." },
  { topic: "values", title: "Values", placeholder: "What matters most. The lines you won't cross. What JARVIS should always protect." },
];

export const docMeta = (topic: string): BrainDocMeta | undefined => BRAIN_DOCS.find((d) => d.topic === topic);
