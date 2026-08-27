// THE HANDOFF (catalog Part 7, rank #2 overall). The parent's actual
// product: rides, times, forms, fees, medication refill logistics, gear,
// when the physical expires. NO BODY DATA AT ALL -- this file only ever
// composes from sources that are already logistics-safe: the refill offer's
// plain sentence (never the medication's name), Locker documents lapsing
// soon (kind and label only, never their contents), and whatever external
// ride/fee/form items the caller hands in from schedule/tasks. Nothing here
// reads sleep, load, fuel, medication content, or body signals.

import { expiringDocs, LOCKER_DOC_LABEL, type LockerExpiring } from "./locker";
import { needsRefillCall, refillOffer, type RefillState } from "./refillRunway";
import type { LockerDocEntry } from "./types";

export type HandoffKind = "refill" | "locker" | "logistics";

export interface HandoffItem {
  kind: HandoffKind;
  line: string;
}

// A ride, a fee, a form -- anything the catalog's own note says to reuse
// existing schedule/task machinery for, handed in from outside so this file
// never has to import schedule/ or tasks/ directly.
export interface LogisticsCandidate {
  line: string;
}

export function handoffItems(
  refill: RefillState,
  lockerDocs: LockerDocEntry[],
  today: string,
  logistics: LogisticsCandidate[] = [],
): HandoffItem[] {
  const items: HandoffItem[] = [];

  if (needsRefillCall(refill)) {
    const line = refillOffer(refill);
    if (line) items.push({ kind: "refill", line });
  }

  const expiring: LockerExpiring[] = expiringDocs(lockerDocs, today);
  for (const e of expiring) {
    const label = LOCKER_DOC_LABEL[e.doc.data.kind];
    items.push({
      kind: "locker",
      line: e.daysUntil < 0 ? label + " Has Lapsed" : label + " Expires Soon",
    });
  }

  for (const l of logistics) items.push({ kind: "logistics", line: l.line });

  return items;
}
