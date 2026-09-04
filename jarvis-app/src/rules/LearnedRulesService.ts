import type { Store, ItemData } from "@core";
import { ENTITY_LEARNED_RULE, type LearnedRuleData, type RuleKind } from "./types";
import { showToast } from "../shared/toast";

export interface LearnedRule {
  id: string;
  data: LearnedRuleData;
}

// Pending corrections live client-side until they become a rule: one
// correction is an accident, two identical ones are a pattern. Versioned key
// (laws: stored shapes are versioned).
const PENDING_KEY = "jarvis.corrections.v1";

type PendingShape = Record<string, { to: string; evidence: string[] }>;

function readPending(): PendingShape {
  try {
    if (typeof localStorage === "undefined") return {};
    return (JSON.parse(localStorage.getItem(PENDING_KEY) || "{}") as PendingShape) || {};
  } catch {
    return {};
  }
}

function writePending(p: PendingShape): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch { /* a lost pending correction re-observes itself next time */ }
}

// The learned-rules store (Uncertainty Protocol, addendum item 25). See
// types.ts for the doctrine. Consumers call resolve() at decision points;
// a null answer means "no rule, fall back to asking via a bounded chooser
// or an honest refusal", never a guess.
export class LearnedRulesService {
  constructor(private store: Store, private ownerId: string) {}

  async list(): Promise<LearnedRule[]> {
    const items = await this.store.listForUser(this.ownerId, ENTITY_LEARNED_RULE);
    return items
      .map((i) => ({ id: i.id, data: i.data as unknown as LearnedRuleData }))
      .sort((a, b) => b.data.createdAt.localeCompare(a.data.createdAt));
  }

  // The one read consumers use. Exact scope + trigger match; a rule never
  // generalizes past its scope.
  async resolve(scope: string, from: string): Promise<LearnedRule | null> {
    const rules = await this.list();
    return rules.find((r) => r.data.scope === scope && r.data.from === from) ?? null;
  }

  // Record one observed correction. Two identical corrections (same scope,
  // trigger, and resolution) create the rule; a differing correction resets
  // the count, because a wobbling signal is not a pattern. Returns the rule
  // if this correction created it.
  async recordCorrection(kind: RuleKind, scope: string, from: string, to: string, evidenceLine: string): Promise<LearnedRule | null> {
    // A live rule already answers this; a matching correction is nothing
    // new, and a differing one is a contradiction that kills it.
    const existing = await this.resolve(scope, from);
    if (existing) {
      if (existing.data.to !== to) await this.contradict(existing);
      return null;
    }

    // NUL separator, and it has to be something a scope or a trigger can
    // never contain: with a space, scope "capture.category" + trigger
    // "Elite Squad" and scope "capture.category Elite" + trigger "Squad"
    // would collide on one key and answer each other's questions.
    //
    // Written as an ESCAPE, not as a literal byte (2026-08-24). It used to be
    // the raw character, which produces exactly the same key and makes this
    // file read as BINARY to grep, diff, and review tooling. Three separate
    // searches of this file came back empty this session before that was the
    // explanation. Same string at runtime, so nothing stored is invalidated.
    const key = `${scope}\u0000${from}`;
    const pending = readPending();
    const prior = pending[key];
    if (prior && prior.to === to) {
      delete pending[key];
      writePending(pending);
      const data: LearnedRuleData = {
        kind,
        scope,
        from,
        to,
        evidence: [...prior.evidence, evidenceLine],
        createdAt: new Date().toISOString(),
      };
      const id = await this.store.create(this.ownerId, ENTITY_LEARNED_RULE, data as unknown as ItemData);
      return { id, data };
    }
    pending[key] = { to, evidence: [evidenceLine] };
    writePending(pending);
    return null;
  }

  // S4-Q26 (2026-09-04): "the plan cap never becomes a rule you can
  // delete." recordCorrection's two-observation requirement is for
  // behaviour JARVIS infers on its own; this is for the person declaring a
  // rule outright with one deliberate tap (the same distinction the Brain's
  // own Make It a Rule toggle draws: nothing is ever promoted automatically,
  // but a direct, on-purpose action is not automatic promotion). Idempotent:
  // re-tapping an offer that already created its rule returns the existing
  // row rather than a duplicate.
  //
  // Pre-announced, on purpose: the doctrine's announcement exists to license
  // a SILENT creation the person never asked for. A tap is not silent -- the
  // caller's own toast at the moment of creation already told them exactly
  // what just happened, in words specific to that offer, which says more
  // than the generic "New rule: X means Y" announceIfFirstUse would show
  // were it to fire again the next time this rule is read.
  async create(kind: RuleKind, scope: string, from: string, to: string, evidenceLine: string): Promise<LearnedRule> {
    const existing = await this.resolve(scope, from);
    if (existing) return existing;
    const data: LearnedRuleData = { kind, scope, from, to, evidence: [evidenceLine], createdAt: new Date().toISOString(), announced: true };
    const id = await this.store.create(this.ownerId, ENTITY_LEARNED_RULE, data as unknown as ItemData);
    return { id, data };
  }

  // First use announces the rule, exactly once. The announcement is the
  // deal: silent creation is licensed by loud existence.
  async announceIfFirstUse(rule: LearnedRule): Promise<void> {
    if (rule.data.announced) return;
    await this.store.update(this.ownerId, rule.id, { announced: true } as unknown as ItemData);
    rule.data.announced = true;
    showToast({ message: `New rule: ${rule.data.from} means ${rule.data.to} · Change it in Settings` });
  }

  // One contradiction kills the rule instantly. The death is a flat fact.
  //
  // SILENT IF IT WAS NEVER ANNOUNCED (2026-08-24). The announcement is what
  // licenses creating a rule without a tap, and it fires on first USE. In
  // record-only mode nothing uses rules, so nothing is ever announced, and
  // an unconditional toast here would tell Dave that JARVIS forgot a rule he
  // was never told it had. That is the same class of lie as the strand toast
  // that said the Brain was full when it was not.
  //
  // Correct in both modes, not a mode switch: you cannot take back out loud
  // something you never said out loud.
  async contradict(rule: LearnedRule): Promise<void> {
    await this.store.delete(this.ownerId, rule.id);
    if (rule.data.announced) showToast({ message: `Forgot the rule: ${rule.data.from} means ${rule.data.to}.` });
  }

  // The real Delete in What JARVIS Learned. Deleting the row IS the revert:
  // consumers consult resolve() live, so a deleted rule changes nothing
  // afterward except back to asking.
  async delete(id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
  }

  // B10 (2026-08-24): the way back for a deleted rule. The comment above is
  // right that consumers resolve() live, but deletion also destroys the
  // evidence array, and the corrections that earned it cannot be re-derived.
  // Undo re-creates the record verbatim instead of asking the user to
  // correct JARVIS twice again.
  async restore(data: LearnedRuleData): Promise<string> {
    return this.store.create(this.ownerId, ENTITY_LEARNED_RULE, data as unknown as ItemData);
  }
}
