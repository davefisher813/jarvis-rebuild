// THE NOTE SCREEN (the writing system, 2026-09-14): one document under a
// title, Back and More in the header, Delete at the foot (Punch 12), the connections
// and the word count under the writing, and a save line that says only what
// is true. These pin the shape.
// @vitest-environment jsdom
import "../../shared/tiptapTest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import NoteEditor, { footDay, type EditorNote } from "./NoteEditor";
import { blocksToDoc } from "../docModel";
import { setCategoryRegistry } from "../../shared/categories";
import { subscribeToast, resetToasts } from "../../shared/toast";

const NOTE: EditorNote = {
  category: "family",
  eyebrow: "Family",
  title: "Convo with Berto",
  doc: blocksToDoc([
    { id: "h1", type: "heading", text: "Agenda" },
    { id: "c1", type: "checklist", items: [{ text: "Renew lease", done: false }, { text: "Talk pricing", done: true, taskId: "task-9" }] },
    { id: "t1", type: "text", text: "Went with option B." },
  ]),
  attachments: [],
};

const base = { note: NOTE, onBack: () => {}, onDocChange: () => {} };

// THE PRIMARY FIELD OPENS FOCUSED (the Logging Standard, 2026-10-17): a note
// made a moment ago opens with the caret in its body; one opened to read
// stays quiet.
describe("a fresh note opens writing", () => {
  // jsdom will not hold focus on a contenteditable, so what is pinned is the
  // focus call itself landing on the body (ProseMirror focuses its own dom).
  // The editor autofocuses after it mounts (a timeout, then an animation
  // frame), so the test waits for the call rather than counting ticks.
  const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 80)));
  it("fresh puts the caret in the body; a note opened to read does not", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    try {
      const { unmount } = render(<NoteEditor {...base} fresh />);
      const body = document.querySelector(".doc-pm")!;
      expect(body).toBeInTheDocument();
      await waitFor(() => expect(focus.mock.instances, "the body took the caret").toContain(body));
      unmount();
      focus.mockClear();
      render(<NoteEditor {...base} />);
      await settle();
      expect(focus.mock.instances).not.toContain(document.querySelector(".doc-pm"));
    } finally { focus.mockRestore(); }
  });
});

describe("the header", () => {
  // AMENDED 2026-10-31 (Punch 12, Dave: the note's foot is "plain full-width buttons: Convert to Task / Convert to Event /
  // Delete"). Delete left the More menu for the foot; it still asks first, in the same sheet, before it deletes.
  it("is Back and More; Connections, Pin, Tags, Archive and the checklist door live inside More, Delete at the foot", () => {
    const onDeleteNote = vi.fn();
    const onCreateTasks = vi.fn();
    render(<NoteEditor {...base} onDeleteNote={onDeleteNote} onConnections={() => {}} onPin={() => {}} onTags={() => {}} onArchive={() => {}} onCreateTasks={onCreateTasks} />);
    expect(screen.queryByLabelText("Delete note")).toBeNull();
    expect(screen.getByText("Notes", { selector: ".nav-back .back-pill-t" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Note options"));
    const items = screen.getAllByRole("menuitem").map((b) => b.textContent?.trim());
    // The caret opens inside the first section, so the section actions are offered too.
    expect(items).toEqual(["Connections", "Pin Note", "Tags", "Copy As", "Find in Note", "Outline", "Move Section Up", "Move Section Down", "Copy Section", "Make Tasks from Checklist", "Archive"]);
    fireEvent.click(within(document.querySelector(".note-foot-acts") as HTMLElement).getByText("Delete"));
    // The foot's Delete asks first (issue 105); the sheet's destructive button deletes.
    expect(onDeleteNote).not.toHaveBeenCalled();
    fireEvent.click(within(document.querySelector(".action-sheet") as HTMLElement).getByText("Delete Note"));
    expect(onDeleteNote).toHaveBeenCalledTimes(1);
  });

  it("offers the checklist door only when the note has a checklist", () => {
    const plain: EditorNote = { ...NOTE, doc: blocksToDoc([{ id: "t", type: "text", text: "Only words" }]) };
    render(<NoteEditor {...base} note={plain} onCreateTasks={() => {}} onDeleteNote={() => {}} />);
    fireEvent.click(screen.getByLabelText("Note options"));
    expect(screen.queryByText("Make Tasks from Checklist")).toBeNull();
  });
});

describe("the document", () => {
  it("renders as one surface with the note's words, the linked line marked, and the title above it", () => {
    const { container } = render(<NoteEditor {...base} />);
    const pm = container.querySelector(".doc-pm")!;
    expect(pm).toBeInTheDocument();
    expect(pm.textContent).toContain("Agenda");
    expect(pm.textContent).toContain("Went with option B.");
    expect(container.querySelectorAll("ul[data-type='taskList'] li").length).toBe(2);
    expect(container.querySelector("li[data-task-id='task-9']")).toBeInTheDocument();
    // No per-block menus, no repeated cues.
    expect(container.querySelectorAll(".block-menu-btn").length).toBe(0);
    expect(container.textContent).not.toContain("Write Something");
    expect(container.textContent).not.toContain("List Item");
    const html = container.innerHTML;
    expect(html.indexOf("doc-title")).toBeLessThan(html.indexOf("doc-pm"));
  });

  it("counts the words under the page, headings excluded", () => {
    render(<NoteEditor {...base} />);
    expect(screen.getByText(/^8 words$/i)).toBeInTheDocument();
  });
});

describe("Copy", () => {
  it("copies the whole note, title first, and says so only once the clipboard took it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    render(<NoteEditor {...base} />);
    fireEvent.click(screen.getByLabelText("Copy Note"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0]![0] as string;
    expect(text.startsWith("Convo with Berto\n\nAGENDA\n")).toBe(true);
    expect(text).toContain("[x] Talk pricing");
    await waitFor(() => expect(seen).toContain("Note Copied"));
    stop(); resetToasts();
  });

  it("Copy As offers the body, plain text and Markdown", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<NoteEditor {...base} />);
    fireEvent.click(screen.getByLabelText("Note options"));
    fireEvent.click(screen.getByText("Copy As"));
    fireEvent.click(await screen.findByText("Copy as Markdown"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect((writeText.mock.calls[0]![0] as string).startsWith("# Convo with Berto\n\n## Agenda")).toBe(true);
    fireEvent.click(screen.getByLabelText("Note options"));
    fireEvent.click(screen.getByText("Copy As"));
    fireEvent.click(await screen.findByText("Copy Body Only"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect((writeText.mock.calls[1]![0] as string).startsWith("AGENDA")).toBe(true);
    await waitFor(() => expect(document.body.textContent).toBeDefined());
    resetToasts();
  });

  it("when the clipboard refuses, the words open already selected instead of a false confirmation", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    resetToasts();
    const seen: string[] = [];
    let armed = false;
    const stop = subscribeToast((t) => { if (t && armed) seen.push(t.message); });
    armed = true;
    render(<NoteEditor {...base} />);
    fireEvent.click(screen.getByLabelText("Copy Note"));
    const field = await screen.findByLabelText("The note, ready to copy");
    expect((field as HTMLTextAreaElement).value).toContain("Went with option B.");
    // Why, and what to press, as one line in one grey (§AK), drawn as the
    // field's note primitive (R9): .input-hint, never a per-sheet class.
    expect(document.querySelector(".sheet-form .exp-note")).toBeNull();
    const notes = document.querySelectorAll(".sheet-form .input-hint");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent("This browser did not let JARVIS copy, so the words are selected: press Copy on your keyboard or in the menu");
    expect(seen).toEqual([]);
    stop(); resetToasts();
  });

  it("Export opens the sheet on the note", async () => {
    render(<NoteEditor {...base} />);
    fireEvent.click(screen.getByLabelText("Export Note"));
    expect(await screen.findByText("Export Note", { selector: ".eyebrow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /PDF/ })).toBeInTheDocument();
  });
});

describe("Find in Note and the Outline", () => {
  it("counts the matches, steps, and replaces all in one go", async () => {
    render(<NoteEditor {...base} />);
    fireEvent.click(screen.getByLabelText("Note options"));
    fireEvent.click(screen.getByText("Find in Note"));
    const find = await screen.findByLabelText("Find");
    fireEvent.change(find, { target: { value: "lease" } });
    await waitFor(() => expect(screen.getByText("1 of 1")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Replace with"), { target: { value: "contract" } });
    fireEvent.click(screen.getByText("Replace All"));
    await waitFor(() => expect(screen.getByText("None")).toBeInTheDocument());
    expect(document.querySelector(".doc-pm")!.textContent).toContain("Renew contract");
    fireEvent.click(screen.getByLabelText("Close find"));
    expect(screen.queryByLabelText("Find")).toBeNull();
  });

  it("the Outline lists the headings and a tap goes to one", async () => {
    render(<NoteEditor {...base} />);
    fireEvent.click(screen.getByLabelText("Note options"));
    fireEvent.click(screen.getByText("Outline"));
    const row = await screen.findByText("Agenda", { selector: ".doc-outline .conn-name" });
    fireEvent.click(row);
    await waitFor(() => expect(screen.queryByText("Agenda", { selector: ".doc-outline .conn-name" })).toBeNull());
  });
});

describe("JARVIS on a selection", () => {
  const ai = (reply: string) => ({ available: true, complete: vi.fn().mockResolvedValue(reply) }) as unknown as import("../../ai/AIService").AIService;

  // Focus the surface and select the heading's word the way a finger does:
  // through the DOM selection the view watches.
  async function selectAgenda(container: HTMLElement) {
    const pm = container.querySelector(".doc-pm")! as HTMLElement;
    pm.focus();
    fireEvent.focus(pm);
    // The fold chevron sits first inside the heading; the words are the text node.
    const textNode = Array.from(pm.querySelector("h1")!.childNodes).find((n) => n.nodeType === 3)!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 6);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return pm;
  }

  it("offers the bar's JARVIS only with a selection, previews the reply, and Apply replaces the words", async () => {
    const service = ai("Plan");
    const { container } = render(<NoteEditor {...base} ai={service} />);
    const pm = container.querySelector(".doc-pm")! as HTMLElement;
    pm.focus();
    fireEvent.focus(pm);
    await screen.findByRole("toolbar");
    expect(screen.queryByText("JARVIS", { selector: "button" })).toBeNull();
    await selectAgenda(container);
    fireEvent.click(await screen.findByText("JARVIS", { selector: "button" }));
    fireEvent.click(await screen.findByText("Make Clearer"));
    expect(await screen.findByText("Plan", { selector: "pre.ai-result" })).toBeInTheDocument();
    expect(service.complete).toHaveBeenCalledTimes(1);
    expect(String((service.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0][0].content)).toContain("Agenda");
    fireEvent.click(screen.getByText("Apply"));
    await waitFor(() => expect(pm.querySelector("h1")!.textContent).toBe("Plan"));
    expect(screen.queryByText("Plan", { selector: "pre.ai-result" })).toBeNull();
  });

  it("Keep Original changes nothing, and Create Linked Task hands the passage back", async () => {
    const onCreateLinkedTask = vi.fn();
    const { container } = render(<NoteEditor {...base} ai={ai("Anything")} onCreateLinkedTask={onCreateLinkedTask} />);
    const pm = await selectAgenda(container);
    fireEvent.click(await screen.findByText("JARVIS", { selector: "button" }));
    fireEvent.click(await screen.findByText("Shorten"));
    expect(await screen.findByText("Anything", { selector: "pre.ai-result" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Keep Original"));
    expect(pm.querySelector("h1")!.textContent).toBe("Agenda");
    await selectAgenda(container);
    fireEvent.click(await screen.findByText("JARVIS", { selector: "button" }));
    fireEvent.click(await screen.findByText("Create Linked Task"));
    expect(onCreateLinkedTask).toHaveBeenCalledWith("Agenda");
  });
});

describe("Version History", () => {
  it("is offered only when versions exist, lists them newest first, and restores one", async () => {
    const onRestoreVersion = vi.fn();
    const versions = [
      { at: Date.parse("2026-09-13T09:00:00"), doc: blocksToDoc([{ id: "a", type: "text", text: "the first draft here" }]) },
      { at: Date.parse("2026-09-14T15:30:00"), doc: blocksToDoc([{ id: "b", type: "text", text: "a later draft" }]) },
    ];
    const { rerender } = render(<NoteEditor {...base} onRestoreVersion={onRestoreVersion} />);
    fireEvent.click(screen.getByLabelText("Note options"));
    expect(screen.queryByText("Version History")).toBeNull();
    fireEvent.click(screen.getByLabelText("Note options"));
    rerender(<NoteEditor {...base} versions={versions} onRestoreVersion={onRestoreVersion} />);
    fireEvent.click(screen.getByLabelText("Note options"));
    fireEvent.click(screen.getByText("Version History"));
    const rows = await screen.findAllByText(/words$/i, { selector: ".doc-outline .fact" });
    expect(rows.map((r) => r.textContent)).toEqual(["3 Words", "4 Words"]);
    fireEvent.click(rows[0]!);
    expect(await screen.findByText("a later draft", { selector: "pre" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Restore This Version"));
    expect(onRestoreVersion).toHaveBeenCalledWith(versions[1]!.at);
  });
});

describe("the save line", () => {
  it("says what is true and offers Retry only on a failure", () => {
    const onRetrySave = vi.fn();
    const { rerender } = render(<NoteEditor {...base} saveState="saving" />);
    expect(screen.getByRole("status")).toHaveTextContent("Saving");
    rerender(<NoteEditor {...base} saveState="saved" />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved on device");
    rerender(<NoteEditor {...base} saveState="synced" />);
    expect(screen.getByRole("status")).toHaveTextContent("Synced");
    expect(screen.queryByText("Retry")).toBeNull();
    rerender(<NoteEditor {...base} saveState="failed" onRetrySave={onRetrySave} />);
    expect(screen.getByRole("status")).toHaveTextContent("Couldn't save");
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetrySave).toHaveBeenCalled();
  });
});

describe("the connection strip, under the writing now", () => {
  const CONNS = [
    { id: "c1", kind: "task", label: "Follow Up Call", targetId: "t1" },
    { id: "c2", kind: "project", label: "Berto Contract", targetId: "p1" },
  ];

  it("shows a chip per connection and a + even with nothing linked, and stays gone with neither", () => {
    const { rerender, container } = render(<NoteEditor {...base} connections={CONNS} onAddLink={() => {}} />);
    expect(container.querySelectorAll(".note-conn").length).toBe(2);
    expect(container.querySelector(".note-conn-add")).toBeInTheDocument();
    const html = container.innerHTML;
    expect(html.indexOf("doc-pm")).toBeLessThan(html.indexOf("note-conns"));

    rerender(<NoteEditor {...base} connections={[]} onAddLink={() => {}} />);
    expect(container.querySelectorAll(".note-conn").length).toBe(0);
    expect(container.querySelector(".note-conn-add")).toBeInTheDocument();

    rerender(<NoteEditor {...base} connections={[]} />);
    expect(container.querySelector(".note-conns")).toBeNull();
  });

  it("the + opens the picker, the X unlinks, and a tap on a chip navigates", () => {
    const onAddLink = vi.fn();
    const onRemoveConnection = vi.fn();
    const onOpenConnection = vi.fn();
    render(<NoteEditor {...base} connections={CONNS} onAddLink={onAddLink} onRemoveConnection={onRemoveConnection} onOpenConnection={onOpenConnection} />);
    fireEvent.click(screen.getByLabelText("Link Something"));
    expect(onAddLink).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Unlink Follow Up Call"));
    expect(onRemoveConnection).toHaveBeenCalledWith("c1");
    fireEvent.click(screen.getByText("Berto Contract"));
    expect(onOpenConnection).toHaveBeenCalledWith("project", "p1");
  });
});

// THE COLOUR KEY ON THE NOTE SCREEN (§AK, §AL, §AM; 2026-09-26). Colour is
// for meaning: the area's hue rides its dot and never its name, a file's
// kind has no key colour, the tags are one run of the line's one grey, and
// the find bar's verbs that change the words are the red capsule.
describe("the Colour Key on the note screen", () => {
  // AMENDED 2026-10-31 (Punch 12): the area eyebrow above the title became the Whole Day line under it (pinned in "the
  // open note" below). The rule this pinned holds there: the hue rides the chip's dot, the name stays grey.
  it("the area's name stays grey beside its dot", () => {
    const { container } = render(<NoteEditor {...base} />);
    const chip = container.querySelector(".note-whole-day .cat-chip")!;
    expect(chip).toHaveTextContent("Family");
    expect(chip.className).not.toMatch(/cat-fg-/);
    expect(chip.querySelector(".cat-chip-dot")).toBeInTheDocument();
    expect(container.querySelector(".doc-eyebrow")).toBeNull();
  });

  it("an attachment's glyph takes the neutral glyph ink, not red or blue", () => {
    const note: EditorNote = { ...NOTE, attachments: [
      { id: "a1", type: "file", name: "Invoice.pdf", size: "240 KB" },
      { id: "a2", type: "photo", name: "IMG_2231.jpg", size: "1.2 MB" },
    ] };
    const { container } = render(<NoteEditor {...base} note={note} />);
    expect(container.querySelectorAll(".list-card-ruled .lead-ink")).toHaveLength(2);
    expect(container.querySelector(".fg-red, .fg-blue")).toBeNull();
  });

  it("the tags are one run on their line", () => {
    const { container } = render(<NoteEditor {...base} tags={["work", "ideas"]} />);
    const facts = container.querySelectorAll(".note-tags .fact");
    expect(facts).toHaveLength(1);
    expect(facts[0]).toHaveTextContent("#work #ideas");
  });

  it("Replace and Replace All are the red capsule; stepping and closing stay quiet", async () => {
    render(<NoteEditor {...base} />);
    fireEvent.click(screen.getByLabelText("Note options"));
    fireEvent.click(screen.getByText("Find in Note"));
    await screen.findByLabelText("Find");
    for (const name of ["Replace", "Replace All"]) {
      const b = screen.getByText(name, { selector: "button" });
      expect(b).toHaveClass("pill-act");
      expect(b).not.toHaveClass("pill-quiet");
    }
    expect(screen.getByLabelText("Next match")).toHaveClass("pill-quiet");
  });
});

// CLEAN ROWS (Dave 2026-10-05, locked: no pill in a row). A candidate JARVIS found used to wear an Add or a Link capsule; it is a
// row whose tap does that one verb, with a glyph at its edge saying which.
describe("JARVIS Found", () => {
  it("is clean rows: the tap adds or links, and no capsule sits in the card", () => {
    const onFoundAdd = vi.fn();
    const onFoundLink = vi.fn();
    const found = [
      { kind: "task", text: "Renew the lease", due: "Oct 9" },
      { kind: "person", text: "Berto" },
    ] as unknown as Parameters<typeof NoteEditor>[0]["found"];
    const { container } = render(<NoteEditor {...base} found={found} onFoundAdd={onFoundAdd} onFoundLink={onFoundLink} />);
    expect(container.querySelector(".card .pill-act")).toBeNull();
    expect(container.querySelectorAll(".row-verb-ic").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Add Renew the lease" }));
    expect(onFoundAdd).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "Link Berto" }));
    expect(onFoundLink).toHaveBeenCalledWith(1);
  });
});

// PUNCH 12 (Dave 2026-10-31, the open note from Direction A): the Whole Day line directly under the title and before the
// body (the area as the unified chip, the project's name after it in grey, nothing without an area); then the body; at the
// foot a details line (Note, the area, created, edited) and three plain full-width buttons.
describe("the open note (Punch 12)", () => {
  const NOW = new Date(2026, 9, 31, 15, 0, 0);
  const KIDS: EditorNote = { ...NOTE, category: "c-kids" };
  const setup = () => setCategoryRegistry([{ id: "c-kids", name: "Kids", color: "green" }]);

  it("draws the Whole Day line directly under the title, before the body: the chip, then the project in grey", () => {
    setup();
    const { container } = render(<NoteEditor {...base} note={KIDS} projectName="Spring Season" />);
    const title = container.querySelector(".doc-write .doc-title")!;
    const line = title.nextElementSibling!;
    expect(line).toHaveClass("note-whole-day");
    // The Whole Day rows' own piece (rowChip WholeDayChip > CatChipLine), not a new one.
    expect(line.querySelector(":scope > .r-k > .r-goal.r-parent > .cat-chip")).toHaveTextContent("Kids");
    expect(line.querySelector(".cat-chip-dot")).toHaveClass("cat-bg-green");
    expect(line.querySelector(".r-goal-t")).toHaveTextContent("Spring Season");
    const body = container.querySelector(".doc-pm")!;
    expect(line.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING, "the body comes after the line").toBeTruthy();
    expect(line.textContent).not.toMatch(/·/);
  });

  it("an area without a project is the chip alone; no area is no line at all", () => {
    setup();
    const { container, unmount } = render(<NoteEditor {...base} note={KIDS} />);
    expect(container.querySelector(".note-whole-day .cat-chip")).toHaveTextContent("Kids");
    expect(container.querySelector(".note-whole-day .r-goal-t")).toBeNull();
    unmount();
    const { container: c2 } = render(<NoteEditor {...base} note={{ ...NOTE, category: "" }} projectName="Spring Season" />);
    expect(c2.querySelector(".note-whole-day")).toBeNull();
    expect(c2.querySelector(".doc-write .cat-chip")).toBeNull();
  });

  it("the details footer reads Note, the area, created and edited, as fact spans with no typed dot", () => {
    setup();
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      const created = new Date(2026, 9, 3, 9).getTime();
      const edited = new Date(2026, 9, 31, 11).getTime();
      const { container } = render(<NoteEditor {...base} note={KIDS} created={created} edited={edited} />);
      const facts = [...container.querySelectorAll(".note-details .facts > .fact")];
      expect(facts.map((f) => f.textContent)).toEqual(["Note", "Kids", "Created Oct 3", "Edited Today"]);
      expect(facts.map((f) => f.className)).toEqual(["fact date", "fact", "fact date", "fact date"]);
      expect(container.querySelector(".note-details")!.textContent).not.toMatch(/·/);
      // It sits at the foot: after the body, before the buttons.
      const foot = container.querySelector(".note-details")!;
      expect(container.querySelector(".doc-pm")!.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the footer says No Area for an unfiled note and leaves out a date the store cannot give", () => {
    setup();
    const { container } = render(<NoteEditor {...base} note={{ ...NOTE, category: "" }} />);
    expect([...container.querySelectorAll(".note-details .fact")].map((f) => f.textContent)).toEqual(["Note", "No Area"]);
  });

  it("footDay reads the calendar and names another year", () => {
    expect(footDay(new Date(2026, 9, 31, 0, 5).getTime(), NOW)).toBe("Today");
    expect(footDay(new Date(2026, 9, 30, 23).getTime(), NOW)).toBe("Yesterday");
    expect(footDay(new Date(2026, 9, 3).getTime(), NOW)).toBe("Oct 3");
    expect(footDay(new Date(2025, 11, 31).getTime(), NOW)).toBe("Dec 31, 2025");
    expect(footDay(undefined, NOW)).toBe("");
  });

  it("the foot is three plain full-width buttons in order, Convert to Task, Convert to Event, Delete; Delete asks first", () => {
    setup();
    const onConvertToTask = vi.fn();
    const onConvertToEvent = vi.fn();
    const onDeleteNote = vi.fn();
    const { container } = render(<NoteEditor {...base} note={KIDS} onConvertToTask={onConvertToTask} onConvertToEvent={onConvertToEvent} onDeleteNote={onDeleteNote} />);
    const acts = container.querySelector(".note-foot-acts")!;
    const buttons = [...acts.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Convert to Task", "Convert to Event", "Delete"]);
    for (const b of buttons) {
      expect(b).toHaveClass("btn", "btn-block");
      expect(b).not.toHaveClass("pill-act");
      expect(b).not.toHaveClass("btn-primary");
    }
    // The foot comes after the details line, at the very end of the note.
    expect(container.querySelector(".note-details")!.compareDocumentPosition(acts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(buttons[0]!);
    expect(onConvertToTask).toHaveBeenCalledTimes(1);
    fireEvent.click(buttons[1]!);
    expect(onConvertToEvent).toHaveBeenCalledTimes(1);
    fireEvent.click(buttons[2]!);
    expect(onDeleteNote, "nothing is deleted before the sheet's own Delete Note").not.toHaveBeenCalled();
    fireEvent.click(within(document.querySelector(".action-sheet") as HTMLElement).getByText("Delete Note"));
    expect(onDeleteNote).toHaveBeenCalledTimes(1);
  });
});
