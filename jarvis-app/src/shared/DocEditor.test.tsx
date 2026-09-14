// THE SHARED DOCUMENT EDITOR (the writing system, 2026-09-14). One surface,
// a real document model, and a bar above the keyboard while it is focused.
// These run the real editor in jsdom (the shims in tiptapTest.ts give it the
// zero-size layout jsdom cannot).
// @vitest-environment jsdom
import "./tiptapTest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, createEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { createRef } from "react";
import DocEditor, { type DocEditorHandle, type Doc } from "./DocEditor";

const DOC: Doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "First words" }] }] };

// Types one character at a time through the view's text-input handlers, so
// the input rules ("- " to a bullet) fire the way they do for real keys.
function typeText(ed: NonNullable<DocEditorHandle["editor"]>, text: string) {
  for (const ch of text) {
    const { from, to } = ed.state.selection;
    const handled = ed.view.someProp("handleTextInput", (f) => f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)));
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to));
  }
}

function mount(props: Partial<React.ComponentProps<typeof DocEditor>> = {}) {
  const ref = createRef<DocEditorHandle>();
  const onChange = vi.fn();
  const utils = render(<DocEditor ref={ref} doc={props.doc ?? DOC} docKey={props.docKey ?? "n1"} onChange={onChange} {...props} />);
  return { ref, onChange, ...utils };
}

describe("the surface", () => {
  it("renders the document as one editable region with an accessible name", () => {
    const { container } = mount({ ariaLabel: "Note" });
    const pm = container.querySelector(".doc-pm")!;
    expect(pm).toHaveAttribute("contenteditable", "true");
    expect(pm).toHaveAttribute("aria-label", "Note");
    expect(pm.textContent).toBe("First words");
  });

  it("shows its cue only on an empty document", () => {
    const { container, rerender, ref } = mount({ doc: { type: "doc", content: [{ type: "paragraph" }] }, placeholder: "Start Writing" });
    expect(container.querySelector("p.is-editor-empty")).toHaveAttribute("data-placeholder", "Start Writing");
    rerender(<DocEditor ref={ref} doc={DOC} docKey="n2" onChange={() => {}} placeholder="Start writing" />);
    expect(container.querySelector("p.is-editor-empty")).toBeNull();
  });

  it("emits the document on every change and marks one bold run through a command", async () => {
    const { ref, onChange } = mount();
    await act(async () => {
      ref.current!.editor!.chain().setTextSelection({ from: 1, to: 6 }).toggleBold().run();
    });
    expect(onChange).toHaveBeenCalled();
    const doc = onChange.mock.calls.at(-1)![0] as Doc;
    expect(doc.content![0]!.content![0]).toEqual({ type: "text", marks: [{ type: "bold" }], text: "First" });
  });

  it("a Markdown shortcut makes a list, and Return on an empty item leaves it", async () => {
    const { ref, onChange } = mount({ doc: { type: "doc", content: [{ type: "paragraph" }] } });
    const ed = ref.current!.editor!;
    await act(async () => { ed.commands.focus("end"); typeText(ed, "- "); });
    // The input rule turns "- " into a bullet list.
    await act(async () => { typeText(ed, "Milk"); });
    let doc = onChange.mock.calls.at(-1)![0] as Doc;
    expect(doc.content![0]!.type).toBe("bulletList");
    // Return twice: the first makes the next item, the second, on an empty
    // top-level item, leaves the list (the keymap chain, not one command).
    await act(async () => { ed.commands.keyboardShortcut("Enter"); });
    await act(async () => { ed.commands.keyboardShortcut("Enter"); });
    doc = ed.getJSON();
    // One item stays in the list and the caret is in a paragraph after it.
    expect(doc.content![0]!.type).toBe("bulletList");
    expect(doc.content![0]!.content!.length).toBe(1);
    expect(doc.content![1]!.type).toBe("paragraph");
  });

  it("a refreshed document replaces the content only while the editor is idle, and a new key always does", async () => {
    const { ref, container, rerender } = mount();
    const other: Doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "From the store" }] }] };
    await act(async () => { ref.current!.editor!.commands.focus("end"); });
    await screen.findByRole("toolbar");
    rerender(<DocEditor ref={ref} doc={other} docKey="n1" onChange={() => {}} />);
    expect(container.querySelector(".doc-pm")!.textContent).toBe("First words");
    await act(async () => { ref.current!.editor!.commands.blur(); });
    await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());
    rerender(<DocEditor ref={ref} doc={other} docKey="n1" onChange={() => {}} />);
    await waitFor(() => expect(container.querySelector(".doc-pm")!.textContent).toBe("From the store"));
    const third: Doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Another note" }] }] };
    await act(async () => { ref.current!.editor!.commands.focus("end"); });
    await screen.findByRole("toolbar");
    rerender(<DocEditor ref={ref} doc={third} docKey="n9" onChange={() => {}} />);
    expect(container.querySelector(".doc-pm")!.textContent).toBe("Another note");
  });
});

describe("the writing bar", () => {
  it("appears while the surface is focused, in the brief's order, and Done dismisses it", async () => {
    const { ref } = mount();
    expect(screen.queryByRole("toolbar")).toBeNull();
    await act(async () => { ref.current!.editor!.commands.focus("end"); });
    const bar = await screen.findByRole("toolbar", { name: "Writing tools" });
    const labels = Array.from(bar.querySelectorAll(".doc-kbar-row button")).map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(labels).toEqual(["Undo", "Redo", "Format", "List", "Insert", "Done"]);
    expect(document.body.classList.contains("writing")).toBe(true);
    fireEvent.click(screen.getByText("Done"));
    await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());
    expect(document.body.classList.contains("writing")).toBe(false);
  });

  it("swallows mousedown so a tap never blurs the words, and Format opens its menu", async () => {
    const { ref } = mount();
    await act(async () => { ref.current!.editor!.commands.focus("end"); });
    const bar = await screen.findByRole("toolbar");
    const ev = createEvent.mouseDown(bar);
    fireEvent(bar, ev);
    expect(ev.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByText("Format"));
    expect(screen.getByRole("group", { name: "Format" })).toBeInTheDocument();
    expect(screen.getByText("Bold")).toBeInTheDocument();
    expect(screen.getByText("Clear Formatting")).toBeInTheDocument();
    fireEvent.click(screen.getByText("List"));
    expect(screen.queryByRole("group", { name: "Format" })).toBeNull();
    expect(screen.getByText("Indent")).toBeInTheDocument();
    expect(screen.getByText("Outdent")).toBeInTheDocument();
  });

  it("the quick level has Format and Done only; compact adds List", async () => {
    const { ref, unmount } = mount({ level: "quick" });
    await act(async () => { ref.current!.editor!.commands.focus("end"); });
    let bar = await screen.findByRole("toolbar");
    expect(Array.from(bar.querySelectorAll(".doc-kword")).map((b) => b.textContent)).toEqual(["Format", "Done"]);
    unmount();
    const second = mount({ level: "compact" });
    await act(async () => { second.ref.current!.editor!.commands.focus("end"); });
    bar = await screen.findByRole("toolbar");
    expect(Array.from(bar.querySelectorAll(".doc-kword")).map((b) => b.textContent)).toEqual(["Format", "List", "Done"]);
  });
});
