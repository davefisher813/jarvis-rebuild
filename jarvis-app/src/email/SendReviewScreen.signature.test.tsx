// @vitest-environment jsdom
// REVIEW SEND SHOWS THE SIGNATURE PICTURE THE MESSAGE CARRIES (issue 113). The server puts the picture in the reviewed snapshot only
// while the draft ends with the account's untouched built block (migration 0072), so what this screen draws is what is sent: no
// picture in the snapshot, no picture on the screen.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import SendReviewScreen from "./SendReviewScreen";
import type { Review } from "./drafts";
import type { FileStore } from "../files/FileStore";
import type { SignatureImage } from "./signature";

const NOW = new Date("2026-10-13T12:00:00Z");
const noop = () => {};
const IMAGE: SignatureImage = { storage_id: "u1/signature-a1/sig.png", sha256: "ab".repeat(32), size_bytes: 20000, mime_type: "image/png", width: 384, height: 256 };
const review = (signature?: Review["exact"]["signature"]): Review => ({
  review: { action_id: "a", review_nonce: "n", payload_hash: "h", expires_at: "2026-10-13T12:05:00Z", outbox_id: "o" },
  exact: {
    account_id: "a1", from_identity: "dave@example.test", to: ["coach@example.test"], cc: [], bcc: [], subject: "Roster", body_text: "Hi\n\n-- \nDave Fisher\nBFFSA", attachments: [],
    reply_headers: { in_reply_to: null, references: [], thread_id: null }, draft_id: "d1", draft_revision: 2, client_message_id: "<d1.2@jarvis.local>", ...(signature ? { signature } : {}),
  },
  warnings: [], verb: "Send", draft_revision: 2,
});
const store: FileStore = { upload: async () => { throw new Error("no"); }, url: async (p) => "https://files.test/" + p, remove: async () => undefined, removeAll: async () => undefined };
const view = (r: Review, fileStore: FileStore | null = store) => render(<SendReviewScreen review={r} offline={false} now={() => NOW} sending={false} failure={null} fileStore={fileStore} onEdit={noop} onSend={noop} onReviewAgain={noop} />);

afterEach(() => cleanup());

describe("Review Send and the signature picture", () => {
  it("draws the picture the snapshot carries, under the words, from the person's own folder", async () => {
    const { container } = view(review({ fields: { name: "Dave Fisher", organization: "BFFSA" }, image: IMAGE }));
    expect(screen.getByText("Signature Picture")).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector(".email-review-sig .sig-pic-img")).toHaveAttribute("src", "https://files.test/u1/signature-a1/sig.png"));
    // after the words, before any attachment
    const body = container.querySelector(".email-review-body")!;
    const sig = container.querySelector(".email-review-sig")!;
    expect(body.compareDocumentPosition(sig) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(body).toHaveTextContent("Dave Fisher");
  });

  it("with no picture in the snapshot there is nothing to draw", () => {
    const { container } = view(review());
    expect(screen.queryByText("Signature Picture")).toBeNull();
    expect(container.querySelector(".email-review-sig")).toBeNull();
  });

  it("draws no picture when the words no longer end with that signature's lines, because the sender would send plain text", () => {
    const r = review({ fields: { name: "Dave Fisher", organization: "Somebody Else" }, image: IMAGE });
    const { container } = view(r);
    expect(screen.queryByText("Signature Picture")).toBeNull();
    expect(container.querySelector(".email-review-sig")).toBeNull();
  });

  it("without a place to read it from, the plate holds the glyph rather than a broken picture", () => {
    const { container } = view(review({ fields: { name: "Dave Fisher", organization: "BFFSA" }, image: IMAGE }), null);
    expect(screen.getByText("Signature Picture")).toBeInTheDocument();
    expect(container.querySelector(".email-review-sig .sig-pic-img")).toBeNull();
    expect(container.querySelector(".email-review-sig .sig-pic .ic")).not.toBeNull();
  });
});
