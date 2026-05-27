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
  it("opens the link picker via Add link", () => {
    const onAddLink = vi.fn();
    render(<Connections onAddLink={onAddLink} />);
    fireEvent.click(screen.getByText("Add link"));
    expect(onAddLink).toHaveBeenCalled();
  });
});
