import { buildVisionMessage, type AIService } from "../ai/AIService";
import { JARVIS_VOICE } from "../ai/voice";
import { encodeImageForVision } from "../shared/imageEncode";
import { RECEIPT_EXTRACT_PROMPT, parseReceiptExtract, type ReceiptRead } from "./receiptExtract";
import type { ReceiptDraft } from "./screens/ReceiptSheet";

// READ IT, AS A PROPOSAL (Money ledger, 2026-10-03). The only model call in the
// receipt flow, and it only ever fills a draft: nothing is saved, no bill is
// made, no date is invented. With AI off the caller never gets here (the
// button is not offered), and every other way in works without it.

/** One vision call over a picture; null when the model's reply was no receipt. */
export async function readReceiptFile(ai: AIService, file: File): Promise<ReceiptRead | null> {
  const img = await encodeImageForVision(file);
  const out = await ai.complete(
    [buildVisionMessage(RECEIPT_EXTRACT_PROMPT, img.data, img.mediaType)],
    JARVIS_VOICE,
    { kind: "receipt", pin: "pasteFallback" },
  );
  return parseReceiptExtract(out);
}

/** What a read fills into the sheet. An amount the receipt did not state stays
 *  blank, and a date it did not state is not offered (the sheet keeps today). */
export function draftFromRead(read: ReceiptRead): Partial<ReceiptDraft> {
  return {
    ...(read.vendor ? { vendor: read.vendor } : {}),
    ...(read.total !== null ? { amount: read.total.toFixed(2) } : {}),
    ...(read.date ? { date: read.date } : {}),
    ...(read.currency ? { currency: read.currency } : {}),
  };
}
