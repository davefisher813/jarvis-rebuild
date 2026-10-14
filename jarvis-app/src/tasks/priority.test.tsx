// @vitest-environment jsdom
// Task priority (Dave, 2026-10-13): the sheet control, the marker and the High-first order.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "../shared/tiptapTest";
import { highFirst, isHigh, PriorityFlag } from "./priority";
import TaskSheet, { type TaskDraft } from "./screens/TaskSheet";

const it_ = (id: string, priority?: "high" | "low") => ({ id, data: { priority } });

describe("highFirst", () => {
  it("puts High first and keeps every other order exactly as it was", () => {
    const list = [it_("a"), it_("b", "low"), it_("c", "high"), it_("d"), it_("e", "high")];
    expect(highFirst(list).map((x) => x.id)).toEqual(["c", "e", "a", "b", "d"]);
  });
  it("leaves a list with no High alone, and does not mutate", () => {
    const list = [it_("a", "low"), it_("b")];
    expect(highFirst(list).map((x) => x.id)).toEqual(["a", "b"]);
    expect(highFirst(list)).not.toBe(list);
  });
  it("only High counts", () => {
    expect(isHigh(it_("a", "low"))).toBe(false);
    expect(isHigh(it_("a"))).toBe(false);
    expect(isHigh(it_("a", "high"))).toBe(true);
  });
});

describe("PriorityFlag", () => {
  it("names itself for a screen reader", () => {
    render(<PriorityFlag />);
    expect(screen.getByRole("img", { name: "High Priority" })).toBeTruthy();
  });
});

describe("the task sheet's Priority control", () => {
  const open = (initial: { priority?: "high" | "low" } = {}) => {
    const onSave = vi.fn(async (_d: TaskDraft) => true);
    render(
      <TaskSheet mode="edit" categories={[]} projects={[]} events={[]} initial={{ text: "Pay Rent", category: "", due: "", repeat: "", ...initial }} onSave={onSave} onCancel={() => {}} />,
    );
    return onSave;
  };
  const seg = (name: string) => screen.getByRole("button", { name });

  it("rests on Normal and saves nothing for it", () => {
    const onSave = open();
    expect(seg("Normal").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0].priority).toBeUndefined();
  });
  it("one tap on High is saved on the task", () => {
    const onSave = open();
    fireEvent.click(seg("High"));
    expect(seg("High").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0].priority).toBe("high");
  });
  it("opens on the stored answer and Normal clears it", () => {
    const onSave = open({ priority: "low" });
    expect(seg("Low").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(seg("Normal"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave.mock.calls[0]![0].priority).toBeUndefined();
  });
});
