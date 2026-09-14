// JARVIS ON A SELECTION (the writing system, wave 4, 2026-09-14).
//
// Seven things a person can ask of the words they have selected. Each is one
// call, one reply, and the reply is a preview until Apply: nothing is written
// into the document by this file. The prompts ask for the words back in the
// same shape (Markdown where the selection had structure) and for the
// person's meaning kept; Prepare for Claude asks for the five headings the
// brief names and for what is missing to be listed, never invented.

import type { AIService } from "../ai/AIService";
import { JARVIS_VOICE } from "../ai/voice";
import { noDashes } from "../ai/suggestions";

export type AIActionKey = "typos" | "clearer" | "shorten" | "sections" | "checklist" | "claude";

export const AI_ACTIONS: { key: AIActionKey; label: string }[] = [
  { key: "typos", label: "Fix Typos Only" },
  { key: "clearer", label: "Make Clearer" },
  { key: "shorten", label: "Shorten" },
  { key: "sections", label: "Organize Into Sections" },
  { key: "checklist", label: "Turn Into Checklist" },
  { key: "claude", label: "Prepare for Claude" },
];

export function actionLabel(key: AIActionKey): string {
  return AI_ACTIONS.find((a) => a.key === key)?.label ?? "JARVIS";
}

const COMMON = "Reply with the rewritten text only: no preamble, no explanation, no quotation marks around it. Keep the person's meaning, names, numbers and facts exactly. Keep Markdown structure where the text has it (headings, lists, checklists, links). Never add facts that are not in the text.";

export function promptFor(key: AIActionKey, text: string): { system: string; user: string } {
  const task =
    key === "typos" ? "Fix spelling, typos and obvious punctuation slips only. Change nothing else: not the words chosen, not the order, not the tone."
    : key === "clearer" ? "Make this clearer to read. Shorter sentences where a sentence is doing two jobs, plainer words where a word is showy, the same meaning and roughly the same length."
    : key === "shorten" ? "Shorten this to about half its length without losing any fact, name, number or decision in it."
    : key === "sections" ? "Organize this into sections: a short Markdown heading (##) for each topic, the person's own sentences under each, in a sensible order. Add no new sentences."
    : key === "checklist" ? "Turn this into a Markdown checklist: one line per action or item, each starting with \"- [ ] \", the person's own words, nothing added."
    : [
        "Organize this into a brief for Claude, as Markdown with exactly these five headings in this order: ## Objective, ## Current Problems, ## Requested Changes, ## Constraints, ## Acceptance Criteria.",
        "Put the person's own points under the heading they belong to, as short bullets. Where the text says nothing for a heading, write one bullet: \"Not stated\".",
        "Then add a sixth heading, ## Missing Details, listing as bullets what Claude would need to know that the text does not say. Ask, never guess.",
      ].join(" ");
  return { system: JARVIS_VOICE + "\n\n" + COMMON, user: task + "\n\nThe text:\n\n" + text };
}

/** Run one action on a selection. Throws when the reply is empty or the
 *  service refuses, so the caller can say so; never returns a guess. */
export async function runAction(ai: AIService, key: AIActionKey, text: string): Promise<string> {
  const p = promptFor(key, text);
  const out = await ai.complete([{ role: "user", content: p.user }], p.system, { tier: "write", kind: "notes-" + key });
  const clean = noDashes(out).trim().replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/m, "$1").trim();
  if (!clean) throw new Error("JARVIS had nothing to offer");
  return clean;
}

/** The task a selected passage becomes: its first line as the task, the
 *  whole passage as the task's notes. */
export function taskFromPassage(text: string): { title: string; notes: string } {
  const lines = text.split("\n").map((l) => l.replace(/^[-*+]\s+(\[[ xX]\]\s+)?|^\d+[.)]\s+|^#+\s+/, "").trim()).filter(Boolean);
  const first = lines[0] ?? "";
  const title = first.length > 120 ? first.slice(0, 119).trimEnd() + "…" : first;
  return { title: title || "Untitled task", notes: text.trim() };
}
