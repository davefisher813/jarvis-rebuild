import type { Store, ItemData } from "@core";
import type { EventInput } from "../../events";
import {
  ENTITY_STRAND, STRAND_CAP_TOTAL, STRAND_CAP_PER_CATEGORY, EVIDENCE_CAP,
  type Strand, type StrandData, type StrandCategory, type StrandEvidence, type DerivationKey,
} from "./types";

// The strand store (Brain Layer 2). Every mutation that says something about
// a derivation's accuracy also emits an event, because the nod test is
// operational here, not a slogan: correction and deletion rates PER DERIVATION
// are what decide whether a derivation keeps speaking (see moments.ts).
//
// Emission map:
//   accept (create watched)  -> strand.created   kind = derivation
//   edit a watched strand    -> strand.corrected kind = derivation (the text
//                               was not right as written; that is a correction
//                               even though the fact survives, and the edit
//                               promotes source to told, which is earned)
//   delete a watched strand  -> strand.deleted   kind = derivation
// Typed strands (told) emit created without a kind; their edits are not
// corrections of any derivation.

export class StrandsService {
  constructor(private store: Store, private ownerId: string, private emit?: (e: EventInput) => void) {}

  async list(): Promise<Strand[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_STRAND);
    return items
      .map((i) => ({ id: i.id, data: i.data as unknown as StrandData }))
      .sort((a, b) => b.data.createdAt.localeCompare(a.data.createdAt));
  }

  async active(): Promise<Strand[]> {
    return (await this.list()).filter((s) => s.data.status === "active");
  }

  // One strand per derivation, ever: a re-derivation refreshes the existing
  // strand's evidence instead of growing a twin.
  async byDerivation(key: DerivationKey): Promise<Strand | null> {
    return (await this.list()).find((s) => s.data.derivation === key) ?? null;
  }

  // A being-known moment was accepted: the fact becomes a watched strand with
  // its receipts. Caps enforced here; a full genome refuses quietly (null)
  // rather than growing into the fifty-maybes failure mode.
  async accept(
    text: string,
    category: StrandCategory,
    derivation: DerivationKey,
    evidence: StrandEvidence[],
    today: string,
  ): Promise<string | null> {
    const all = await this.list();
    if (all.length >= STRAND_CAP_TOTAL) return null;
    if (all.filter((s) => s.data.category === category).length >= STRAND_CAP_PER_CATEGORY) return null;
    if (all.some((s) => s.data.derivation === derivation)) return null;
    const data: StrandData = {
      text: text.trim(),
      category,
      source: "watched",
      strength: "influence",
      status: "active",
      createdAt: today,
      lastConfirmed: today,
      derivation,
      evidence: evidence.slice(0, EVIDENCE_CAP),
    };
    const id = await this.store.create(this.ownerId, ENTITY_STRAND, data as unknown as ItemData);
    this.emit?.({ type: "strand.created", entityType: ENTITY_STRAND, entityId: id, props: { kind: derivation, category } });
    return id;
  }

  // The user typed one sentence themselves: source told, the highest rank,
  // because it was deliberate. strength stays influence unless they made it
  // a rule on purpose.
  async add(text: string, category: StrandCategory, today: string, strength: "influence" | "rule" = "influence"): Promise<string | null> {
    const t = text.trim();
    if (!t) return null;
    const all = await this.list();
    if (all.length >= STRAND_CAP_TOTAL) return null;
    if (all.filter((s) => s.data.category === category).length >= STRAND_CAP_PER_CATEGORY) return null;
    const data: StrandData = {
      text: t, category, source: "told", strength, status: "active",
      createdAt: today, lastConfirmed: today,
    };
    const id = await this.store.create(this.ownerId, ENTITY_STRAND, data as unknown as ItemData);
    this.emit?.({ type: "strand.created", entityType: ENTITY_STRAND, entityId: id, props: { category } });
    return id;
  }

  // Editing the words of a watched strand is a correction of its derivation
  // (the sentence was not one the user would nod at as written), and the
  // corrected text is EARNED told-rank from then on.
  async edit(s: Strand, text: string, today: string): Promise<void> {
    const t = text.trim();
    if (!t || t === s.data.text) return;
    if (s.data.derivation) {
      this.emit?.({ type: "strand.corrected", entityType: ENTITY_STRAND, entityId: s.id, props: { kind: s.data.derivation } });
    }
    await this.store.update(this.ownerId, s.id, { text: t, source: "told", lastConfirmed: today } as unknown as ItemData);
  }

  async setStatus(s: Strand, status: "active" | "paused"): Promise<void> {
    await this.store.update(this.ownerId, s.id, { status } as unknown as ItemData);
  }

  async confirm(s: Strand, today: string): Promise<void> {
    await this.store.update(this.ownerId, s.id, { lastConfirmed: today } as unknown as ItemData);
  }

  // Refresh a watched strand's receipts on re-derivation, quietly.
  async refreshEvidence(s: Strand, evidence: StrandEvidence[], today: string): Promise<void> {
    await this.store.update(this.ownerId, s.id, { evidence: evidence.slice(0, EVIDENCE_CAP), lastConfirmed: today } as unknown as ItemData);
  }

  async remove(s: Strand): Promise<void> {
    if (s.data.derivation) {
      this.emit?.({ type: "strand.deleted", entityType: ENTITY_STRAND, entityId: s.id, props: { kind: s.data.derivation } });
    }
    await this.store.delete(this.ownerId, s.id);
  }
}
