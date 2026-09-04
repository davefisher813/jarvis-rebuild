// The scripted intake. Each convo step is one JARVIS turn; the engine in
// OnboardingFlow walks them, accumulating the transcript. AI can make this
// dynamic later without changing the engine shape.
export type StepKind = "intro" | "text" | "choice" | "categories" | "people" | "seeds" | "connect" | "time" | "done";

export interface Choice { label: string; value: string }
export interface OnbStep {
  id: string;
  kind: StepKind;
  prompt?: string;
  key?: "name" | "template" | "briefTime" | "priority" | "workStyle" | "aiChoice";
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
  {
    id: "workstyle",
    kind: "choice",
    prompt: "When do you usually work? I\u2019ll plan your days around it.",
    key: "workStyle",
    options: [
      { label: "9 to 5", value: "9-5" },
      { label: "Early bird", value: "early" },
      { label: "Night owl", value: "late" },
      { label: "It varies", value: "varies" },
    ],
  },
  // ONBOARDING SEEDS (handoff item 4, Dave's option A). Placed here, not
  // immediately after the template pick: by now the areas have visibly
  // assembled themselves around their answer and they have named the thing on
  // their plate, so a short block of questions about how they work reads as
  // JARVIS paying attention rather than as more forms before any payoff. It
  // is still one turn of the same conversation, and one tap skips all five.
  // The questions themselves are template-specific; see seeds.ts.
  { id: "seeds", kind: "seeds", prompt: "A few quick ones, so I am not starting from nothing. Skip any, or skip all of them." },
  {
    id: "aichoice",
    kind: "choice",
    // Item 22, Dave's decision: one screen, two options, NO preselection, no
    // badges. Off and On Request live in Settings only; Skip lands on Draft
    // Only. Onboarding is the one conversational surface, so the prompt may
    // talk. Sending always needs the user's tap, at every level.
    prompt: "How much should I do on my own? Everything means I act on reversible things and always show a receipt with undo. Draft Only means I prepare and wait for you. Sending anything always needs your tap. You can change this anytime in Settings.",
    key: "aiChoice",
    options: [
      { label: "Everything", value: "everything" },
      { label: "Draft Only", value: "draft" },
    ],
  },
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
