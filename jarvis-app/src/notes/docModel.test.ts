// THE DOCUMENT MODEL (the writing system, 2026-09-14): a note's blocks
// become one document on open, and the document projects back to blocks on
// every save, so nothing that reads blocks (search, the checklist-to-task
// flows, older builds) notices the editor changed underneath it.
import { describe, it, expect } from "vitest";
import { blocksToDoc, docToBlocks, displayTitle, firstLineOf, docWordCount, setTaskDone, linkedTasksIn, isDocEmpty, emptyDoc, applyChecklistLinks } from "./docModel";
import type { Block } from "./types";

const BLOCKS: Block[] = [
  { id: "h1", type: "heading", text: "Agenda" },
  { id: "t1", type: "text", text: "Went with **option B** and *not* A." },
  { id: "c1", type: "checklist", items: [{ text: "Renew lease", done: false, taskId: "task-9" }, { text: "Talk pricing", done: true }] },
  { id: "l1", type: "bulleted_list", items: ["Milk", "Eggs"] },
  { id: "n1", type: "numbered_list", items: ["First", "Second"] },
  { id: "q1", type: "quote", text: "A line worth keeping" },
  { id: "k1", type: "callout", text: "Worth noticing" },
  { id: "d1", type: "divider" },
  { id: "tb", type: "table", columns: ["Item", "Cost"], rows: [["Rent", "1200"]] },
  { id: "p1", type: "photo", name: "Beach", size: "1 KB", path: "u/n/beach.jpg", mime: "image/jpeg" },
];

describe("blocks become a document", () => {
  it("maps every block type to its node, marks included, and leaves attachments out", () => {
    const doc = blocksToDoc(BLOCKS);
    const types = (doc.content ?? []).map((n) => n.type);
    expect(types).toEqual(["heading", "paragraph", "taskList", "bulletList", "orderedList", "blockquote", "callout", "horizontalRule", "table"]);
    const para = doc.content![1]!;
    expect(para.content!.map((t) => [t.text, t.marks?.[0]?.type])).toEqual([
      ["Went with ", undefined], ["option B", "bold"], [" and ", undefined], ["not", "italic"], [" A.", undefined],
    ]);
    const task = doc.content![2]!.content![0]!;
    expect(task.attrs).toEqual({ checked: false, taskId: "task-9" });
    expect(doc.content![2]!.content![1]!.attrs).toEqual({ checked: true, taskId: null });
    const table = doc.content![8]!;
    expect(table.content![0]!.content!.every((c) => c.type === "tableHeader")).toBe(true);
    expect(table.content![1]!.content![1]!.content![0]!.content![0]!.text).toBe("1200");
  });

  it("an empty note is one empty paragraph, which the editor reads as empty", () => {
    expect(blocksToDoc([])).toEqual(emptyDoc());
    expect(isDocEmpty(blocksToDoc([]))).toBe(true);
    expect(isDocEmpty(blocksToDoc(BLOCKS))).toBe(false);
  });
});

describe("a document projects back to blocks", () => {
  it("round-trips the types, the markers, the checklist links and the table", () => {
    const back = docToBlocks(blocksToDoc(BLOCKS), BLOCKS);
    expect(back.map((b) => b.type)).toEqual(BLOCKS.map((b) => b.type));
    expect(back[1]!.text).toBe("Went with **option B** and *not* A.");
    expect(back[2]!.items).toEqual([{ text: "Renew lease", done: false, taskId: "task-9" }, { text: "Talk pricing", done: true }]);
    expect(back[3]!.items).toEqual(["Milk", "Eggs"]);
    expect(back[8]!.columns).toEqual(["Item", "Cost"]);
    expect(back[8]!.rows).toEqual([["Rent", "1200"]]);
  });

  it("keeps a block's id when the same kind of block is still in its place, and the attachment always", () => {
    const back = docToBlocks(blocksToDoc(BLOCKS), BLOCKS);
    expect(back.map((b) => b.id)).toEqual(BLOCKS.map((b) => b.id));
    // A paragraph inserted at the top shifts the rest: new ids for the moved
    // ones, the photo untouched at the end.
    const doc = blocksToDoc(BLOCKS);
    doc.content!.unshift({ type: "paragraph", content: [{ type: "text", text: "New first line" }] });
    const shifted = docToBlocks(doc, BLOCKS);
    expect(shifted[0]!.text).toBe("New first line");
    expect(shifted[shifted.length - 1]).toEqual(BLOCKS[BLOCKS.length - 1]);
  });

  it("flattens a nested list into the parent's items, because the projection has no levels", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Parent" }] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Child" }] }] }] }],
        }],
      }],
    };
    expect(docToBlocks(doc)[0]!.items).toEqual(["Parent", "Child"]);
  });
});

describe("what a note is called", () => {
  it("is the title, or the first line with words in it, or Untitled", () => {
    expect(displayTitle({ title: "Roster", blocks: BLOCKS })).toBe("Roster");
    expect(displayTitle({ title: "", blocks: BLOCKS })).toBe("Agenda");
    expect(displayTitle({ title: "  ", doc: blocksToDoc([{ id: "a", type: "text", text: "" }, { id: "b", type: "text", text: "Second line speaks" }]) })).toBe("Second line speaks");
    expect(displayTitle({ title: "", blocks: [] })).toBe("Untitled");
    expect(firstLineOf(blocksToDoc([{ id: "a", type: "text", text: "x".repeat(120) }])).length).toBeLessThanOrEqual(80);
  });

  it("counts words in paragraphs and lists, never in headings", () => {
    expect(docWordCount(blocksToDoc([{ id: "h", type: "heading", text: "Agenda for today" }, { id: "t", type: "text", text: "three words here" }]))).toBe(3);
  });
});

describe("the app's own edits to the document", () => {
  it("checks a linked line from Tasks and reports the same document when nothing changed", () => {
    const doc = blocksToDoc(BLOCKS);
    expect(linkedTasksIn(doc)).toEqual([{ taskId: "task-9", checked: false }]);
    const next = setTaskDone(doc, "task-9", true);
    expect(next).not.toBe(doc);
    expect(linkedTasksIn(next)).toEqual([{ taskId: "task-9", checked: true }]);
    expect(setTaskDone(next, "task-9", true)).toBe(next);
    expect(setTaskDone(next, "nobody", true)).toBe(next);
  });

  it("carries task links made on the blocks back into the document, line for line", () => {
    const doc = blocksToDoc([{ id: "c", type: "checklist", items: [{ text: "Milk", done: false }, { text: "Eggs", done: false }] }]);
    const blocks: Block[] = [{ id: "c", type: "checklist", items: [{ text: "Milk", done: false, taskId: "t-milk" }, { text: "Eggs", done: false, taskId: "t-eggs" }] }];
    const linked = applyChecklistLinks(doc, blocks);
    expect(linkedTasksIn(linked).map((l) => l.taskId)).toEqual(["t-milk", "t-eggs"]);
    expect(applyChecklistLinks(linked, blocks)).toBe(linked);
  });
});
