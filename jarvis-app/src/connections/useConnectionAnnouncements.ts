// THE ANNOUNCER AND THE READER (Foundation Fix Spec 3).
//
// useConnectionAnnouncements runs ONCE, in AppShell, for the life of the
// session. Each time the status changes it asks the ledger what is new, posts
// the one local notification, and takes it down on recovery.
//
// useIncidentLedger is what a surface (the Email banner, the Today alert) reads:
// the same ledger, live, plus the one write a person can make (acknowledge).

import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountStatus } from "./connectionStatus";
import { acknowledge, markSeen, planAnnouncements, readLedger, subscribeLedger, writeLedger, type Ledger } from "./incidentLedger";
import { postConnectionIncident, withdrawConnectionIncident } from "../shared/notifications";

export function useConnectionAnnouncements(accounts: AccountStatus[] | null, userId: string | null | undefined): void {
  const last = useRef<string>("");
  useEffect(() => {
    if (!userId || !accounts) return;
    // Only a change in what the answer says is worth a pass: the same answer twice plans the same nothing.
    const sig = accounts.map((a) => `${a.email}|${a.incident?.id ?? ""}|${a.state}|${a.checkedAt}|${a.lastSuccessfulSyncAt ?? ""}`).join(";");
    if (sig === last.current) return;
    last.current = sig;
    const plan = planAnnouncements(readLedger(userId), accounts, new Date());
    writeLedger(plan.ledger);
    if (plan.post) void postConnectionIncident(plan.post);
    else if (plan.withdraw) void withdrawConnectionIncident();
  }, [accounts, userId]);
}

export interface IncidentLedgerHandle {
  ledger: Ledger;
  acknowledge: (incidentId: string) => void;
  seen: (incidentId: string) => void;
}

export function useIncidentLedger(userId: string | null | undefined): IncidentLedgerHandle {
  const uid = userId ?? "";
  const [ledger, setLedger] = useState<Ledger>(() => readLedger(uid));
  useEffect(() => { setLedger(readLedger(uid)); return subscribeLedger(setLedger); }, [uid]);
  const ack = useCallback((id: string) => { writeLedger(acknowledge(readLedger(uid), id, new Date())); }, [uid]);
  const seen = useCallback((id: string) => { writeLedger(markSeen(readLedger(uid), id)); }, [uid]);
  return { ledger, acknowledge: ack, seen };
}
