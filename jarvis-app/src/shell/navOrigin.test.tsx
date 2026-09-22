// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useCallback, useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NavOriginProvider, useLeaveVia, type NavOrigin } from "./navOrigin";
import ReturnPill from "./ReturnPill";

// The shell's wiring, in miniature: the same stable claim and the same
// counter, so what this proves is what AppShell does.
function Harness({ origin, page }: { origin: NavOrigin | null; page: "own" | "sheet" }) {
  const [claims, setClaims] = useState(0);
  const [here, setHere] = useState("away");
  const claim = useCallback(() => {
    setClaims((n) => n + 1);
    return () => setClaims((n) => n - 1);
  }, []);
  const back = () => { setHere("home"); return true; };
  return (
    <NavOriginProvider value={{ origin, back, claim, claimed: claims > 0 }}>
      <div data-testid="where">{here}</div>
      {page === "own" ? <PageWithItsOwnBack /> : <div>a sheet closed, and this is the page behind it</div>}
      <ReturnPill />
    </NavOriginProvider>
  );
}

const closed = vi.fn();
function PageWithItsOwnBack() {
  const leave = useLeaveVia("All Tasks", closed);
  return <button onClick={leave.onBack}>{leave.label}</button>;
}

const TODAY: NavOrigin = { key: "today", label: "Today" };

describe("the way home", () => {
  it("is not drawn at all when nothing jumped you here", () => {
    render(<Harness origin={null} page="sheet" />);
    expect(screen.queryByText("Today")).toBeNull();
  });

  // The case the modal audit turned up: a sheet a jump opened has been
  // cancelled, and the page behind it is a tab he never chose.
  it("is one pill on a page that has no back of its own", () => {
    render(<Harness origin={TODAY} page="sheet" />);
    const pill = screen.getByText("Today");
    fireEvent.click(pill);
    expect(screen.getByTestId("where")).toHaveTextContent("home");
  });

  // TWO BACKS ON ONE SCREEN is the drift this whole pass is about.
  it("stands down where the page already offers it, and says the origin instead", () => {
    render(<Harness origin={TODAY} page="own" />);
    // One control, not two, and it wears the origin's name rather than "All Tasks".
    expect(screen.getAllByText("Today")).toHaveLength(1);
    expect(screen.queryByText("All Tasks")).toBeNull();
    expect(document.querySelector(".return-pill")).toBeNull();
  });

  it("keeps its own label when nothing jumped into it", () => {
    render(<Harness origin={null} page="own" />);
    expect(screen.getByText("All Tasks")).toBeInTheDocument();
  });

  // A claim that re-ran every render would set shell state every render,
  // which is an infinite loop rather than churn. If this ever regresses the
  // test does not fail slowly, it hangs -- so it is pinned on the count.
  it("claims once, not once per render", () => {
    const { rerender } = render(<Harness origin={TODAY} page="own" />);
    for (let i = 0; i < 5; i++) rerender(<Harness origin={TODAY} page="own" />);
    expect(screen.getAllByText("Today")).toHaveLength(1);
    expect(document.querySelector(".return-pill")).toBeNull();
  });

  it("closes the page its own way before the shell returns", () => {
    closed.mockClear();
    render(<Harness origin={TODAY} page="own" />);
    fireEvent.click(screen.getByText("Today"));
    expect(closed, "the stop point is written by this").toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("where")).toHaveTextContent("home");
  });
});
