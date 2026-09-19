// @vitest-environment jsdom
//
// THE ONE SELECT BAR, UNDER TEST AT LAST (button audit phase 2, 2026-09-19).
//
// The audit found this file had no test at all, which matters more here than
// almost anywhere: SelectBar is written once and worn by four surfaces
// (tasks, notices, notes, schedule), so a regression in it is four bugs. Its
// Delete is also the widest-reaching control any of those screens offers,
// and the file's own header records that there is deliberately NO confirm
// step -- Dave chose Undo over a confirm sheet. That choice only holds if
// the bar refuses to fire on an empty selection, which is exactly what these
// assert.
//
// Driven through the real useSelection rather than a hand-made Selection, so
// the intersection rules it documents ("never holds ids that have left the
// list") are exercised by the same object the app passes in.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useSelection } from "./useSelection";
import SelectBar from "./SelectBar";

// AppShell owns the portal host in the real app.
function withHost() {
  const host = document.createElement("div");
  host.id = "select-bar-host";
  document.body.appendChild(host);
  return host;
}

function Harness({
  ids, onDelete, extraLabel, onExtra, projects, onMoveToProject,
}: {
  ids: string[]; onDelete: () => void;
  extraLabel?: string; onExtra?: () => void;
  projects?: { id: string; title: string }[];
  onMoveToProject?: (ids: string[], projectId: string) => void;
}) {
  const [visible, setVisible] = useState(ids);
  const sel = useSelection(visible);
  return (
    <>
      <button onClick={() => sel.enter()}>Enter</button>
      <button onClick={() => setVisible((v) => v.slice(0, -1))}>Drop Last</button>
      {visible.map((id) => (
        <button key={id} onClick={() => sel.toggle(id)}>{"row-" + id}</button>
      ))}
      <SelectBar
        sel={sel} onDelete={onDelete} noun="task"
        {...(extraLabel && onExtra ? { extraLabel, onExtra } : {})}
        {...(projects && onMoveToProject ? { projects, onMoveToProject } : {})}
      />
    </>
  );
}

beforeEach(() => { withHost(); });
afterEach(() => { document.body.innerHTML = ""; document.body.className = ""; });

describe("SelectBar", () => {
  it("stays out of the way until select mode is entered", () => {
    render(<Harness ids={["a", "b"]} onDelete={() => {}} />);
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(document.body).not.toHaveClass("selecting");
    fireEvent.click(screen.getByText("Enter"));
    expect(screen.getByRole("toolbar")).toBeInTheDocument();
    // The capture dock steps aside while the bar is up.
    expect(document.body).toHaveClass("selecting");
  });

  it("will not delete nothing: Delete is dead at zero and speaks the count above it", () => {
    const onDelete = vi.fn();
    render(<Harness ids={["a", "b"]} onDelete={onDelete} />);
    fireEvent.click(screen.getByText("Enter"));

    // Zero picked. There is no confirm step anywhere in this bar, so this
    // disabled state is the only thing standing between a stray tap and a
    // delete call with an empty list.
    const del = screen.getByRole("button", { name: "Delete 0 tasks" });
    expect(del).toBeDisabled();
    fireEvent.click(del);
    expect(onDelete).not.toHaveBeenCalled();

    // One picked: singular, and it fires.
    fireEvent.click(screen.getByText("row-a"));
    const one = screen.getByRole("button", { name: "Delete 1 task" });
    expect(one).toBeEnabled();
    fireEvent.click(one);
    expect(onDelete).toHaveBeenCalledTimes(1);

    // Two picked: plural.
    fireEvent.click(screen.getByText("row-b"));
    expect(screen.getByRole("button", { name: "Delete 2 tasks" })).toBeInTheDocument();
  });

  it("Select All takes only what is visible, and toggles back to Select None", () => {
    render(<Harness ids={["a", "b", "c"]} onDelete={() => {}} />);
    fireEvent.click(screen.getByText("Enter"));
    fireEvent.click(screen.getByRole("button", { name: "Select All" }));
    expect(screen.getByRole("toolbar")).toHaveAttribute("aria-label", "Selected 3 tasks");
    // Now it offers the way back rather than repeating itself.
    fireEvent.click(screen.getByRole("button", { name: "Select None" }));
    expect(screen.getByRole("toolbar")).toHaveAttribute("aria-label", "Selected 0 tasks");
  });

  it("a row that leaves the list leaves the count with it", () => {
    render(<Harness ids={["a", "b", "c"]} onDelete={() => {}} />);
    fireEvent.click(screen.getByText("Enter"));
    fireEvent.click(screen.getByRole("button", { name: "Select All" }));
    expect(screen.getByRole("toolbar")).toHaveAttribute("aria-label", "Selected 3 tasks");
    // useSelection's first refusal: never hold ids that have left the list.
    act(() => { fireEvent.click(screen.getByText("Drop Last")); });
    expect(screen.getByRole("toolbar")).toHaveAttribute("aria-label", "Selected 2 tasks");
  });

  it("the extra action is offered only where a surface supplies one, and is dead at zero", () => {
    const onExtra = vi.fn();
    const { unmount } = render(<Harness ids={["a"]} onDelete={() => {}} />);
    fireEvent.click(screen.getByText("Enter"));
    expect(screen.queryByRole("button", { name: "Mark Done" })).toBeNull();
    unmount();

    withHost();
    render(<Harness ids={["a"]} onDelete={() => {}} extraLabel="Mark Done" onExtra={onExtra} />);
    fireEvent.click(screen.getByText("Enter"));
    const extra = screen.getByRole("button", { name: "Mark Done" });
    expect(extra).toBeDisabled();
    fireEvent.click(extra);
    expect(onExtra).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("row-a"));
    fireEvent.click(screen.getByRole("button", { name: "Mark Done" }));
    expect(onExtra).toHaveBeenCalledTimes(1);
  });

  it("Delete keeps its place as the one filled control: Move to Project is a capsule", () => {
    const onMove = vi.fn();
    render(
      <Harness ids={["a"]} onDelete={() => {}}
        projects={[{ id: "p1", title: "Roster" }]} onMoveToProject={onMove} />,
    );
    fireEvent.click(screen.getByText("Enter"));
    expect(screen.getByLabelText("Move to Project")).toBeInTheDocument();
    // One filled button on the bar, and it is Delete (the app's one-red law).
    const filled = document.querySelectorAll(".select-bar .btn-primary");
    expect(filled).toHaveLength(1);
    expect(filled[0]).toHaveClass("select-del");
  });
});
