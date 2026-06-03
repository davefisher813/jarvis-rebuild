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
    fireEvent.change(screen.getByPlaceholderText("Category name"), { target: { value: "Travel" } });
    fireEvent.click(screen.getByLabelText("green"));
    fireEvent.click(screen.getByLabelText("heart"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ name: "Travel", color: "green", icon: "heart" });
  });

  it("edit mode prefills and offers delete", () => {
    const onDelete = vi.fn();
    render(
      <CategorySheet mode="edit" initial={{ name: "Work", color: "blue", icon: "briefcase" }} onSave={() => {}} onDelete={onDelete} onCancel={() => {}} />,
    );
    expect((screen.getByPlaceholderText("Category name") as HTMLInputElement).value).toBe("Work");
    fireEvent.click(screen.getByText("Delete Category"));
    expect(onDelete).toHaveBeenCalled();
  });
});
