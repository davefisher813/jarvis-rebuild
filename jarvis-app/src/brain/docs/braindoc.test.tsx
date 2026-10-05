// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import "../../shared/tiptapTest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Store, InMemoryAdapter } from "@core";
import { BrainDocService } from "./BrainDocService";
import { NotesProvider } from "../../data/NotesProvider";
import BrainDocPage from "./BrainDocPage";

describe("BrainDocService", () => {
  it("saves once per topic and reads it back", async () => {
    const store = new Store(new InMemoryAdapter());
    const svc = new BrainDocService(store, "u1");
    expect(await svc.get("values")).toBe("");
    await svc.save("values", "Family first.");
    await svc.save("values", "Family first. Always.");
    expect(await svc.get("values")).toBe("Family first. Always.");
    expect((await store.listForUser("u1")).filter((i) => i.entityType === "brain_doc").length).toBe(1);
  });
});

describe("BrainDocPage", () => {
  it("edits and saves a topic", async () => {
    render(
      <NotesProvider userId="u1">
        <BrainDocPage topic="writing" onBack={() => {}} />
      </NotesProvider>,
    );
    expect(screen.getAllByText("How You Write").length).toBeGreaterThan(0);
    // A page with nothing written is a crafted empty state with ONE way in (Dave 2026-10-05: "he opens the app and finds
    // nothing"); Start Writing opens the editor card and its caret.
    expect(await screen.findByText("Teach JARVIS Your Voice")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Start Writing"));
    // The writing system (wave 3c): the shared editor on the document
    // level; its cue is the topic's placeholder (Title Case, no typed dots), its name the topic's title.
    const pm = await screen.findByLabelText("How You Write");
    expect(pm.querySelector("p")).toHaveAttribute("data-placeholder", "Tone, Style, and Words You Use and Avoid");
    // C-16 (Astra, 2026-09-12): no Save button; the canvas saves on blur.
    const spy = vi.spyOn(BrainDocService.prototype, "save");
    try {
      await act(async () => { pm.querySelector("p")!.textContent = "Short and direct."; });
      await waitFor(() => expect(pm.textContent).toContain("Short and direct."));
      expect(screen.queryByText("Save")).toBeNull();
      fireEvent.blur(pm);
      await waitFor(() => expect(spy).toHaveBeenCalledWith("writing", "Short and direct.", undefined));
    } finally { spy.mockRestore(); }
  });
});

// BRAIN-F-12 (2026-09-05): the loader had no catch, so one failed read left
// this page greyed out for good: `loaded` never flipped, the writing surface
// stayed disabled, and nothing said why or offered another go.
import { subscribeToast } from "../../shared/toast";

describe("BrainDocPage load failure (BRAIN-F-12)", () => {
  it("says the read failed and offers Try Again, which loads it", async () => {
    const seen: string[] = [];
    const stop = subscribeToast((t) => { if (t) seen.push(t.message); });
    const spy = vi.spyOn(BrainDocService.prototype, "get").mockRejectedValueOnce(new Error("offline"));
    try {
      render(
        <NotesProvider userId="u-doc-f12">
          <BrainDocPage topic="writing" onBack={() => {}} />
        </NotesProvider>,
      );
      await waitFor(() => expect(screen.getByText("Try Again")).toBeInTheDocument());
      // Casing sweep 3 (2026-09-27): Title Case by the whole rule (§H2); durations through shared/duration ("45 Min", "About 1 Min").
      expect(seen).toContain("Couldn't Load · Check Your Connection");
      // No writing surface until the words are read: nothing to type into
      // that would be lost.
      expect(screen.queryByLabelText("How You Write")).toBeNull();

      // The next read works, and the page is a page again.
      fireEvent.click(screen.getByText("Try Again"));
      await waitFor(() => expect(screen.queryByText("Try Again")).not.toBeInTheDocument());
      // Read, and empty: the page's own empty state, and the editor opens on Start Writing.
      fireEvent.click(await screen.findByText("Start Writing"));
      expect(await screen.findByLabelText("How You Write")).toHaveAttribute("contenteditable", "true");
    } finally {
      spy.mockRestore();
      stop();
    }
  });
});

// EVERY BRAIN DOC OPENS ON SOMETHING (Dave 2026-10-05, the review: Life Philosophy and How You Write were blank pages from the
// title to the dock, and the subtitle was a lowercase fragment with typed dots). Each empty doc is the app's empty state: its
// glyph in the Brain's own tone, a Title Case title of its OWN, one line, the one capsule that fills it. No subtitle fragment, no
// typed dot. ROUND 2 (2026-10-05): the three pages no longer share one generic title, and the glyph is never brand red (the pen was
// a coral that read as a button).
describe("BrainDocPage: an empty doc is crafted, never blank (2026-10-05)", () => {
  for (const [topic, title, emptyTitle] of [
    ["philosophy", "Life Philosophy", "Your Philosophy Starts Here"],
    ["writing", "How You Write", "Teach JARVIS Your Voice"],
    ["values", "Values", "Say What Matters"],
  ] as const) {
    it(`${title}: a purple glyph, its own title, one line and Start Writing`, async () => {
      const { container } = render(
        <NotesProvider userId={"u-empty-" + topic}>
          <BrainDocPage topic={topic} onBack={() => {}} />
        </NotesProvider>,
      );
      const empty = await waitFor(() => {
        const e = container.querySelector(".empty-state");
        expect(e).not.toBeNull();
        return e!;
      });
      expect(empty.querySelector(".empty-icon")!.className).toContain("cat-fg-purple");
      expect(empty.querySelector(".empty-icon")!.className).not.toMatch(/cat-fg-(red|pink|coral|rose)/);
      expect(empty.querySelector(".empty-icon svg")).not.toBeNull();
      expect(empty.querySelector(".empty-title")!.textContent).toBe(emptyTitle);
      const sub = empty.querySelector(".empty-sub")!.textContent!;
      expect(sub).not.toMatch(/\u00b7/);
      expect(sub).not.toMatch(/\.\s+[A-Z]/);
      // Title Case: every word of the line starts with a capital or is a small joining word.
      expect(sub.split(" ").every((w) => /^[A-Z0-9]/.test(w) || ["a", "an", "and", "of", "in", "on", "to", "the", "or"].includes(w))).toBe(true);
      expect(empty.querySelector("button")!.textContent).toBe("Start Writing");
      // The page carries no grey subtitle fragment under its title.
      expect(container.querySelector(".pagehead-sub, .page-sub")).toBeNull();
      expect(container.textContent).not.toMatch(/Worldview \u00b7|Tone \u00b7|What matters \u00b7/);
    });
  }

  it("a page with nothing else on it centres its empty state in the room left; Values keeps its Hard Lines in view", async () => {
    const alone = render(<NotesProvider userId="u-fill-1"><BrainDocPage topic="philosophy" onBack={() => {}} /></NotesProvider>);
    await waitFor(() => expect(alone.container.querySelector(".empty-state")).not.toBeNull());
    expect(alone.container.querySelector(".doc-body > .empty-state.empty-fill")).not.toBeNull();
    alone.unmount();
    const values = render(<NotesProvider userId="u-fill-2"><BrainDocPage topic="values" onBack={() => {}} /></NotesProvider>);
    await waitFor(() => expect(values.container.querySelector(".empty-state")).not.toBeNull());
    expect(values.container.querySelector(".empty-state.empty-fill")).toBeNull();
    expect(values.container.querySelector(".empty-state.empty-compact")).not.toBeNull();
  });
});
