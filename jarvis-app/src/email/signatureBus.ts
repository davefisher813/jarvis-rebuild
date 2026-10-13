// A saved signature, told to whoever holds a copy of the accounts (the Email tab), so a signature saved in Settings
// is the one the next compose inserts without a reload. In-memory only: the server row is the record.

import type { SignatureFields, SignatureImage } from "./signature";

/** What a save leaves on the account: the lines and revision always, and (builder, migration 0072) how it was made, its fields and its picture. */
export interface SignatureSaved {
  accountId: string;
  text: string;
  revision: number;
  kind?: "text" | "built";
  fields?: SignatureFields;
  image?: SignatureImage | null;
}

/** The account with this save applied: the lines and revision, and how it was made. A typed save carries no details and no picture, so they are cleared. */
export function withSavedSignature<A extends { id: string }>(account: A, s: SignatureSaved): A {
  if (account.id !== s.accountId) return account;
  return { ...account, signature_text: s.text, signature_revision: s.revision, signature_kind: s.kind ?? "text", signature_fields: s.fields ?? {}, signature_image: s.image ?? null };
}

const listeners = new Set<(s: SignatureSaved) => void>();

export function announceSignature(s: SignatureSaved): void {
  for (const l of listeners) l(s);
}

export function onSignatureSaved(fn: (s: SignatureSaved) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
