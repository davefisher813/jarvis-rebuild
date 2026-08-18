// Demo note seeding (extracted from NotesFlow 2026-08-18). The prose here is
// SIMULATED USER CONTENT for previews and the demo build, not UI copy, which
// is why this file is exempt from the short-copy law.
import type { NotesService } from "../notes/NotesService";
import type { Category } from "../categories/types";
import { showToast } from "../shared/toast";

export async function seedDemoNotes(svc: NotesService, cats: Category[]) {
  const id = (n: string) => cats.find((c) => c.data.name === n)?.id ?? cats[0]?.id ?? "";

  // Demo-only writes, guarded as one action: a failed seed toasts once and
  // leaves whatever landed (the demo reseeds on next empty open anyway).
  try {
    // Rich, real-shaped content (Dave 2026-08-18: previews need substance):
    // headings, prose, lists, and checklists so the writing canvas reads as a
    // document, not a stub.
    const plan = await svc.createNote("Coach Onboarding Plan", id("Work"));
    if (plan) {
      await svc.addBlock(plan, { type: "heading", text: "Why This Matters" });
      await svc.addBlock(plan, { type: "text", text: "BFFSA hands us 60 warm leads on day one. Every coach who finishes onboarding in under ten minutes becomes a referral engine for their whole roster." });
      await svc.addBlock(plan, { type: "heading", text: "The Sequence" });
      await svc.addBlock(plan, { type: "bulleted_list", items: ["Welcome email the moment they sign", "One-tap roster import from the league export", "First win inside five minutes: their schedule, filled"] });
      await svc.addBlock(plan, { type: "heading", text: "Open Questions" });
      await svc.addChecklist(plan, ["Confirm Wei owns the BFFSA intro email", "Price the assistant-coach seat", "Draft the day-30 check-in"]);
    }

    const training = await svc.createNote("Training Plan", id("Health"));
    if (training) {
      await svc.addBlock(training, { type: "text", text: "Base week. Keep everything conversational pace except Thursday." });
      await svc.addBlock(training, { type: "heading", text: "This Week" });
      await svc.addChecklist(training, ["Tuesday tempo run", "Thursday intervals", "Sunday long run"]);
    }

    const home = await svc.createNote("Home Projects", id("Family"));
    if (home) await svc.applyTemplate(home, "todo");

    const outreach = await svc.createNote("Outreach List", id("Friends"));
    if (outreach) await svc.applyTemplate(outreach, "brief");

    await svc.createNote("Standup Notes", id("Work"));
  } catch {
    showToast({ message: "Couldn't save · Check your connection" });
  }
}
