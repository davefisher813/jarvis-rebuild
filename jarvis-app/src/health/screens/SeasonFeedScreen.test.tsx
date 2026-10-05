// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import SeasonFeedScreen from "./SeasonFeedScreen";
import type { AIService } from "../../ai/AIService";

// THE CATALOG, CHECKED ON WHAT THE REVIEW DRAWS (Dave 2026-10-05). The review
// rows printed the extractor's own strings, "2026-09-04" and "15:30 to 16:30":
// an ISO date and a 24-hour clock, where every other schedule screen says
// "Fri, Sep 4" and "3:30 - 4:30 PM".
const READ = JSON.stringify({ org: "Ridgeley U12", events: [{ title: "Practice", date: "2026-09-04", start: "15:30", end: "16:30" }, { title: "Game", date: "2026-09-05", start: "09:00" }] });
const ai = { complete: vi.fn(async () => READ) } as unknown as AIService;

describe("SeasonFeedScreen: the review rows follow the catalog (2026-10-05)", () => {
  it("draws each row's day and clock as two small-caps date facts in plain words, 12-hour with AM or PM", async () => {
    const { container } = render(<SeasonFeedScreen ai={ai} onCommit={() => {}} onBack={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Paste the schedule/), { target: { value: "Practice Friday 3:30" } });
    fireEvent.click(screen.getByText("Read the Pasted Text"));
    await waitFor(() => expect(screen.getByText("Practice")).toBeInTheDocument());
    const rows = Array.from(container.querySelectorAll(".row .facts")).map((f) => Array.from(f.querySelectorAll(".fact.date")).map((x) => x.textContent));
    expect(rows).toEqual([["Fri, Sep 4", "3:30 - 4:30 PM"], ["Sat, Sep 5", "9:00 AM"]]);
    expect(container.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(container.textContent).not.toMatch(/\b(15|16):\d{2}\b/);
  });
});
