// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StrandsPage, { receiptLine } from "./StrandsPage";
import BrainFlow from "../BrainFlow";
import { NotesProvider } from "../../data/NotesProvider";
import type { Strand } from "./types";
import "@testing-library/jest-dom";

// THE RECURRING LESSON (three times in this codebase): a tested function
// proves nothing about whether a screen reaches it. These render the real
// components through the real provider.

const strand = (over: Partial<Strand["data"]> = {}, id = "s1"): Strand => ({
  id,
  data: {
    text: "Gets things done mid morning", category: "energy", source: "watched",
    strength: "influence", status: "active", createdAt: "2026-08-01",
    lastConfirmed: "2026-08-20", derivation: "completion_window",
    evidence: [{ day: "2026-08-19", a: 9 }],
    ...over,
  },
});

const svc = {
  list: vi.fn(async () => [] as Strand[]),
  active: vi.fn(async () => [] as Strand[]),
  add: vi.fn(async () => "new"),
  accept: vi.fn(async () => "new"),
  edit: vi.fn(async () => {}),
  setStatus: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
};

vi.mock("../../data/NotesProvider", async (orig) => {
  const actual = await orig<typeof import("../../data/NotesProvider")>();
  return { ...actual, useStrands: () => svc, useOptionalStrands: () => svc };
});

describe("StrandsPage renders the genome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svc.list.mockResolvedValue([]);
  });

  it("says something honest when there is nothing yet, and never fakes a fact", async () => {
    render(<StrandsPage onBack={() => {}} />);
    await screen.findByText(/Nothing yet/);
    expect(screen.getByText("Add One Thing")).toBeInTheDocument();
  });

  it("shows each strand with its category and where it came from", async () => {
    svc.list.mockResolvedValue([strand(), strand({ text: "Never schedule calls before 10", category: "work_style", source: "told", derivation: undefined }, "s2")]);
    render(<StrandsPage onBack={() => {}} />);
    await screen.findByText("Gets things done mid morning");
    expect(screen.getByText(/Energy · Watched/)).toBeInTheDocument();
    expect(screen.getByText(/Work Style · Told/)).toBeInTheDocument();
  });

  it("opens the receipts, so a claim can always be checked", async () => {
    svc.list.mockResolvedValue([strand()]);
    render(<StrandsPage onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Gets things done mid morning"));
    await screen.findByText("Finished in the 9 AM window");
    expect(screen.getByText("Aug 19")).toBeInTheDocument();
  });

  it("gives wrongness an exit on every strand", async () => {
    svc.list.mockResolvedValue([strand()]);
    render(<StrandsPage onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Gets things done mid morning"));
    await screen.findByText("Edit");
    expect(screen.getByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("delete actually calls the service, not just a dialog that closes", async () => {
    svc.list.mockResolvedValue([strand()]);
    render(<StrandsPage onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Gets things done mid morning"));
    fireEvent.click(await screen.findByText("Delete"));
    await waitFor(() => expect(svc.remove).toHaveBeenCalled());
  });

  it("a typed strand reaches the service with its category", async () => {
    render(<StrandsPage onBack={() => {}} />);
    fireEvent.click(await screen.findByText("Add One Thing"));
    fireEvent.change(await screen.findByPlaceholderText(/Brainstorms best at night/), { target: { value: "Writes best at night" } });
    fireEvent.click(screen.getByText("Values"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(svc.add).toHaveBeenCalledWith("Writes best at night", "values", expect.any(String)));
  });

  it("a paused strand stays visible rather than disappearing", async () => {
    svc.list.mockResolvedValue([strand({ status: "paused" })]);
    const { container } = render(<StrandsPage onBack={() => {}} />);
    await screen.findByText("Gets things done mid morning");
    expect(container.querySelector(".strand-row.paused")).toBeTruthy();
  });
});

describe("the Brain hub actually reaches the page", () => {
  beforeEach(() => { vi.clearAllMocks(); svc.list.mockResolvedValue([]); });

  it("What JARVIS Knows opens the strands screen", async () => {
    render(
      <NotesProvider userId="u1">
        <BrainFlow />
      </NotesProvider>,
    );
    fireEvent.click(await screen.findByText("What JARVIS Knows"));
    // The row and the screen title share their words, so the proof the row
    // went somewhere is the page's own furniture.
    await screen.findByText("Add One Thing");
  });
});

describe("receiptLine speaks each derivation's own numbers", () => {
  it("renders a completion hour", () => {
    expect(receiptLine("completion_window", { day: "d", a: 14 })).toBe("Finished in the 2 PM window");
  });
  it("renders a plan-rate day", () => {
    expect(receiptLine("plan_rate", { day: "d", a: 3, b: 4 })).toBe("3 of 4 picks done");
  });
  it("renders a timing overrun and an early finish", () => {
    expect(receiptLine("task_timing", { day: "d", a: 30 })).toBe("Ran 30 min past the estimate");
    expect(receiptLine("task_timing", { day: "d", a: -15 })).toBe("Wrapped 15 min early");
  });
  it("never invents a receipt it cannot render", () => {
    expect(receiptLine(undefined, { day: "d" })).toBe("Seen");
    expect(receiptLine("plan_rate", { day: "d" })).toBe("Seen");
  });
});
