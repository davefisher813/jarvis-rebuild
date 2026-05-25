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
    expect(screen.getByText("How You Write")).toBeInTheDocument();
    const ta = await screen.findByPlaceholderText(/tone and style/i);
    fireEvent.change(ta, { target: { value: "Short and direct." } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });
});
