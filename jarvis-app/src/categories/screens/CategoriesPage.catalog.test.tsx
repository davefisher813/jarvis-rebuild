// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import CategoriesPage from "./CategoriesPage";
import type { Category } from "../types";

// THE CATALOG GATE for the Areas settings page (Dave 2026-10-05, locked): a section-level action lives in the section
// head, never inside a card or at the foot of a list, and an action never sits alone in a box (the grey rectangle round
// Add Area, Alfred's list and the lone-box measurement). An area's name is shown in Title Case, as he typed it or not.
const cat = (id: string, name: string): Category => ({ id, data: { name, color: "blue" } } as Category);
const draw = (cats: Category[], onAdd = vi.fn()) =>
  render(<CategoriesPage categories={cats} onEdit={() => {}} onAdd={onAdd} onBack={() => {}} />);

describe("CategoriesPage: the catalog", () => {
  it("Add Area is the capsule on the Your Areas head, and runs the add", () => {
    const onAdd = vi.fn();
    const { container } = draw([cat("a", "health")], onAdd);
    const add = screen.getByRole("button", { name: "Add Area" });
    expect(add).toHaveClass("see-all", "pill-action");
    expect(add.closest(".sh2")!.querySelector(".t")).toHaveTextContent("Your Areas");
    expect(container.querySelectorAll(".row-act")).toHaveLength(0);
    expect(add.closest(".card")).toBeNull();
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("with no areas there is the head and its capsule, and no card at all, let alone one holding only the button", () => {
    const { container } = draw([]);
    expect(screen.getByRole("button", { name: "Add Area" })).toBeInTheDocument();
    expect(container.querySelectorAll(".card, .list-card-ruled")).toHaveLength(0);
  });

  it("shows each area's name in Title Case", () => {
    draw([cat("a", "side hustle"), cat("b", "javris")]);
    expect(screen.getByText("Side Hustle")).toBeInTheDocument();
    expect(screen.getByText("Javris")).toBeInTheDocument();
  });
});
