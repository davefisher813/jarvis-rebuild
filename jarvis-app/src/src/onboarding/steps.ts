// The scripted intake. Each convo step is one JARVIS turn; the engine in
// OnboardingFlow walks them, accumulating the transcript. AI can make this
// dynamic later without changing the engine shape.
export type StepKind = "intro" | "text" | "choice" | "categories" | "people" | "connect" | "time" | "done";

export interface Choice { label: string; value: string }
export interface OnbStep {
  id: string;
  kind: StepKind;
  prompt?: string;
  key?: "name" | "template" | "briefTime" | "priority";
  placeholder?: string;
  options?: Choice[];
}

export const STEPS: OnbStep[] = [
  { id: "intro", kind: "intro" },
  { id: "name", kind: "text", prompt: "Hi, I\u2019m JARVIS. What should I call you?", key: "name", placeholder: "Your name" },
  {
    id: "template",
    kind: "choice",
    prompt: "How will you use JARVIS?",
    key: "template",
    options: [
      { label: "Personal", value: "personal" },
      { label: "Business", value: "business" },
      { label: "Student", value: "student" },
    ],
  },
  { id: "categories", kind: "categories", prompt: "Here are the life areas I\u2019ll track. Remove any that don\u2019t fit, or add your own." },
  { id: "people", kind: "people", prompt: "Who are the most important people in your world? I\u2019ll keep them close.", placeholder: "Add a person" },
  { id: "priority", kind: "text", prompt: "What is the most important thing on your plate right now?", key: "priority", placeholder: "Your top focus" },
  { id: "connect", kind: "connect", prompt: "Gmail and Google Calendar work in JARVIS. You can connect them now or later." },
  {
    id: "time",
    kind: "time",
    prompt: "When should I send your morning brief?",
    key: "briefTime",
    options: [
      { label: "6:00 AM", value: "06:00" },
      { label: "7:00 AM", value: "07:00" },
      { label: "8:00 AM", value: "08:00" },
    ],
  },
  { id: "done", kind: "done", prompt: "You\u2019re all set. I\u2019ll take it from here." },
];
