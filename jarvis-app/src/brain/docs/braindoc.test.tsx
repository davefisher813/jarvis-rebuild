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
    // The writing system (wave 3c): the shared editor on the document
    // level; its cue is the topic's placeholder, its name the topic's title.
    const pm = await screen.findByLabelText("How You Write");
    expect(pm.querySelector("p")).toHaveAttribute("data-placeholder", expect.stringMatching(/Tone · style/i));
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
      expect(seen).toContain("Couldn't load · Check your connection");
      // No writing surface until the words are read: nothing to type into
      // that would be lost.
      expect(screen.queryByLabelText("How You Write")).toBeNull();

      // The next read works, and the page is a page again.
      fireEvent.click(screen.getByText("Try Again"));
      await waitFor(() => expect(screen.queryByText("Try Again")).not.toBeInTheDocument());
      expect(await screen.findByLabelText("How You Write")).toHaveAttribute("contenteditable", "true");
    } finally {
      spy.mockRestore();
      stop();
    }
  });
});
