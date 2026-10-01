// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import RemoveSavingsSheet, { removeSavingsLines } from "./RemoveSavingsSheet";

const all = [{ d: "2026-07-01", amount: 500 }, { d: "2026-06-01", amount: 100 }];

describe("removeSavingsLines", () => {
  it("says the entry and what the total becomes, from the entries", () => {
    const { what, goes } = removeSavingsLines(all[0]!, all);
    expect(what).toBe("$500 on Jul 1");
    expect(goes).toEqual(["The $500 entry", "Saved goes from $600 to $100"]);
  });
});

describe("RemoveSavingsSheet", () => {
  it("removes only on the destructive button; Cancel only cancels", () => {
    const onRemove = vi.fn();
    const onCancel = vi.fn();
    render(<RemoveSavingsSheet entry={all[0]!} all={all} onRemove={onRemove} onCancel={onCancel} />);
    expect(screen.getByRole("dialog", { name: "Remove $500 on Jul 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove Entry" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("locks both buttons while pending", () => {
    render(<RemoveSavingsSheet entry={all[0]!} all={all} pending onRemove={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Removing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
