import type { TemplateKey } from "../categories/defaults";
import type { StrandCategory } from "../brain/strands/types";

// ONBOARDING SEEDS (Brain build handoff item 4; approved 2026-08-03 and again
// as decision x4; Dave took option A on 2026-09-04: inside the existing
// conversation, five chip answers, skippable in one tap).
//
// The problem this solves: day one is a blank Brain. Every derivation needs a
// window of real behaviour before it can say anything, so a new user spends
// their first fortnight with a Brain that knows nothing and says nothing,
// which reads as a dead feature rather than a patient one.
//
// THE SOURCE RANK IS THE WHOLE DESIGN. A tapped chip in an intake is a
// half-attention self-report: it is what someone says about themselves before
// the app has ever watched them do anything. So a seed is written with source
// "asked", the LOWEST rank, deliberately below "watched". If the log later
// says the opposite, the log wins and nothing has to be un-taught. That is
// also why StrandsService.seed() exists separately from add(): add() writes
// "told", and told is EARNED (typed, or corrected in the app). Filing a chip
// tap as told would put a guess above evidence for the life of the account.
//
// The sentences are written in the first person, present tense, one line, so
// they read the same as a fact the user typed and the same as one JARVIS
// derived. What JARVIS Knows shows all three side by side; they should not be
// distinguishable by voice, only by their source label.

export interface SeedOption {
  /** The chip. Two or three words. */
  label: string;
  /** The fact it writes, in the user's voice. Never mentions onboarding. */
  text: string;
}

export interface SeedQuestion {
  id: string;
  prompt: string;
  category: StrandCategory;
  options: SeedOption[];
}

// Five per template, and only five: the item's own budget is sixty seconds.
// They are template-specific because "what eats your week" means something
// different to a business owner and to a sixteen-year-old with practice at
// four, and a generic question produces a generic fact that helps nobody.

const PERSONAL: SeedQuestion[] = [
  {
    id: "p-clear", category: "energy",
    prompt: "When is your head clearest?",
    options: [
      { label: "Early morning", text: "My head is clearest early in the morning" },
      { label: "Mid morning", text: "My head is clearest in the middle of the morning" },
      { label: "Afternoon", text: "My head is clearest in the afternoon" },
      { label: "Late at night", text: "My head is clearest late at night" },
    ],
  },
  {
    id: "p-derail", category: "work_style",
    prompt: "What derails a day for you?",
    options: [
      { label: "Meetings I did not expect", text: "Unplanned meetings are what derail my day" },
      { label: "Email", text: "Email is what derails my day" },
      { label: "Other people's emergencies", text: "Other people's emergencies are what derail my day" },
      { label: "Switching between things", text: "Switching between things is what derails my day" },
    ],
  },
  {
    id: "p-nonneg", category: "routine",
    prompt: "What is non-negotiable in your week?",
    options: [
      { label: "Family time", text: "Family time is non-negotiable in my week" },
      { label: "Training", text: "Training is non-negotiable in my week" },
      { label: "One day off", text: "One day off a week is non-negotiable for me" },
      { label: "Nothing yet", text: "" },
    ],
  },
  {
    id: "p-fire", category: "values",
    prompt: "When everything is on fire, what wins?",
    options: [
      { label: "The people involved", text: "When everything is on fire, the people involved come first" },
      { label: "The deadline", text: "When everything is on fire, the deadline comes first" },
      { label: "What I promised", text: "When everything is on fire, I keep whatever I promised first" },
      { label: "Whatever is smallest", text: "When everything is on fire, I do the smallest thing first" },
    ],
  },
  {
    id: "p-told", category: "writing",
    prompt: "How should I tell you things?",
    options: [
      { label: "Direct, no cushioning", text: "I want to be told things directly, with no cushioning" },
      { label: "Warm but brief", text: "I want to be told things warmly but briefly" },
      { label: "With the reasoning", text: "I want the reasoning along with the answer" },
    ],
  },
];

const BUSINESS: SeedQuestion[] = [
  {
    id: "b-clear", category: "energy",
    prompt: "When is your head clearest?",
    options: [
      { label: "Before anyone else is up", text: "My head is clearest before anyone else is up" },
      { label: "Mid morning", text: "My head is clearest in the middle of the morning" },
      { label: "Afternoon", text: "My head is clearest in the afternoon" },
      { label: "After hours", text: "My head is clearest after hours" },
    ],
  },
  {
    id: "b-eats", category: "work_style",
    prompt: "What eats your week?",
    options: [
      { label: "Chasing invoices", text: "Chasing invoices eats the most of my week" },
      { label: "Customer messages", text: "Customer messages eat the most of my week" },
      { label: "Admin and paperwork", text: "Admin and paperwork eat the most of my week" },
      { label: "The actual work", text: "The actual work is where most of my week goes" },
    ],
  },
  {
    id: "b-first", category: "people",
    prompt: "Who do you answer to first?",
    options: [
      { label: "Customers", text: "Customers come first when I have to choose" },
      { label: "My team", text: "My team comes first when I have to choose" },
      { label: "My family", text: "My family comes first when I have to choose" },
      { label: "Just me", text: "I answer to myself first" },
    ],
  },
  {
    id: "b-good", category: "values",
    prompt: "What does a good week look like?",
    options: [
      { label: "Money came in", text: "A good week is one where money came in" },
      { label: "Nothing broke", text: "A good week is one where nothing broke" },
      { label: "I built something", text: "A good week is one where I built something" },
      { label: "I finished early", text: "A good week is one where I finished early" },
    ],
  },
  {
    id: "b-nonneg", category: "routine",
    prompt: "What is non-negotiable in your week?",
    options: [
      { label: "One day off", text: "One day off a week is non-negotiable for me" },
      { label: "Family time", text: "Family time is non-negotiable in my week" },
      { label: "Training", text: "Training is non-negotiable in my week" },
      { label: "Nothing yet", text: "" },
    ],
  },
];

const STUDENT: SeedQuestion[] = [
  {
    id: "s-work", category: "energy",
    prompt: "When do you actually get work done?",
    options: [
      { label: "Before school", text: "I get my work done before school" },
      { label: "Between classes", text: "I get my work done between classes" },
      { label: "Right after practice", text: "I get my work done right after practice" },
      { label: "Late at night", text: "I get my work done late at night" },
    ],
  },
  {
    id: "s-train", category: "routine",
    prompt: "How many days a week do you train?",
    options: [
      { label: "Three or fewer", text: "I train three days a week or fewer" },
      { label: "Four or five", text: "I train four or five days a week" },
      { label: "Six or more", text: "I train six days a week or more" },
      { label: "It changes by season", text: "How much I train changes with the season" },
    ],
  },
  {
    id: "s-slip", category: "work_style",
    prompt: "Why do assignments slip?",
    options: [
      { label: "I forget they exist", text: "Assignments slip because I forget they exist" },
      { label: "I start too late", text: "Assignments slip because I start them too late" },
      { label: "Too big to start", text: "Assignments slip because they feel too big to start" },
      { label: "Practice runs long", text: "Assignments slip because practice runs long" },
    ],
  },
  {
    id: "s-year", category: "values",
    prompt: "What matters most this year?",
    options: [
      { label: "Grades", text: "Grades matter most to me this year" },
      { label: "The sport", text: "The sport matters most to me this year" },
      { label: "Getting recruited", text: "Getting recruited matters most to me this year" },
      { label: "Staying sane", text: "Staying sane matters most to me this year" },
    ],
  },
  {
    id: "s-track", category: "people",
    prompt: "Who keeps you on track?",
    options: [
      { label: "A parent", text: "A parent is who keeps me on track" },
      { label: "A coach", text: "A coach is who keeps me on track" },
      { label: "A teammate", text: "A teammate is who keeps me on track" },
      { label: "Myself", text: "I keep myself on track" },
    ],
  },
];

const BY_TEMPLATE: Record<TemplateKey, SeedQuestion[]> = {
  personal: PERSONAL,
  business: BUSINESS,
  student: STUDENT,
};

export function seedQuestions(t: TemplateKey): SeedQuestion[] {
  return BY_TEMPLATE[t] ?? PERSONAL;
}

/**
 * The facts a set of answers writes.
 *
 * `picked` maps a question id to the index of the chosen option. An option
 * whose text is empty (the "Nothing yet" escape) writes NOTHING: it is a real
 * answer to the question and it is not a fact about the person, and inventing
 * "nothing is non-negotiable for me" from it would put a sentence in the
 * Brain that the user never agreed to.
 */
export function factsFrom(t: TemplateKey, picked: Record<string, number>): { text: string; category: StrandCategory }[] {
  const out: { text: string; category: StrandCategory }[] = [];
  for (const q of seedQuestions(t)) {
    const i = picked[q.id];
    if (i == null) continue;
    const o = q.options[i];
    if (!o || !o.text) continue;
    out.push({ text: o.text, category: q.category });
  }
  return out;
}
