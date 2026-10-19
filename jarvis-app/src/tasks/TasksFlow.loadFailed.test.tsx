// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { TasksService } from "./TasksService";
import TasksFlow from "./TasksFlow";

// THE FIRST LOAD FAILED (research standard, section 5 rule 18, 2026-10-19). The Tasks list sat on its skeleton for good when its first read failed. It
// says what could not be read and offers Retry, the one filled primary; Retry reads again.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Tasks: the first load failing", () => {
  it("draws Couldn't Load Your Tasks with Retry instead of a skeleton, and Retry reads again", async () => {
    vi.spyOn(TasksService.prototype, "listTasks").mockRejectedValueOnce(new Error("offline"));
    render(<NotesProvider userId="tasks-load-fail"><TasksFlow /></NotesProvider>);
    expect(await screen.findByText("Couldn't Load Your Tasks")).toBeInTheDocument();
    expect(document.querySelector(".empty-state .btn-primary")).toHaveTextContent("Retry");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText(/Nothing Due Today|Nothing/i, {}, { timeout: 4000 }).catch(() => {});
    expect(screen.queryByText("Couldn't Load Your Tasks")).toBeNull();
  });
});
