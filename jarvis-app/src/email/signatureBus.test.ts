import { describe, it, expect, vi } from "vitest";
import { announceSignature, onSignatureSaved, withSavedSignature, type SignatureSaved } from "./signatureBus";
import type { SignatureImage } from "./signature";

const IMAGE: SignatureImage = { storage_id: "u/signature-a1/sig.png", sha256: "ab".repeat(32), size_bytes: 20000, mime_type: "image/png", width: 384, height: 256 };
const acct = (o: Record<string, unknown> = {}) => ({ id: "a1", address: "d@x.test", signature_text: "Old", signature_revision: 1, ...o });

describe("a saved signature, applied to a copy of the account", () => {
  it("a builder save sets the lines, the revision, the kind, the details and the picture", () => {
    const saved: SignatureSaved = { accountId: "a1", text: "Dave Fisher", revision: 4, kind: "built", fields: { name: "Dave Fisher" }, image: IMAGE };
    expect(withSavedSignature(acct(), saved)).toEqual({ id: "a1", address: "d@x.test", signature_text: "Dave Fisher", signature_revision: 4, signature_kind: "built", signature_fields: { name: "Dave Fisher" }, signature_image: IMAGE });
  });
  it("a typed save (no kind, no details, no picture) puts the account back to plain text and clears the rest", () => {
    const built = acct({ signature_kind: "built", signature_fields: { name: "Dave" }, signature_image: IMAGE });
    expect(withSavedSignature(built, { accountId: "a1", text: "Typed", revision: 5 })).toMatchObject({ signature_text: "Typed", signature_revision: 5, signature_kind: "text", signature_fields: {}, signature_image: null });
  });
  it("leaves another account exactly as it was (the same object)", () => {
    const other = acct({ id: "a2" });
    expect(withSavedSignature(other, { accountId: "a1", text: "X", revision: 2 })).toBe(other);
  });
});

describe("the bus", () => {
  it("tells every listener once, and a listener that has gone hears nothing", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onSignatureSaved(a);
    const offB = onSignatureSaved(b);
    const saved: SignatureSaved = { accountId: "a1", text: "T", revision: 2 };
    announceSignature(saved);
    expect(a).toHaveBeenCalledWith(saved);
    expect(b).toHaveBeenCalledWith(saved);
    offA();
    announceSignature(saved);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    offB();
  });
});
