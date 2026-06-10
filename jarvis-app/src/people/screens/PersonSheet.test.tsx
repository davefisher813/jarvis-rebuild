// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import PersonSheet from "./PersonSheet";

describe("PersonSheet", () => {
  it("requires a name", () => {
    const onSave = vi.fn();
    render(<PersonSheet mode="new" group="inner_circle" onSave={onSave} onCancel={() => {}} />);
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Add a name.")).toBeInTheDocument();
  });

  it("saves the entered fields", () => {
    const onSave = vi.fn();
    render(<PersonSheet mode="new" group="contacts" onSave={onSave} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Full name"), { target: { value: "Sam Rivera" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. Business partner"), { target: { value: "Partner" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({ name: "Sam Rivera", relationship: "Partner", birthday: "", notes: "", color: "red" });
  });

  it("edit mode prefills and offers delete", () => {
    const onDelete = vi.fn();
    render(<PersonSheet mode="edit" group="inner_circle" initial={{ name: "Dev", group: "inner_circle", notes: "x", color: "red" }} onSave={() => {}} onDelete={onDelete} onCancel={() => {}} />);
    expect((screen.getByPlaceholderText("Full name") as HTMLInputElement).value).toBe("Dev");
    fireEvent.click(screen.getByText("Delete Person"));
    expect(onDelete).toHaveBeenCalled();
  });
});
