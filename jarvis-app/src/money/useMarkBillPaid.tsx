import { useCallback, useState, type ReactNode } from "react";
import { useOptionalLedger } from "../data/NotesProvider";
import { FormSheet, Group, FieldRow, Row, Note, ErrorLine } from "../shared/FormSheet";
import { Calendar } from "../shared/icons";
import { DollarGlyph } from "../shared/glyphs";
import { attemptWrite } from "../shared/guard";
import { showToast } from "../shared/toast";
import { todayISO } from "../tasks/grouping";
import { lineCase } from "../shared/casing";
import { billAmount } from "./billView";
import { CONFIRM_MARK_PAID } from "./confirmMarkPaid";
import { isRealDate } from "./ledger/dates";
import type { Bill } from "./ledger/types";

// MARK PAID, THE ONE DOOR (Money ledger, lane B).
//
// Every place a ledger bill can be marked paid (the row's check, its swipe,
// the detail sheet, the Today card) asks this hook, so the question Dave has
// not settled is answered in one place. CONFIRM_MARK_PAID decides: true opens
// the small "I paid this" confirm, false writes at once dated today and gives
// an Undo. Either way the evidence is the person's own word, and a write that
// fails says so (attemptWrite) and leaves the bill as it was.

function MarkPaidSheet({ bill, onSave, onCancel }: { bill: Bill; onSave: (paidAt: string) => Promise<boolean>; onCancel: () => void }) {
  const [paidOn, setPaidOn] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const valid = isRealDate(paidOn);
  const save = () => {
    if (!valid) { setTouched(true); return; }
    if (saving) return;
    setSaving(true);
    void onSave(paidOn).then((ok) => { if (!ok) setSaving(false); }, () => setSaving(false));
  };
  return (
    <FormSheet title="Mark Paid" onCancel={onCancel} onSave={save} saveDisabled={!valid} saveLabel={saving ? "Saving" : "I Paid This"}>
      <Group label="Bill">
        <Row tone="green" glyph={<DollarGlyph />} label={bill.data.vendor}><span className="money-amt">{billAmount(bill.data)}</span></Row>
      </Group>
      <Group label="When">
        <FieldRow tone="orange" glyph={<Calendar className="ic" />} label="Paid On" type="date" value={paidOn} onChange={setPaidOn}
          ariaLabel="Paid on" error={touched && !valid} />
      </Group>
      <ErrorLine text={touched && !valid ? "Pick the day you paid it" : null} />
      {bill.data.autopay && <Note>{lineCase("Autopay alone never marks a bill paid")}</Note>}
    </FormSheet>
  );
}

/** `request(bill)` starts Mark Paid for a ledger bill; render `sheet` once. */
export function useMarkBillPaid(onDone: () => void | Promise<void>): { request: (b: Bill) => void; sheet: ReactNode } {
  const ledger = useOptionalLedger();
  const [target, setTarget] = useState<Bill | null>(null);

  const commit = useCallback(async (b: Bill, paidAt: string): Promise<boolean> => {
    if (!ledger) return false;
    const ok = await attemptWrite(async () => {
      const r = await ledger.markBillPaidByUser(b.id, paidAt);
      // A refusal is a failed write: the bill stays as it was and it says so.
      if (!r.ok) throw new Error(r.reason);
    });
    if (!ok) return false;
    await onDone();
    // One tap has no confirm to stand behind it, so it has the way back.
    if (!CONFIRM_MARK_PAID) {
      showToast({
        message: "Marked Paid",
        actionLabel: "Undo",
        onAction: () => void (async () => {
          if (await attemptWrite(async () => { const u = await ledger.unmarkBillPaid(b.id); if (!u.ok) throw new Error(u.reason); })) await onDone();
        })(),
      });
    }
    return true;
  }, [ledger, onDone]);

  const request = useCallback((b: Bill) => {
    if (CONFIRM_MARK_PAID) setTarget(b);
    else void commit(b, todayISO());
  }, [commit]);

  const sheet = target ? (
    <MarkPaidSheet
      bill={target}
      onSave={async (paidAt) => {
        const ok = await commit(target, paidAt);
        if (ok) setTarget(null);
        return ok;
      }}
      onCancel={() => setTarget(null)}
    />
  ) : null;

  return { request, sheet };
}
