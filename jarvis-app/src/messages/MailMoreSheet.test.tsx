// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MailMoreSheet from "./MailMoreSheet";
import LetGoSwipe from "./LetGoSwipe";
import { decide, promises } from "./mailAction";

describe("More Moves sheet", () => {
  const d = decide("Invoice", "", 53, 0, { hasPhone: true, altContact: "Marcus" });

  it("lists every alternate, and never repeats the row's own button", () => {
    render(<MailMoreSheet who="Wei Chen" subject="Invoice" days={53} decision={d} onPick={() => {}} onClose={() => {}} />);
    for (const a of d.alternates) expect(screen.getByText(a.label)).toBeInTheDocument();
    expect(screen.queryByText(d.primary.label)).not.toBeInTheDocument();
  });

  it("every row says what the tap does", () => {
    render(<MailMoreSheet who="Wei Chen" subject="Invoice" days={53} decision={d} onPick={() => {}} onClose={() => {}} />);
    for (const a of d.alternates) {
      const name = screen.getByText(a.label);
      expect(name.parentElement?.textContent).toContain(promises(a));
    }
  });

  it("the reason is said once by the sheet, not down every row", () => {
    render(<MailMoreSheet who="Wei Chen" subject="Invoice" days={53} decision={d} onPick={() => {}} onClose={() => {}} />);
    expect(document.body.textContent!.split(d.note).length - 1).toBe(1);
  });

  it("picking one hands back the action itself, not a label to re-parse", () => {
    const onPick = vi.fn();
    render(<MailMoreSheet who="Wei Chen" subject="Invoice" days={53} decision={d} onPick={onPick} onClose={() => {}} />);
    fireEvent.click(screen.getByText(d.alternates[0]!.label));
    expect(onPick).toHaveBeenCalledWith(d.alternates[0]);
  });

  it("[edge] tapping the scrim closes without acting", () => {
    const onPick = vi.fn(), onClose = vi.fn();
    const { container } = render(
      <MailMoreSheet who="W" subject="s" days={1} decision={d} onPick={onPick} onClose={onClose} />,
    );
    void container;
    fireEvent.click(document.querySelector(".sheet-scrim")!);
    expect(onClose).toHaveBeenCalled();
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("the Waiting On swipe", () => {
  it("reveals More and Let It Go", () => {
    render(<LetGoSwipe onMore={() => {}} onLetGo={() => {}}><div>row</div></LetGoSwipe>);
    expect(screen.getByLabelText("More moves")).toBeInTheDocument();
    expect(screen.getByLabelText("Let it go")).toBeInTheDocument();
  });

  it("[edge] with nothing else to offer, Let It Go is the only reveal", () => {
    render(<LetGoSwipe onLetGo={() => {}}><div>row</div></LetGoSwipe>);
    expect(screen.queryByLabelText("More moves")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Let it go")).toBeInTheDocument();
  });

  it("Let It Go always sits in the slot a swipe actually uncovers", () => {
    // The bug this pins: it used to render as .mail-arch, which CSS parks at
    // right:88px, behind the part of the row that never moves at an 88px
    // reveal. It was invisible from the day it shipped.
    const { container } = render(<LetGoSwipe onLetGo={() => {}}><div>row</div></LetGoSwipe>);
    expect(container.querySelector(".mail-letgo")).toBeTruthy();
    expect(container.querySelector(".mail-arch")).toBeNull();
  });
});
