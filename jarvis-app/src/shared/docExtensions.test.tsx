// THE DOCUMENT'S ORGANISATION TOOLS (the writing system, wave 3): folding
// as interface state, the outline, section moves, grouping under a heading,
// and find and replace where Replace All is one Undo.
// @vitest-environment jsdom
import "./tiptapTest";
import { describe, it, expect, vi } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { createRef } from "react";
import DocEditor, { type DocEditorHandle, type Doc } from "./DocEditor";
import { foldedHeadings, toggleFold, sectionEnd, outlineOf } from "./docExtensions";

const p = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const h = (t: string, level = 1) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text: t }] });
const DOC: Doc = { type: "doc", content: [h("Agenda"), p("First point"), p("Second point"), h("Decisions"), p("Went with B"), h("Detail", 2), p("Fine print")] };

function mount(doc: Doc = DOC) {
  const ref = createRef<DocEditorHandle>();
  const onChange = vi.fn();
  const utils = render(<DocEditor ref={ref} doc={doc} docKey="n1" onChange={onChange} level="document" />);
  return { ref, ed: ref.current!.editor!, onChange, ...utils };
}

describe("folding", () => {
  it("closes a section behind its heading, keeps the words, and exports every one", async () => {
    const { ed, container } = mount();
    expect(container.querySelectorAll("button.doc-fold").length).toBe(3);
    const agenda = outlineOf(ed.state.doc)[0]!;
    await act(async () => { toggleFold(ed, agenda.pos); });
    expect(foldedHeadings(ed)).toEqual([agenda.pos]);
    await waitFor(() => expect(container.querySelectorAll(".doc-folded").length).toBe(2));
    // The document itself is untouched: the words are still there.
    expect(ed.getJSON()).toEqual(DOC);
    await act(async () => { toggleFold(ed, agenda.pos); });
    expect(container.querySelectorAll(".doc-folded").length).toBe(0);
  });

  it("a fold survives typing above it, and a sub-heading stays inside its parent's section", async () => {
    const { ed } = mount();
    const outline = outlineOf(ed.state.doc);
    const decisions = outline[1]!;
    expect(sectionEnd(ed.state.doc, decisions.pos)).toBe(ed.state.doc.content.size);
    await act(async () => { toggleFold(ed, decisions.pos); });
    await act(async () => { ed.chain().setTextSelection(1).insertContent("New words. ").run(); });
    const after = outlineOf(ed.state.doc)[1]!;
    expect(after.text).toBe("Decisions");
    expect(foldedHeadings(ed)).toEqual([after.pos]);
  });
});

describe("the outline and the sections", () => {
  it("lists every heading with its level, and goTo puts the caret there", async () => {
    const { ref } = mount();
    expect(ref.current!.outline().map((o) => [o.text, o.level])).toEqual([["Agenda", 1], ["Decisions", 1], ["Detail", 2]]);
    await act(async () => { ref.current!.goTo(ref.current!.outline()[1]!.pos); });
    expect(ref.current!.inSection()).toBe(true);
    expect(ref.current!.sectionDoc()!.content!.map((n) => n.type)).toEqual(["heading", "paragraph", "heading", "paragraph"]);
  });

  it("moves a whole section above the one before it in one undo", async () => {
    const { ref, ed } = mount();
    await act(async () => { ref.current!.goTo(ref.current!.outline()[1]!.pos); });
    await act(async () => { expect(ref.current!.moveSection(-1)).toBe(true); });
    expect(ref.current!.outline().map((o) => o.text)).toEqual(["Decisions", "Detail", "Agenda"]);
    await act(async () => { ed.commands.undo(); });
    expect(ref.current!.outline().map((o) => o.text)).toEqual(["Agenda", "Decisions", "Detail"]);
    await act(async () => { ref.current!.goTo(ref.current!.outline()[0]!.pos); });
    await act(async () => { expect(ref.current!.moveSection(1)).toBe(true); });
    expect(ref.current!.outline().map((o) => o.text)).toEqual(["Decisions", "Detail", "Agenda"]);
  });

  it("groups the selected blocks under a new heading, ready to type", async () => {
    const { ref, ed } = mount({ type: "doc", content: [p("One"), p("Two")] });
    await act(async () => { ed.commands.setTextSelection(2); });
    await act(async () => { expect(ref.current!.groupUnderHeading()).toBe(true); });
    const doc = ed.getJSON();
    expect(doc.content![0]!.type).toBe("heading");
    expect(doc.content!.slice(1, 3).map((n) => n.type)).toEqual(["paragraph", "paragraph"]);
    expect(ed.state.selection.from).toBe(1);
  });
});

describe("find and replace", () => {
  it("counts and steps through matches, case-insensitively, and marks the current one", async () => {
    const { ref, container } = mount();
    await act(async () => { ref.current!.setSearch("point"); });
    expect(ref.current!.search().matches.length).toBe(2);
    expect(ref.current!.search().index).toBe(0);
    await waitFor(() => expect(container.querySelectorAll(".doc-match").length).toBe(2));
    expect(container.querySelectorAll(".doc-match.current").length).toBe(1);
    await act(async () => { ref.current!.stepSearch(1); });
    expect(ref.current!.search().index).toBe(1);
    await act(async () => { ref.current!.stepSearch(1); });
    expect(ref.current!.search().index).toBe(0);
    await act(async () => { ref.current!.setSearch(""); });
    expect(container.querySelectorAll(".doc-match").length).toBe(0);
  });

  it("replaces one, then all in one transaction that one Undo reverses", async () => {
    const { ref, ed } = mount();
    await act(async () => { ref.current!.setSearch("point"); });
    await act(async () => { expect(ref.current!.replaceCurrent("item")).toBe(true); });
    expect(ed.getText()).toContain("First item");
    expect(ref.current!.search().matches.length).toBe(1);
    await act(async () => { expect(ref.current!.replaceAll("thing")).toBe(1); });
    expect(ed.getText()).toContain("Second thing");
    await act(async () => { ed.commands.undo(); });
    expect(ed.getText()).toContain("Second point");
    expect(ed.getText()).toContain("First item");
  });
});
