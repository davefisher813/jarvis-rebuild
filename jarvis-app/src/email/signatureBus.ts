// A saved signature, told to whoever holds a copy of the accounts (the Email tab), so a signature saved in Settings
// is the one the next compose inserts without a reload. In-memory only: the server row is the record.

export interface SignatureSaved { accountId: string; text: string; revision: number }

const listeners = new Set<(s: SignatureSaved) => void>();

export function announceSignature(s: SignatureSaved): void {
  for (const l of listeners) l(s);
}

export function onSignatureSaved(fn: (s: SignatureSaved) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
