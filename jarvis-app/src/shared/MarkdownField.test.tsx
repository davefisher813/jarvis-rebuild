// A DOCUMENT FIELD THAT STORES WORDS (the writing system, wave 3c): the
// string in, a document to type in, the string back out, and the blur the
// parents save on.
// @vitest-environment jsdom
import "./tiptapTest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { createRef } from "react";
import MarkdownField from "./MarkdownField";
import type { DocEditorHandle } from "./DocEditor";

describe("MarkdownField", () => {
  it("shows Markdown as a document and hands back Markdown, structure kept", async () => {
    const onChange = vi.fn();
    const ref = createRef<DocEditorHandle>();
    const { container } = render(<MarkdownField ref={ref} value={"## Plan\n- one\n- two"} docKey="a" onChange={onChange} ariaLabel="Notes" />);
    expect(container.querySelector("h1")!.textContent).toBe("Plan");
    expect(container.querySelectorAll("li").length).toBe(2);
    await act(async () => { ref.current!.editor!.chain().focus("end").insertContent("three").run(); });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0]).toContain("three");
  });

  it("stores plain words when asked, and says when it loses focus", async () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    const ref = createRef<DocEditorHandle>();
    render(<MarkdownField ref={ref} value="A line" docKey="b" format="text" onChange={onChange} onBlur={onBlur} ariaLabel="Session note" level="quick" />);
    expect(screen.getByLabelText("Session note").textContent).toBe("A line");
    await act(async () => { ref.current!.editor!.chain().focus("end").insertContent(" more").run(); });
    expect(onChange.mock.calls.at(-1)![0]).toBe("A line more");
    await act(async () => { ref.current!.editor!.commands.blur(); });
    await waitFor(() => expect(onBlur).toHaveBeenCalled());
  });

  it("re-reads the value only when the key changes, never while typing", async () => {
    const ref = createRef<DocEditorHandle>();
    const { rerender, container } = render(<MarkdownField ref={ref} value="First" docKey="k1" onChange={() => {}} ariaLabel="Notes" />);
    rerender(<MarkdownField ref={ref} value="Replaced" docKey="k1" onChange={() => {}} ariaLabel="Notes" />);
    expect(container.querySelector(".doc-pm")!.textContent).toBe("First");
    rerender(<MarkdownField ref={ref} value="Replaced" docKey="k2" onChange={() => {}} ariaLabel="Notes" />);
    expect(container.querySelector(".doc-pm")!.textContent).toBe("Replaced");
  });
});
