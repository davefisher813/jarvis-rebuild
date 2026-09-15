import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { scanTree, scanSource } from "./rowTap.scan";

// THE WHOLE ROW IS THE DOOR (Dave 2026-09-15: "I want all rows clickable.
// How is the first thing that renders on the app not clickable? It seems
// like throughout the app rows with buttons tend to not be clickable. I want
// a FULL sweep of this and all of them to be fixed").
//
// The sweep that day found 147 rows holding a control that took no tap
// themselves, plus 17 notices handed a verb and no door. This keeps the
// count at zero. A row that is deliberately not a door says why with a
// `row-tap: <reason>` comment over its opening tag; see rowTap.scan.ts.
describe("every row that holds a control is itself a door", () => {
  it("no dead rows anywhere in the app", () => {
    const found = scanTree(join(process.cwd(), "src"));
    expect(found.map((f) => `${f.file}:${f.line} [${f.classes}]`)).toEqual([]);
  });

  // Proved to bite: each planted violation below is the exact shape Dave
  // photographed, and each fixed twin passes.
  it("flags a row whose only live part is its pill", () => {
    const dead = `export const A = () => (<div className="task-row"><span>Call</span><button className="pill-act" onClick={go}>Drop</button></div>);`;
    expect(scanSource(dead, "a.tsx")).toHaveLength(1);
    const live = `export const A = () => (<div className="task-row" onClick={open}><span>Call</span><button className="pill-act" onClick={go}>Drop</button></div>);`;
    expect(scanSource(live, "a.tsx")).toHaveLength(0);
  });

  it("an empty or unknown spread does not count as a door", () => {
    const hidden = `export const A = () => (<div className="row" {...{}}><button onClick={go}>X</button></div>);`;
    expect(scanSource(hidden, "a.tsx")).toHaveLength(1);
    const door = `export const A = () => (<div className="row" {...rowDoor(open)}><button onClick={go}>X</button></div>);`;
    expect(scanSource(door, "a.tsx")).toHaveLength(0);
  });

  it("flags a notice handed a verb and no door", () => {
    const dead = `export const A = () => <NoticeCard title="Meds" action={{ label: "Ask Again", onClick: go }} />;`;
    expect(scanSource(dead, "a.tsx")).toHaveLength(1);
    const live = `export const A = () => <NoticeCard title="Meds" action={{ label: "Ask Again", onClick: go }} onOpen={open} />;`;
    expect(scanSource(live, "a.tsx")).toHaveLength(0);
  });

  it("an exemption needs a reason", () => {
    const bare = `export const A = () => (\n  // row-tap:\n  <div className="row"><button onClick={go}>X</button></div>);`;
    expect(scanSource(bare, "a.tsx")).toHaveLength(1);
    const reasoned = `export const A = () => (\n  // row-tap: a strip of chips, each its own pick\n  <div className="row"><button onClick={go}>X</button></div>);`;
    expect(scanSource(reasoned, "a.tsx")).toHaveLength(0);
  });
});
