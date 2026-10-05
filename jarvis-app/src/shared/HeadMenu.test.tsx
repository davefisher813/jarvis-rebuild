// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import HeadMenu, { scrimWithHoles } from "./HeadMenu";
import { FormSheet, Group, MenuRow } from "./FormSheet";

// CLICK-THROUGH AUDIT, 2026-09-29: "stray hmenu-scrim layers block Cancel and
// Done in the editors". The scrim is fixed over the whole screen above the
// sheets, so a dropdown left open in an editor (the Areas menu stays open for a
// second pick) sat on top of Cancel and Save. The fix cuts the sheet's own
// chrome out of the scrim's backdrop, and a press there shuts the menu.

const rect = (left: number, top: number, right: number, bottom: number) =>
  ({ left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) }) as DOMRect;

describe("scrimWithHoles", () => {
  it("is nothing when there is nothing to leave reachable", () => {
    expect(scrimWithHoles(390, 844, [])).toBeUndefined();
  });
  it("cuts each rect out, returning to the corner between holes so no sliver is left", () => {
    const c = scrimWithHoles(390, 844, [{ left: 0, top: 400, right: 390, bottom: 450 }, { left: 10, top: 700, right: 380, bottom: 800 }])!;
    expect(c.startsWith("polygon(evenodd,")).toBe(true);
    expect(c).toContain("0px 400px, 0px 450px, 390px 450px, 390px 400px, 0px 400px, 0px 0px");
    expect(c).toContain("10px 700px, 10px 800px, 380px 800px, 380px 700px, 10px 700px, 0px 0px");
  });
});

describe("a menu open inside a sheet does not wall off the sheet's Cancel and Save", () => {
  afterEach(() => vi.restoreAllMocks());

  const mount = () => render(
    <FormSheet title="New Goal" onCancel={() => {}} onSave={() => {}}>
      <Group label="Where"><MenuRow tone="blue" glyph={<span />} label="Areas" ariaLabel="Areas" value="a"
        options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} onPick={() => {}} /></Group>
    </FormSheet>,
  );

  it("the backdrop is cut away over the sheet bar", () => {
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("sheet-bar") ? rect(0, 500, 390, 548) : rect(0, 0, 0, 0);
    });
    mount();
    fireEvent.click(screen.getByLabelText("Areas"));
    const back = document.querySelector<HTMLElement>(".hmenu-back")!;
    expect(back, "the backdrop is its own layer, so the cut never clips the panel").toBeTruthy();
    expect(back.getAttribute("style") ?? "").toContain("0px 500px, 0px 548px, 390px 548px, 390px 500px");
    expect(document.querySelector(".hmenu-scrim > .hmenu")).toBeTruthy();
    spy.mockRestore();
  });

  it("a press on Cancel while the menu is open shuts the menu and the click still lands", () => {
    const onCancel = vi.fn();
    render(
      <FormSheet title="New Goal" onCancel={onCancel} onSave={() => {}}>
        <Group label="Where"><MenuRow tone="blue" glyph={<span />} label="Areas" ariaLabel="Areas2" value="a"
          options={[{ value: "a", label: "A" }]} onPick={() => {}} /></Group>
      </FormSheet>,
    );
    fireEvent.click(screen.getByLabelText("Areas2"));
    expect(document.querySelector(".hmenu")).toBeTruthy();
    const cancel = screen.getByText("Cancel");
    fireEvent.pointerDown(cancel);
    expect(document.querySelector(".hmenu"), "a press outside the panel closes it").toBeNull();
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("a press inside the panel does not close it", () => {
    render(<HeadMenu ariaLabel="Pick" value="a" options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} onPick={() => {}} multi picked={[]} />);
    fireEvent.click(screen.getByLabelText("Pick"));
    fireEvent.pointerDown(document.querySelector(".hmenu-item")!);
    expect(document.querySelector(".hmenu")).toBeTruthy();
  });
});

// A ROW WITH NOTHING TO SAY SHOWS NOTHING (R1; the review: "None" seven times down one sheet).
describe("an empty value pick does not draw the word None", () => {
  const opts = [{ value: "", label: "None" }, { value: "daily", label: "Daily" }];
  it("keeps the chevron and hides the word for a screen reader only", () => {
    render(<HeadMenu variant="value" ariaLabel="Repeat" value="" off options={opts} onPick={() => {}} />);
    const btn = screen.getByRole("button", { name: "Repeat" });
    expect(["dd-value", "dd-off", "dd-none"].every((c) => btn.classList.contains(c))).toBe(true);
    expect(btn.querySelector(".dd-cv")).toBeTruthy();
    expect(btn.textContent).toBe("None");
  });
  it("a real value, or an off state with its own word, is drawn as it always was", () => {
    const { unmount } = render(<HeadMenu variant="value" ariaLabel="Repeat" value="daily" options={opts} onPick={() => {}} />);
    expect(screen.getByRole("button", { name: "Repeat" }).classList.contains("dd-none")).toBe(false);
    unmount();
    render(<HeadMenu variant="value" ariaLabel="Rest" value="0" off label="Off" options={[{ value: "0", label: "Off" }]} onPick={() => {}} />);
    expect(screen.getByRole("button", { name: "Rest" }).classList.contains("dd-none")).toBe(false);
  });
  it("the stylesheet takes the word out of the line", () => {
    const css = readFileSync(join(__dirname, "../styles/components.css"), "utf8");
    expect(css).toMatch(/\.dd\.dd-value\.dd-none \.dd-w \{[^}]*clip: rect\(0 0 0 0\)/);
  });
});
