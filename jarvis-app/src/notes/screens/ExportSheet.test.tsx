// EXPORT A NOTE (the writing system, wave 2): the sheet prepares the file
// as soon as it opens, so Export File is the share itself; it defaults to
// PDF, remembers the last format that worked, says nothing on a cancel, and
// keeps the note when the export fails.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import ExportSheet from "./ExportSheet";
import { blocksToDoc } from "../docModel";
import { subscribeToast, resetToasts } from "../../shared/toast";

const saveFile = vi.fn();
vi.mock("../../shared/saveFile", () => ({ saveFile: (...a: unknown[]) => saveFile(...a), canShareFiles: () => true }));

const DOC = blocksToDoc([{ id: "h", type: "heading", text: "Agenda" }, { id: "t", type: "text", text: "Went with option B." }]);

function mount(over: Partial<React.ComponentProps<typeof ExportSheet>> = {}) {
  const onClose = vi.fn();
  render(<ExportSheet doc={DOC} title="Convo with Berto" images={[]} attachmentNames={[]} onClose={onClose} {...over} />);
  return { onClose };
}

describe("the export sheet", () => {
  beforeEach(() => { localStorage.clear(); saveFile.mockReset(); });
  afterEach(() => { resetToasts(); });

  it("opens on PDF with the title as the filename and exports on one more tap", async () => {
    saveFile.mockResolvedValue("shared");
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    const { onClose } = mount();
    expect(screen.getByRole("button", { name: /PDF/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Filename")).toHaveValue("Convo with Berto");
    expect(screen.getByText("Convo with Berto.pdf")).toBeInTheDocument();
    const btn = await screen.findByRole("button", { name: "Export File" }, { timeout: 15000 });
    fireEvent.click(btn);
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    const [blob, name] = saveFile.mock.calls[0]!;
    expect(name).toBe("Convo with Berto.pdf");
    expect((blob as Blob).type).toBe("application/pdf");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(seen).toContain("Convo with Berto.pdf shared");
    expect(localStorage.getItem("jarvis.notes.export.v1")).toBe("pdf");
    stop();
  }, 20000);

  it("remembers the last format that worked and cleans a typed filename", async () => {
    saveFile.mockResolvedValue("downloaded");
    const { onClose } = mount();
    fireEvent.click(screen.getByRole("button", { name: /Markdown/ }));
    fireEvent.change(screen.getByLabelText("Filename"), { target: { value: "plan: q3/draft" } });
    fireEvent.blur(screen.getByLabelText("Filename"));
    expect(screen.getByText("plan q3draft.md")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Export File" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveFile.mock.calls[0]![1]).toBe("plan q3draft.md");
    expect(localStorage.getItem("jarvis.notes.export.v1")).toBe("md");
    localStorage.setItem("jarvis.notes.export.v1", "txt");
    mount();
    expect(screen.getAllByRole("button", { name: /Text \.txt/ }).at(-1)).toHaveAttribute("aria-pressed", "true");
  });

  it("a dismissed share sheet says nothing and keeps the sheet open", async () => {
    saveFile.mockResolvedValue(false);
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    const { onClose } = mount();
    fireEvent.click(screen.getByRole("button", { name: /Text \.txt/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Export File" }));
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    expect(localStorage.getItem("jarvis.notes.export.v1")).toBeNull();
    stop();
  });

  it("a failed export keeps the note, says so, and offers Retry and the other formats", async () => {
    saveFile.mockRejectedValueOnce(new Error("The disk is full")).mockResolvedValueOnce("shared");
    const { onClose } = mount();
    fireEvent.click(screen.getByRole("button", { name: /Text \.txt/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Export File" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The disk is fullThe note is unchangedRetry, or choose another format");
    expect(screen.getAllByRole("button", { pressed: false }).filter((b) => b.classList.contains("exp-format")).length).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("the preview shows the words, and More Options can leave the title out", async () => {
    mount();
    fireEvent.click(screen.getByText("Preview"));
    expect(screen.getByText(/Convo with Berto/, { selector: "pre" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("More Options"));
    fireEvent.click(screen.getByLabelText("Include the title"));
    await waitFor(() => expect(screen.queryByText(/Convo with Berto/, { selector: "pre" })).toBeNull());
  });
});
