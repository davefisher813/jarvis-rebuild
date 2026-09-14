// MARKDOWN AND PLAIN TEXT, BOTH WAYS (the writing system, wave 2).
import { describe, it, expect } from "vitest";
import { docToMarkdown, docToPlainText, parseMarkdown, looksLikeMarkdown, textToParagraphs, parseInlineMarkdown } from "./markdown";
import { blocksToDoc } from "./docModel";

const DOC = blocksToDoc([
  { id: "h", type: "heading", text: "Agenda" },
  { id: "t", type: "text", text: "Went with **option B** and *not* A." },
  { id: "c", type: "checklist", items: [{ text: "Renew lease", done: false }, { text: "Talk pricing", done: true }] },
  { id: "l", type: "bulleted_list", items: ["Milk", "Eggs"] },
  { id: "n", type: "numbered_list", items: ["First", "Second"] },
  { id: "q", type: "quote", text: "A line worth keeping" },
  { id: "d", type: "divider" },
  { id: "tb", type: "table", columns: ["Item", "Cost"], rows: [["Rent", "1200"]] },
]);

describe("the document as Markdown", () => {
  it("writes the title once as the top heading and steps the body headings under it", () => {
    const md = docToMarkdown(DOC, { title: "Convo with Berto" });
    expect(md.startsWith("# Convo with Berto\n\n## Agenda\n")).toBe(true);
    expect(md).toContain("Went with **option B** and *not* A.");
    expect(md).toContain("- [ ] Renew lease\n- [x] Talk pricing");
    expect(md).toContain("- Milk\n- Eggs");
    expect(md).toContain("1. First\n2. Second");
    expect(md).toContain("> A line worth keeping");
    expect(md).toContain("\n---\n");
    expect(md).toContain("| Item | Cost |\n| --- | --- |\n| Rent | 1200 |");
    expect(docToMarkdown(DOC, { title: "Convo", includeTitle: false }).startsWith("## Agenda")).toBe(true);
  });

  it("keeps a nested list nested and a link as a link", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Parent" }] }, { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Child" }] }] }] }] }] },
        { type: "paragraph", content: [{ type: "text", text: "See ", }, { type: "text", text: "the site", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] },
      ],
    };
    const md = docToMarkdown(doc);
    expect(md).toContain("- Parent\n  - Child");
    expect(md).toContain("See [the site](https://example.com)");
  });
});

describe("the document as plain text", () => {
  it("reads as words with simple markers and the title first", () => {
    const t = docToPlainText(DOC, { title: "Convo with Berto" });
    expect(t.startsWith("Convo with Berto\n\nAGENDA\n")).toBe(true);
    expect(t).toContain("Went with option B and not A.");
    expect(t).toContain("[ ] Renew lease\n[x] Talk pricing");
    expect(t).toContain("• Milk\n• Eggs");
    expect(t).toContain("Rent  |  1200");
  });
});

describe("Markdown back into a document", () => {
  it("parses headings, lists, checklists, quotes, code and a table", () => {
    const nodes = parseMarkdown([
      "# Title", "", "Some **bold** and a [link](https://x.y).", "", "- one", "- two", "  - nested", "", "1. first", "2. second", "",
      "- [ ] open", "- [x] done", "", "> quoted", "", "```js", "let a = 1;", "```", "", "| A | B |", "| --- | --- |", "| 1 | 2 |",
    ].join("\n"));
    expect(nodes.map((n) => n.type)).toEqual(["heading", "paragraph", "bulletList", "orderedList", "taskList", "blockquote", "codeBlock", "table"]);
    expect(nodes[1]!.content!.map((t) => [t.text, t.marks?.[0]?.type])).toEqual([["Some ", undefined], ["bold", "bold"], [" and a ", undefined], ["link", "link"], [".", undefined]]);
    expect(nodes[2]!.content![1]!.content![1]!.type).toBe("bulletList");
    expect(nodes[4]!.content!.map((li) => li.attrs?.checked)).toEqual([false, true]);
    expect(nodes[6]!.content![0]!.text).toBe("let a = 1;");
    expect(nodes[7]!.content![0]!.content![0]!.type).toBe("tableHeader");
  });

  it("round-trips its own output", () => {
    const md = docToMarkdown(DOC, { includeTitle: false });
    const again = docToMarkdown({ type: "doc", content: parseMarkdown(md) }, { includeTitle: false });
    expect(again).toBe(md);
  });

  it("knows what reads as Markdown and what is only text", () => {
    expect(looksLikeMarkdown("## Plan\n- one\n- two")).toBe(true);
    expect(looksLikeMarkdown("Call Berto about the lease")).toBe(false);
    expect(looksLikeMarkdown("- one line with a dash")).toBe(false);
    expect(textToParagraphs("a\n\nb\n").map((p) => p.content![0]!.text)).toEqual(["a", "b"]);
    expect(parseInlineMarkdown("plain")).toEqual([{ type: "text", text: "plain" }]);
  });
});
