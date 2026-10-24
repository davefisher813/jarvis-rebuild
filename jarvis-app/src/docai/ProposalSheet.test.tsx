// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProposalSheet from "./ProposalSheet";
import { buildProposal } from "./proposal";
import type { DocText, ExtractionResult, VerifiedField } from "./types";

const f = (key: string, value: string, tier: "solid" | "uncertain" = "solid", reasons: string[] = []): VerifiedField => ({
  key, value, quote: value, page: 1, basis: "stated", tier, reasons, offsets: null,
});

const text: DocText = {
  text: "City Power Statement. Amount due $84.20 by Nov 3.", words: 8, lane: "text-layer", failedPages: [],
  pages: [{ page: 1, start: 0, end: 49 }],
} as unknown as DocText;

const proposal = (fields: VerifiedField[]) => {
  const x: ExtractionResult = { kind: "bill", actionable: true, items: [{ group: "bill", fields }], conflicts: [], missingPages: [], droppedCount: 0 };
  return buildProposal({ fileId: "f1", fileName: "power.pdf", title: "Power Bill", extraction: x });
};

const mount = (p = proposal([f("payee", "City Power"), f("amount", "$84.20"), f("dueDate", "Nov 3", "uncertain", ["The year is not printed."])])) => {
  const onFile = vi.fn().mockResolvedValue({ ok: true });
  const onDismiss = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();
  render(<ProposalSheet initial={p} text={text} onFile={onFile} onDismiss={onDismiss} onClose={onClose} />);
  return { onFile, onDismiss, onClose };
};

describe("ProposalSheet (laws 1, 2 and 6 on the screen)", () => {
  it("says where it goes and names the uncertain ones as staying behind", () => {
    mount();
    expect(screen.getByText("Looks Like a Bill")).toBeTruthy();
    expect(screen.getByText("Bill in Money")).toBeTruthy();
    expect(screen.getByText("2 Checked Against the Document")).toBeTruthy();
    expect(screen.getByText("1 Uncertain Stay for You")).toBeTruthy();
  });

  it("File It is closed until something is kept, and Approve All never keeps the uncertain field", async () => {
    const { onFile } = mount();
    // The bar dims File It and still takes the tap; the guard is in the sheet, so a tap before anything is kept files nothing.
    expect(screen.getByText("File It").className).toContain("dim");
    fireEvent.click(screen.getByText("File It"));
    expect(onFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Approve All"));
    expect(screen.getAllByText("Kept")).toHaveLength(2);
    expect(screen.getByText("File It").className).not.toContain("dim");
    expect(screen.getByText("Uncertain")).toBeTruthy();
    fireEvent.click(screen.getByText("File It"));
    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(1));
    const sent = onFile.mock.calls[0]![0];
    const by = Object.fromEntries(sent.groups[0].fields.map((x: { key: string; decision: string }) => [x.key, x.decision]));
    expect(by).toEqual({ payee: "keep", amount: "keep", dueDate: "undecided" });
  });

  it("an uncertain field shows its reason and the passage it came from", () => {
    mount();
    fireEvent.click(screen.getByText("Nov 3"));
    expect(screen.getByText("Why It's Uncertain")).toBeTruthy();
    expect(screen.getByText("The Year Is Not Printed")).toBeTruthy();
    expect(document.querySelector("mark.doc-mark")?.textContent).toBe("Nov 3");
  });

  it("Dismiss asks the owner to dismiss, and files nothing", async () => {
    const { onDismiss, onFile } = mount();
    fireEvent.click(screen.getByText("Dismiss"));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(onFile).not.toHaveBeenCalled();
  });

  it("a refusal from filing is shown in words and the sheet stays open", async () => {
    const onFile = vi.fn().mockResolvedValue({ ok: false, reason: "Money would not take that bill." });
    render(<ProposalSheet initial={proposal([f("payee", "City Power"), f("amount", "$84.20")])} text={null} onFile={onFile} onDismiss={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Approve All"));
    fireEvent.click(screen.getByText("File It"));
    await waitFor(() => expect(screen.getByText("Money would not take that bill.")).toBeTruthy());
  });
});
