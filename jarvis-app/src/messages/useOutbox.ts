import { useEffect, useState } from "react";
import { getOutbox, subscribeOutbox, type OutboxItem } from "./outbox";

// EMAIL-F-01 (2026-09-05): the Email tab's read of the one true queue
// (outbox.ts). It used to OWN the queue as React state and pump it itself;
// now it only renders what the store holds, and MailOutboxPump in AppShell
// does the sending whether or not this tab is mounted.
export function useOutbox(): OutboxItem[] {
  const [items, setItems] = useState<OutboxItem[]>(getOutbox);
  useEffect(() => subscribeOutbox(setItems), []);
  return items;
}
