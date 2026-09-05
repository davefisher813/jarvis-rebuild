// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { Group, MenuRow, SwitchRow, Row } from "./FormSheet";

// SHARED-F-11 (2026-09-05). In every form sheet (task, bill, goal, person,
// project, category, reminder) tapping a dropdown row's label or its glyph
// tile did nothing: the kit put the handler on the control, not on the row,
// and the value variant zeroes the capsule's own height. iOS grouped tables
// make the whole row the target. These assert the row IS the target, and that
// it does not fire twice when the control itself is what was tapped.

const Glyph = () => <span />;

describe("SHARED-F-11: the whole row opens the menu and flips the switch", () => {
  it("a tap on a menu row's label opens the dropdown", () => {
    const { container } = render(
      <Group label="When"><MenuRow tone="blue" glyph={<Glyph />} label="Due" ariaLabel="Due" value="today"
        options={[{ value: "today", label: "Today" }, { value: "tom", label: "Tomorrow" }]} onPick={() => {}} /></Group>,
    );
    const dd = container.querySelector(".dd")!;
    expect(dd.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(container.querySelector(".conn-name")!);
    expect(dd.getAttribute("aria-expanded"), "the label is part of the target").toBe("true");
  });

  it("a tap on the glyph tile opens it too", () => {
    const { container } = render(
      <Group label="When"><MenuRow tone="blue" glyph={<Glyph />} label="Repeat" ariaLabel="Repeat" value="none"
        options={[{ value: "none", label: "None" }]} onPick={() => {}} /></Group>,
    );
    fireEvent.click(container.querySelector(".row-ico")!);
    expect(container.querySelector(".dd")!.getAttribute("aria-expanded")).toBe("true");
  });

  // The bug this guard prevents: forwarding a tap that started on the control
  // fires the handler twice, so the menu opens and shuts in one tap.
  it("a tap on the dropdown itself opens it exactly once", () => {
    const { container } = render(
      <Group label="When"><MenuRow tone="blue" glyph={<Glyph />} label="Area" ariaLabel="Area" value="a"
        options={[{ value: "a", label: "A" }]} onPick={() => {}} /></Group>,
    );
    const dd = container.querySelector(".dd")! as HTMLElement;
    fireEvent.click(dd);
    expect(dd.getAttribute("aria-expanded")).toBe("true");
  });

  it("a tap on a switch row's label flips the switch once", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <Group label="Alerts"><SwitchRow tone="orange" glyph={<Glyph />} label="Remind Me" ariaLabel="Remind Me" on={false} onToggle={onToggle} /></Group>,
    );
    fireEvent.click(container.querySelector(".conn-name")!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("a tap on the switch itself flips it once, not twice", () => {
    const onToggle = vi.fn();
    const { container } = render(
      <Group label="Alerts"><SwitchRow tone="orange" glyph={<Glyph />} label="Remind Me" ariaLabel="Remind Me" on={false} onToggle={onToggle} /></Group>,
    );
    fireEvent.click(container.querySelector(".switch")!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // A forwarding row is pointer convenience over a control that already has
  // the role and the tab stop. A second one would announce "button" over a
  // switch and add a focus stop that does nothing new.
  it("a forwarding row adds no second role and no second tab stop", () => {
    const { container } = render(
      <Group label="Alerts"><SwitchRow tone="orange" glyph={<Glyph />} label="Remind Me" ariaLabel="Remind Me" on onToggle={() => {}} /></Group>,
    );
    const row = container.querySelector(".xs-row")!;
    expect(row.getAttribute("role")).toBeNull();
    expect(row.getAttribute("tabindex")).toBeNull();
    expect(container.querySelector(".switch")!.getAttribute("role")).toBe("switch");
  });

  // And a Row given a real onClick is still a button in its own right.
  it("a row with its own onClick keeps role button and a tab stop", () => {
    const { container } = render(<Row label="Open" onClick={() => {}} />);
    const row = container.querySelector(".xs-row")!;
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("tabindex")).toBe("0");
  });
});
