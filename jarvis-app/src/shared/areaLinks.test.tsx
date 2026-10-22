// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, act } from "@testing-library/react";
import { tiedTo, listInAreas, homeArea, keepIfTied, projectAreas, useWhenAreasChange } from "./areaLinks";

// LINKED PICKERS FOLLOW THE AREA (Dave 2026-10-22). The rule's three halves, as pure functions the four editors share.
interface Item { id: string; areas?: string[] }
const areasOf = (i: Item) => i.areas;
const GOALS: Item[] = [
  { id: "weight", areas: ["bridge"] },
  { id: "recruit", areas: ["elite"] },
  { id: "commit", areas: ["elite", "bridge"] },
  { id: "loose", areas: [] },
  { id: "unknown" },
];

describe("tiedTo", () => {
  it("is true when the item names at least one of the chosen areas", () => {
    expect(tiedTo(["elite", "bridge"], ["bridge"])).toBe(true);
    expect(tiedTo(["elite"], ["bridge", "elite"])).toBe(true);
  });
  it("is false for another area, no areas, or a missing list", () => {
    expect(tiedTo(["elite"], ["bridge"])).toBe(false);
    expect(tiedTo([], ["bridge"])).toBe(false);
    expect(tiedTo(undefined, ["bridge"])).toBe(false);
  });
});

describe("projectAreas", () => {
  it("is the one category, or nothing", () => {
    expect(projectAreas("elite")).toEqual(["elite"]);
    expect(projectAreas("")).toEqual([]);
    expect(projectAreas(undefined)).toEqual([]);
  });
});

describe("rule 1: the list under the Area", () => {
  it("lists only what is tied to the chosen area", () => {
    expect(listInAreas(GOALS, areasOf, ["elite"]).map((g) => g.id)).toEqual(["recruit", "commit"]);
  });
  it("a goal watching two areas is listed under each", () => {
    expect(listInAreas(GOALS, areasOf, ["bridge"]).map((g) => g.id)).toEqual(["weight", "commit"]);
  });
  it("with several areas chosen, anything tied to any of them", () => {
    expect(listInAreas(GOALS, areasOf, ["elite", "bridge"]).map((g) => g.id)).toEqual(["weight", "recruit", "commit"]);
  });
  it("with no area chosen, everything, in the order it came", () => {
    expect(listInAreas(GOALS, areasOf, []).map((g) => g.id)).toEqual(["weight", "recruit", "commit", "loose", "unknown"]);
  });
  it("an area with nothing of the kind leaves nothing", () => {
    expect(listInAreas(GOALS, areasOf, ["home"])).toEqual([]);
  });
  it("an item with no areas is tied to none, so an Area hides it", () => {
    expect(listInAreas(GOALS, areasOf, ["elite"]).some((g) => g.id === "loose" || g.id === "unknown")).toBe(false);
  });
  it("the pick already made stays listed even when it no longer fits", () => {
    expect(listInAreas(GOALS, areasOf, ["elite"], "weight").map((g) => g.id)).toEqual(["weight", "recruit", "commit"]);
  });
  it("does not change the list it was given", () => {
    const before = [...GOALS];
    listInAreas(GOALS, areasOf, ["elite"]);
    expect(GOALS).toEqual(before);
  });
});

describe("rule 2: the Area a pick brings with it", () => {
  it("is the first area it names", () => {
    expect(homeArea(["bridge", "elite"])).toBe("bridge");
  });
  it("is the first LIVE one when the live areas are given", () => {
    expect(homeArea(["gone", "elite"], ["elite", "bridge"])).toBe("elite");
  });
  it("is nothing for an item with no area", () => {
    expect(homeArea([])).toBeUndefined();
    expect(homeArea(undefined)).toBeUndefined();
    expect(homeArea(["gone"], ["elite"])).toBeUndefined();
  });
});

describe("rule 3: a pick after the Area changed", () => {
  it("stays while it is tied to a chosen area", () => {
    expect(keepIfTied("commit", GOALS, areasOf, ["bridge"])).toBe("commit");
  });
  it("goes back to None when it is not tied", () => {
    expect(keepIfTied("recruit", GOALS, areasOf, ["bridge"])).toBe("");
    expect(keepIfTied("loose", GOALS, areasOf, ["bridge"])).toBe("");
  });
  it("is left alone when no area is chosen (None for the Area clears nothing)", () => {
    expect(keepIfTied("recruit", GOALS, areasOf, [])).toBe("recruit");
  });
  it("is left alone when it cannot be judged (not in the list it was handed)", () => {
    expect(keepIfTied("ghost", GOALS, areasOf, ["bridge"])).toBe("ghost");
  });
  it("None stays None", () => {
    expect(keepIfTied("", GOALS, areasOf, ["bridge"])).toBe("");
  });
});

describe("useWhenAreasChange", () => {
  function Probe({ start, onChange }: { start: string[]; onChange: (a: readonly string[]) => void }) {
    const [areas, setAreas] = useState(start);
    useWhenAreasChange(areas, onChange);
    return (
      <>
        <button onClick={() => setAreas(["elite"])}>elite</button>
        <button onClick={() => setAreas(["elite"])}>elite again</button>
        <button onClick={() => setAreas([])}>none</button>
      </>
    );
  }
  const click = (el: HTMLElement) => act(() => { el.click(); });

  it("does not run on the first render: a record opened with an old mismatch is left as it is", () => {
    const onChange = vi.fn();
    render(<Probe start={["bridge"]} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("runs once when the areas change, with the new ones", () => {
    const onChange = vi.fn();
    const { getByText } = render(<Probe start={["bridge"]} onChange={onChange} />);
    click(getByText("elite"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["elite"]);
  });
  it("does not run when the same areas are set again", () => {
    const onChange = vi.fn();
    const { getByText } = render(<Probe start={["bridge"]} onChange={onChange} />);
    click(getByText("elite"));
    click(getByText("elite again"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it("runs when the areas are cleared too, so the caller decides that clears nothing", () => {
    const onChange = vi.fn();
    const { getByText } = render(<Probe start={["bridge"]} onChange={onChange} />);
    click(getByText("none"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
