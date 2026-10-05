// @vitest-environment jsdom
// The Edit Task sheet's first card has a kicker like every other group (Dave 2026-10-05, the round-2 review: it was the one card with
// no label), and the Notes hint reads as a hint (italic) rather than a value.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import "../../shared/tiptapTest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TaskSheet from "./TaskSheet";

describe("Edit Task: the quick actions card", () => {
  it("is labelled Quick Actions, directly above its card, in edit mode only", () => {
    const { unmount } = render(<TaskSheet mode="edit" categories={[]} initial={{ text: "Pay rent" }} onSave={() => {}} onCancel={() => {}} onMove={() => {}} />);
    const kicker = screen.getByText("Quick Actions");
    expect(kicker).toHaveClass("eyebrow");
    expect(kicker.closest(".grp")?.nextElementSibling?.querySelector(".xs-do")).not.toBeNull();
    unmount();
    render(<TaskSheet mode="new" categories={[]} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Quick Actions")).toBeNull();
  });

  it("the Notes hint is italic, so an empty field does not read as a filled one", () => {
    const css = readFileSync(join(__dirname, "../../styles/ruled.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.task-notes \.doc-pm p\.is-editor-empty:first-child::before\s*\{\s*font-style: italic;/);
  });
});
