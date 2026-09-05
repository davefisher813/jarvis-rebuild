// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import Connections from "./Connections";

describe("note Connections", () => {
  it("shows the real category and no fabricated links", () => {
    render(<Connections category="health" categoryLabel="Health" />);
    expect(screen.getByText("Health")).toBeTruthy();
    expect(screen.queryByText("Long Run Sunday")).toBeNull();
  });
  it("renders real connections and removes one", () => {
    const onRemove = vi.fn();
    render(
      <Connections
        category="health"
        categoryLabel="Health"
        connections={[{ id: "c1", kind: "event", label: "Kickoff" }]}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText("Kickoff")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove link"));
    expect(onRemove).toHaveBeenCalledWith("c1");
  });
  // HMN-F-17 (2026-09-05): a note is born unfiled and its category is "", so
  // the Area row read "Area" with nothing beside it, and the picker had no
  // way back to unfiled: only the list's swipe File sheet offered it.
  it("an unfiled note says Not Filed, and the picker can put it back", () => {
    const onChangeCategory = vi.fn();
    render(
      <Connections
        category=""
        categoryLabel="Not Filed"
        categories={[{ id: "health", name: "Health" }]}
        onChangeCategory={onChangeCategory}
      />,
    );
    expect(screen.getByText("Not Filed")).toBeTruthy();
    fireEvent.click(screen.getByText("Area"));
    // Not Filed leads the picker, marked as where the note is now.
    expect(screen.getAllByText("Not Filed")).toHaveLength(2);
    expect(screen.getByText("Current")).toBeTruthy();
    fireEvent.click(screen.getAllByText("Not Filed")[1]!);
    expect(onChangeCategory).toHaveBeenCalledWith("");
  });

  it("opens the link picker via Add link", () => {
    const onAddLink = vi.fn();
    render(<Connections onAddLink={onAddLink} />);
    fireEvent.click(screen.getByText("Add Link"));
    expect(onAddLink).toHaveBeenCalled();
  });
});
