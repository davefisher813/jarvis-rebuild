// @vitest-environment jsdom
import "./tiptapTest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { TasksService } from "../tasks/TasksService";
import { ProjectsService } from "../projects/ProjectsService";
import { CategoriesService } from "../categories/CategoriesService";
import { PeopleService } from "../people/PeopleService";
import { DecisionService } from "../decisions/DecisionService";
import { StrandsService } from "../brain/strands/StrandsService";
import AreasTab from "../life/tabs/AreasTab";
import RemindersFlow from "../tasks/screens/RemindersFlow";
import BiggerPictureFlow from "../bigger/BiggerPictureFlow";
import PeopleFlow from "../people/PeopleFlow";
import DecisionsFlow from "../decisions/DecisionsFlow";
import StrandsPage from "../brain/strands/StrandsPage";
import BrainFlow from "../brain/BrainFlow";

// THE FIRST LOAD FAILED, ON EVERY REMOTE-BACKED SCREEN (research standard, section 5 rule 18, 2026-10-19). Each of these drew an empty page (or sat blank on
// its skeleton) when its first read failed. Each says what could not be read, in the app's own empty state, with Retry as its one filled primary; Retry reads
// again. Notes, Money, Tasks and the Tracker have their own tests beside them.
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const retry = () => {
  expect(document.querySelector(".empty-state .btn-primary")).toHaveTextContent("Retry");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
};

describe("Life and Brain: the first load failing", () => {
  it("Areas", async () => {
    vi.spyOn(TasksService.prototype, "listTasks").mockRejectedValueOnce(new Error("offline"));
    render(<NotesProvider userId="lf-areas"><AreasTab segments={null} onOpenCategory={() => {}} /></NotesProvider>);
    expect(await screen.findByText("Couldn't Load Your Areas")).toBeInTheDocument();
    expect(screen.queryByText("No Areas Yet")).toBeNull();
    retry();
    await waitFor(() => expect(screen.queryByText("Couldn't Load Your Areas")).toBeNull());
  });

  it("Reminders", async () => {
    vi.spyOn(TasksService.prototype, "listTasks").mockRejectedValueOnce(new Error("offline"));
    render(<NotesProvider userId="lf-rem"><RemindersFlow /></NotesProvider>);
    expect(await screen.findByText("Couldn't Load Your Reminders")).toBeInTheDocument();
    expect(screen.queryByText("Add a Reminder")).toBeNull();
    retry();
    await waitFor(() => expect(screen.queryByText("Couldn't Load Your Reminders")).toBeNull());
    expect(await screen.findByText("Add a Reminder")).toBeInTheDocument();
  });

  it("Goals and Projects", async () => {
    for (const [lens, what] of [["goals", "Your Goals"], ["projects", "Your Projects"]] as const) {
      vi.spyOn(ProjectsService.prototype, "list").mockRejectedValueOnce(new Error("offline"));
      render(<NotesProvider userId={"lf-" + lens}><BiggerPictureFlow lens={lens} title="Life" /></NotesProvider>);
      expect(await screen.findByText(`Couldn't Load ${what}`)).toBeInTheDocument();
      retry();
      await waitFor(() => expect(screen.queryByText(`Couldn't Load ${what}`)).toBeNull());
      cleanup();
    }
  });

  it("Contacts", async () => {
    vi.spyOn(PeopleService.prototype, "list").mockRejectedValueOnce(new Error("offline"));
    render(<NotesProvider userId="lf-people"><PeopleFlow /></NotesProvider>);
    expect(await screen.findByText("Couldn't Load Your People")).toBeInTheDocument();
    expect(screen.queryByText("No One Here Yet")).toBeNull();
    retry();
    expect(await screen.findByText("No One Here Yet")).toBeInTheDocument();
  });

  it("Decisions", async () => {
    vi.spyOn(DecisionService.prototype, "list").mockRejectedValueOnce(new Error("offline"));
    render(<NotesProvider userId="lf-dec"><DecisionsFlow onBack={() => {}} /></NotesProvider>);
    expect(await screen.findByText("Couldn't Load Your Decisions")).toBeInTheDocument();
    expect(screen.queryByText("Worth Remembering")).toBeNull();
    retry();
    expect(await screen.findByText("Worth Remembering")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't Load Your Decisions")).toBeNull();
  });

  it("What JARVIS Knows", async () => {
    vi.spyOn(StrandsService.prototype, "list").mockRejectedValueOnce(new Error("offline"));
    render(<NotesProvider userId="lf-strands"><StrandsPage onBack={() => {}} /></NotesProvider>);
    expect(await screen.findByText("Couldn't Load What JARVIS Knows")).toBeInTheDocument();
    expect(screen.queryByText("Nothing Remembered Yet")).toBeNull();
    retry();
    expect(await screen.findByText("Nothing Remembered Yet")).toBeInTheDocument();
  });

  it("an area opened by deep link when the area list cannot be read", async () => {
    vi.spyOn(CategoriesService.prototype, "list").mockRejectedValueOnce(new Error("offline"));
    render(<NotesProvider userId="lf-brain"><BrainFlow openKey="some-area" /></NotesProvider>);
    expect(await screen.findByText("Couldn't Load Your Areas")).toBeInTheDocument();
    retry();
    await waitFor(() => expect(screen.queryByText("Couldn't Load Your Areas")).toBeNull());
  });
});
