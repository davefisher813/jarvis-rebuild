import type { Store, ItemData } from "@core";
import {
  ENTITY_MONEY_ACCOUNT, ENTITY_MONEY_TX, ENTITY_MONEY_BUDGET, ENTITY_MONEY_SUB,
  monthOf,
  type TrackerAccount, type TrackerAccountData, type TrackerBudget, type TrackerBudgetData,
  type TrackerAccountType, type TrackerData, type TrackerSub, type TrackerSubData, type TrackerTx, type TrackerTxData,
} from "./tracker";
import { SEED_ACCOUNTS, SEED_SUBS, SEED_TXS } from "./trackerSeed";
import { fingerprintOf } from "./ledger/fingerprint";
import { appended, diffFields, entry, isoNow, type Clock } from "./ledger/history";

const ACCOUNT_ORDER: Record<TrackerAccountType, number> = { checking: 0, savings: 1, "credit card": 2 };

type Emit = (e: { type: "entity.created" | "entity.updated" | "entity.deleted"; entityType: string; entityId: string }) => void;

// THE TRACKER'S STORE (PASSOFF 2026-09-19, step 2).
//
// The passoff describes talking to Supabase directly -- the item table, the
// item_apply_patch RPC, a realtime subscription. None of that belongs in a
// feature: the app has one Store (jarvis-core) that already does the patch
// merge, the offline queue, the read cache and the realtime fold, and every
// feature reaches it through a small service like this one. MoneyService is
// the same shape for accounts. So the RPC stays where it already lives and
// this file only says what a Tracker record IS.
export class TrackerService {
  constructor(private store: Store, private ownerId: string, private onEvent: Emit = () => {}, private now: Clock = isoNow) {}

  private async listOf<T>(entityType: string): Promise<{ id: string; data: T }[]> {
    const items = await this.store.listForUser(this.ownerId, entityType);
    return items.map((i) => ({ id: i.id, data: i.data as unknown as T }));
  }

  /** Everything the screen draws, in one pass. */
  async load(): Promise<TrackerData> {
    const [accounts, txs, budgets, subs] = await Promise.all([
      this.listOf<TrackerAccountData>(ENTITY_MONEY_ACCOUNT),
      this.listOf<TrackerTxData>(ENTITY_MONEY_TX),
      this.listOf<TrackerBudgetData>(ENTITY_MONEY_BUDGET),
      this.listOf<TrackerSubData>(ENTITY_MONEY_SUB),
    ]);
    return {
      // Statement order: the money you spend from, then the money you keep,
      // then what you owe. Alphabetical inside each, so adding an account
      // never reshuffles the ones already there.
      accounts: (accounts as TrackerAccount[]).sort((a, b) =>
        ACCOUNT_ORDER[a.data.type] - ACCOUNT_ORDER[b.data.type] || a.data.name.localeCompare(b.data.name)),
      txs: txs as TrackerTx[],
      budgets: budgets as TrackerBudget[],
      subs: (subs as TrackerSub[]).sort((a, b) => a.data.merchantName.localeCompare(b.data.merchantName)),
    };
  }

  private async write(entityType: string, id: string | null, data: unknown): Promise<string | null> {
    if (id) {
      await this.store.update(this.ownerId, id, data as ItemData);
      this.onEvent({ type: "entity.updated", entityType, entityId: id });
      return id;
    }
    const made = await this.store.create(this.ownerId, entityType, data as ItemData);
    this.onEvent({ type: "entity.created", entityType, entityId: made });
    return made;
  }

  private async drop(entityType: string, id: string): Promise<void> {
    await this.store.delete(this.ownerId, id);
    this.onEvent({ type: "entity.deleted", entityType, entityId: id });
  }

  /** The month always comes from the date, so an edited date refiles the row.
   *
   *  LEDGER (2026-10-03): every write shows in the row's own history, in the
   *  same patch as the change (the item table keeps no past). A new row starts
   *  its history with "created" and is stamped as typed by hand; an edit
   *  appends what changed, before and after. An edit sends only the fields the
   *  sheet owns: the store merges, so matchedReceiptId, paysBillId, currency,
   *  source and the rest of the ledger's fields are never dropped by it, and
   *  the history is read from the stored row, never from the caller. */
  async saveTx(id: string | null, data: TrackerTxData): Promise<string | null> {
    const clean: TrackerTxData = {
      ...data,
      month: monthOf(data.date),
      merchant: data.merchant.trim(),
      name: (data.name || data.merchant).trim(),
    };
    if (!clean.merchant || !clean.date || !clean.amountCents) return null;
    const stamp = (d: TrackerTxData): string => fingerprintOf({ kind: "tx", vendor: d.merchant, amountCents: d.amountCents, date: d.date, source: d.source ?? "manual" });
    if (!id) {
      const source = clean.source ?? "manual";
      return this.write(ENTITY_MONEY_TX, null, {
        ...clean,
        source,
        fingerprint: clean.fingerprint ?? stamp({ ...clean, source }),
        // A restored row (Undo) brings its own history back with it.
        history: clean.history?.length ? clean.history : [entry("user", "created", undefined, this.now)],
      });
    }
    const before = (await this.store.read(this.ownerId, id))?.data as unknown as TrackerTxData | undefined;
    // The ledger owns these: an edit never writes them, so a stale copy in
    // the caller's hand cannot undo a link made since it was read.
    const patch: TrackerTxData = { ...clean };
    for (const k of ["history", "fingerprint", "matchedReceiptId", "paysBillId", "source", "currency"] as const) delete patch[k];
    if (before) {
      const changes = diffFields(before, clean, ["date", "merchant", "amountCents", "category", "account"]);
      if (Object.keys(changes).length) {
        patch.history = appended(before.history, entry("user", "corrected", changes, this.now));
        patch.fingerprint = stamp({ ...before, ...clean });
      }
    }
    return this.write(ENTITY_MONEY_TX, id, patch);
  }

  /** Undo of a delete: the same row back under the same id, so a receipt or
   *  bill that was linked to it by id can be linked again. */
  async restoreTx(tx: TrackerTx): Promise<void> {
    await this.store.create(this.ownerId, ENTITY_MONEY_TX, tx.data as unknown as ItemData, tx.id);
    this.onEvent({ type: "entity.created", entityType: ENTITY_MONEY_TX, entityId: tx.id });
  }
  removeTx(id: string): Promise<void> { return this.drop(ENTITY_MONEY_TX, id); }

  /** One budget row per month: a second Save edits the first, never adds. */
  async saveBudget(data: TrackerBudgetData): Promise<string | null> {
    const existing = (await this.listOf<TrackerBudgetData>(ENTITY_MONEY_BUDGET))
      .find((b) => b.data.month === data.month);
    return this.write(ENTITY_MONEY_BUDGET, existing?.id ?? null, data);
  }

  async saveSub(id: string | null, data: TrackerSubData): Promise<string | null> {
    const clean: TrackerSubData = { ...data, merchantName: data.merchantName.trim() };
    if (!clean.merchantName || !clean.amountCents) return null;
    return this.write(ENTITY_MONEY_SUB, id, clean);
  }
  removeSub(id: string): Promise<void> { return this.drop(ENTITY_MONEY_SUB, id); }

  async saveAccount(id: string | null, data: TrackerAccountData): Promise<string | null> {
    const clean: TrackerAccountData = { ...data, name: data.name.trim() };
    if (!clean.name) return null;
    return this.write(ENTITY_MONEY_ACCOUNT, id, clean);
  }
  removeAccount(id: string): Promise<void> { return this.drop(ENTITY_MONEY_ACCOUNT, id); }

  /**
   * Write September once.
   *
   * The guard is the transactions, not the accounts: an account may have been
   * added by hand first, and importing on top of that must still be safe.
   * Returns false without writing anything when a transaction already exists,
   * so the caller can say what actually happened rather than what it tried.
   */
  async seedIfEmpty(): Promise<boolean> {
    const already = await this.store.listForUser(this.ownerId, ENTITY_MONEY_TX);
    if (already.length > 0) return false;
    const have = new Set((await this.listOf<TrackerAccountData>(ENTITY_MONEY_ACCOUNT)).map((a) => a.data.name));
    for (const a of SEED_ACCOUNTS) if (!have.has(a.name)) await this.write(ENTITY_MONEY_ACCOUNT, null, a);
    for (const s of SEED_SUBS) await this.write(ENTITY_MONEY_SUB, null, s);
    for (const t of SEED_TXS) await this.write(ENTITY_MONEY_TX, null, t);
    return true;
  }
}
