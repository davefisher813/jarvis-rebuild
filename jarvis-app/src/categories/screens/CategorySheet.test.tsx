// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import CategorySheet from "./CategorySheet";

describe("CategorySheet", () => {
  it("requires a name before saving", () => {
    const onSave = vi.fn();
    render(<CategorySheet mode="new" onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Add a category name.")).toBeInTheDocument();
  });

  it("saves the chosen name, color and icon", () => {
    const onSave = vi.fn();
    render(<CategorySheet mode="new" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Area Name"), { target: { value: "Travel" } });
    fireEvent.click(screen.getByLabelText("green"));
    fireEvent.click(screen.getByLabelText("heart"));
    fireEvent.click(screen.getByText("Save"));
    // kind defaults to plain for an unrecognized name; org settings unset off-org
    expect(onSave).toHaveBeenCalledWith({ name: "Travel", color: "green", icon: "heart", kind: "plain", season: undefined, workHours: undefined });
  });

  // B12's fix (MoneyFlow's Account/Payday sheets), generalized: Save used to
  // fire onSave every tap, so a fast double-tap wrote the area twice.
  it("a fast double-tap on Save only fires once, and the button says so", () => {
    const onSave = vi.fn();
    render(<CategorySheet mode="new" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Area Name"), { target: { value: "Travel" } });
    const save = screen.getByText("Save");
    fireEvent.click(save);
    expect(save).toHaveTextContent("Saving");
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("edit mode prefills and offers delete", () => {
    const onDelete = vi.fn();
    render(
      <CategorySheet mode="edit" initial={{ name: "Work", color: "blue", icon: "briefcase" }} onSave={() => {}} onDelete={onDelete} onCancel={() => {}} />,
    );
    expect((screen.getByPlaceholderText("Area Name") as HTMLInputElement).value).toBe("Work");
    // Armed two-tap (2026-08-09): the first tap only arms, because this
    // delete orphans everything tagged with the category.
    fireEvent.click(screen.getByText("Delete Category"));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Tap Again to Delete"));
    expect(onDelete).toHaveBeenCalled();
  });
});
