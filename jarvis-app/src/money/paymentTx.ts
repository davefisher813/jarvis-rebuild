import type { TrackerService } from "./TrackerService";
import { lastCategoryFor } from "./categoryDefault";

// A PAYMENT THE PERSON SAYS THEY MADE, FILED AS A TRANSACTION (the research standard, rule 5; the live audit of
// 2026-10-19). Capture ("Spent 30 on gas", "I already paid $12 for the bill") and Mark Paid both file the same row, with the
// defaults the New Transaction sheet opens on: the category this merchant last had (else Other) and the first account.
// The defaults are a convenience; a tracker that cannot be read still records the payment.

/** Saves the payment, returning its id (null when the tracker refused it, which saveTx does for an empty merchant, day or amount). */
export async function fileTrackerPayment(
  tracker: Pick<TrackerService, "saveTx" | "load">,
  p: { merchant: string; amountCents: number; date: string },
): Promise<string | null> {
  let category = "Other";
  let account = "";
  try {
    const data = await tracker.load();
    category = lastCategoryFor(p.merchant, data.txs, []) ?? category;
    account = data.accounts[0]?.data.name ?? "";
  } catch {
    /* defaults only */
  }
  return tracker.saveTx(null, {
    date: p.date, month: p.date.slice(0, 7), merchant: p.merchant, name: p.merchant,
    amountCents: p.amountCents, category, account,
  });
}
