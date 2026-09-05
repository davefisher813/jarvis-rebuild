// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    const ta = await screen.findByPlaceholderText(/Tone · style/i);
    fireEvent.change(ta, { target: { value: "Short and direct." } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });
});

// BRAIN-F-12 (2026-09-05): the loader had no catch, so one failed read left
// this page greyed out for good: `loaded` never flipped, the writing surface
// stayed disabled, and nothing said why or offered another go.
import { vi } from "vitest";
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
      expect(await screen.findByPlaceholderText(/Tone · style/i)).toBeDisabled();

      // The next read works, and the page is a page again.
      fireEvent.click(screen.getByText("Try Again"));
      await waitFor(() => expect(screen.queryByText("Try Again")).not.toBeInTheDocument());
      expect(screen.getByPlaceholderText(/Tone · style/i)).not.toBeDisabled();
    } finally {
      spy.mockRestore();
      stop();
    }
  });
});
