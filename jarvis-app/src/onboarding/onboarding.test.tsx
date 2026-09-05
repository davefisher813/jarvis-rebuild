// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import { ProfileService } from "../profile/ProfileService";
import { CategoriesService } from "../categories/CategoriesService";
import { NEW_USER_TABS } from "../shell/destinations";
import OnboardingFlow from "./OnboardingFlow";
import * as notifications from "../shared/notifications";

function setup() {
  const onFinish = vi.fn();
  render(
    <NotesProvider userId="u1">
      <OnboardingFlow onFinish={onFinish} />
    </NotesProvider>,
  );
  return onFinish;
}

describe("OnboardingFlow", () => {
  it("walks the full intake and finishes", async () => {
    const onFinish = setup();

    // intro
    expect(screen.getByText("Build your Brain. Let JARVIS run the rest.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Begin"));

    // name
    expect(screen.getByText(/What should I call you/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Alex" } });
    fireEvent.click(screen.getByLabelText("Send"));

    // template
    expect(screen.getByText(/How will you use JARVIS/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Personal"));

    // categories (defaults seeded into the step)
    // The categories prompt is personalized ("for Personal, I've set up ...");
    // assert the stable half of the sentence, not the template-specific half.
    expect(screen.getByText(/Remove any that don/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Work")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Continue"));

    // people
    expect(screen.getByText(/most important people/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/add people as I go/));

    // priority (new optional step)
    expect(screen.getByText(/most important thing on your plate/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Skip for now"));

    // work style
    expect(screen.getByText(/When do you usually work/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("9 to 5"));

    // seeds (handoff item 4): five optional questions, one turn, one skip
    expect(screen.getByText(/A few quick ones/)).toBeInTheDocument();
    expect(screen.getByText("When is your head clearest?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Skip these"));

    // AI choice (item 22): two options, no preselection
    expect(screen.getByText(/How much should I do on my own/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Everything"));

    // connect
    expect(screen.getByText(/Gmail and Google Calendar/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Continue"));

    // daily rhythm
    expect(screen.getByText(/morning brief/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("7:00 AM"));

    // done, personalized
    expect(screen.getByText(/You’re set, Alex\./)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Enter JARVIS"));

    await waitFor(() => expect(onFinish).toHaveBeenCalled());
  });

  it("the seed questions are optional, and answering one turns the skip into a continue", () => {
    setup();
    fireEvent.click(screen.getByText("Begin"));
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Alex" } });
    fireEvent.click(screen.getByLabelText("Send"));
    fireEvent.click(screen.getByText("Personal"));
    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(screen.getByText(/add people as I go/));
    fireEvent.click(screen.getByText("Skip for now"));
    fireEvent.click(screen.getByText("9 to 5"));

    // Nothing tapped: the button says so, rather than pretending an answer.
    expect(screen.getByText("Skip these")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Early morning"));
    expect(screen.getByText("Continue")).toBeInTheDocument();
    // Tapping the same chip again clears it, so no answer is a trap.
    fireEvent.click(screen.getByText("Early morning"));
    expect(screen.getByText("Skip these")).toBeInTheDocument();
  });

  it("asks a student different questions than a personal user", () => {
    // Template-specific on purpose: "what eats your week" is not a question
    // you ask a sixteen-year-old with practice at four.
    setup();
    fireEvent.click(screen.getByText("Begin"));
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Alex" } });
    fireEvent.click(screen.getByLabelText("Send"));
    fireEvent.click(screen.getByText("Student"));
    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(screen.getByText(/add people as I go/));
    fireEvent.click(screen.getByText("Skip for now"));
    fireEvent.click(screen.getByText("9 to 5"));
    expect(screen.getByText("How many days a week do you train?")).toBeInTheDocument();
    expect(screen.queryByText("When is your head clearest?")).not.toBeInTheDocument();
  });

  it("intro Skip finishes immediately", async () => {
    const onFinish = setup();
    fireEvent.click(screen.getByText("Skip for now"));
    await waitFor(() => expect(onFinish).toHaveBeenCalled());
  });

  // B6-1 (2026-09-04): a failed profile write used to leave saving latched
  // true forever, so "Enter JARVIS" stayed disabled with nothing on screen
  // to explain why and no way to retry. The fix wraps the whole write in
  // attemptWrite and always releases saving on the way out.
  it("a failed save unlocks Enter JARVIS instead of bricking it forever", async () => {
    const onFinish = setup();
    const spy = vi.spyOn(ProfileService.prototype, "save").mockRejectedValueOnce(new Error("network"));

    fireEvent.click(screen.getByText("Begin"));
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Alex" } });
    fireEvent.click(screen.getByLabelText("Send"));
    fireEvent.click(screen.getByText("Personal"));
    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(screen.getByText(/add people as I go/));
    fireEvent.click(screen.getByText("Skip for now"));
    fireEvent.click(screen.getByText("9 to 5"));
    fireEvent.click(screen.getByText("Skip these"));
    fireEvent.click(screen.getByText("Everything"));
    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(screen.getByText("7:00 AM"));

    const enter = screen.getByText("Enter JARVIS");
    fireEvent.click(enter);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(onFinish).not.toHaveBeenCalled();
    // The button releases instead of staying disabled forever.
    await waitFor(() => expect(enter).not.toBeDisabled());

    // A retry, with the write no longer failing, goes all the way through.
    spy.mockRestore();
    fireEvent.click(enter);
    await waitFor(() => expect(onFinish).toHaveBeenCalled());
  });

  // SHELL-F-09 (2026-09-05): Redo Setup says "Your data stays" and then ran
  // this flow, which was written for an empty account, so every default
  // answer overwrote a real setting: the arranged tab bar, the AI level, the
  // morning brief time, the name, the template.
  describe("SHELL-F-09: a redo changes only what the person changes", () => {
    afterEach(() => vi.restoreAllMocks());

    const EXISTING = {
      name: "Dave",
      template: "student" as const,
      tabs: ["today", "life", "schedule", "email", "brain"],
      briefTime: "06:00",
      ai: { level: "everything" as const },
      gmail: true,
      calendar: true,
      onboarded: false,
    };

    it("keeps the tab bar, the AI level, the brief time and the template", async () => {
      const get = vi.spyOn(ProfileService.prototype, "get").mockResolvedValue(EXISTING as never);
      const list = vi.spyOn(CategoriesService.prototype, "list").mockResolvedValue([]);
      const patches: Record<string, unknown>[] = [];
      vi.spyOn(ProfileService.prototype, "save").mockImplementation(async (p) => { patches.push(p as Record<string, unknown>); return EXISTING as never; });

      setup();
      // list() is the last call the hydration makes, so by the time it fires
      // every answer has been seeded from the profile.
      await waitFor(() => expect(get).toHaveBeenCalled());
      await waitFor(() => expect(list).toHaveBeenCalled());
      fireEvent.click(screen.getByText("Skip for now"));
      await waitFor(() => expect(patches.length).toBe(1));

      const patch = patches[0]!;
      // The tab bar is untouched: the key is not in the patch at all, so the
      // arrangement cannot be overwritten and cannot be cleared.
      expect(patch).not.toHaveProperty("tabs");
      expect(patch.name).toBe("Dave");
      expect(patch.template).toBe("student");
      expect(patch.ai).toEqual({ level: "everything" });
      expect(patch.briefTime).toBe("06:00");
      expect(patch.gmail).toBe(true);
    });

    it("a first run still gets the new-user tab bar", async () => {
      const get = vi.spyOn(ProfileService.prototype, "get").mockResolvedValue(null);
      const patches: Record<string, unknown>[] = [];
      vi.spyOn(ProfileService.prototype, "save").mockImplementation(async (p) => { patches.push(p as Record<string, unknown>); return EXISTING as never; });
      setup();
      await waitFor(() => expect(get).toHaveBeenCalled());
      fireEvent.click(screen.getByText("Skip for now"));
      await waitFor(() => expect(patches.length).toBe(1));
      expect(patches[0]!.tabs).toEqual(NEW_USER_TABS);
    });

    it("the payoff draws the areas that exist, not six that were never made", async () => {
      vi.spyOn(ProfileService.prototype, "get").mockResolvedValue(EXISTING as never);
      const list = vi.spyOn(CategoriesService.prototype, "list").mockResolvedValue([
        { id: "c1", data: { name: "School", color: "blue", icon: "book" } },
        { id: "c2", data: { name: "Team", color: "orange", icon: "trophy" } },
      ] as never);
      setup();
      await waitFor(() => expect(list).toHaveBeenCalled());

      fireEvent.click(screen.getByText("Begin"));
      fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Dave" } });
      fireEvent.click(screen.getByLabelText("Send"));
      fireEvent.click(screen.getByText("Student"));
      fireEvent.click(screen.getByText("Continue"));
      fireEvent.click(screen.getByText(/add people as I go/));
      fireEvent.click(screen.getByText("Skip for now"));
      fireEvent.click(screen.getByText("9 to 5"));
      fireEvent.click(screen.getByText("Skip these"));
      fireEvent.click(screen.getByText("Everything"));
      fireEvent.click(screen.getByText("Continue"));
      fireEvent.click(screen.getByText("7:00 AM"));

      // Two areas exist, so two dots. The template seeds (six) are never
      // written on a redo, so drawing six of them was a promise of areas the
      // account was not going to have.
      expect(document.querySelectorAll(".cat-dot").length).toBe(2);
    });
  });

  it("lets you remove a starter category and add one", () => {
    setup();
    fireEvent.click(screen.getByText("Begin"));
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Sam" } });
    fireEvent.click(screen.getByLabelText("Send"));
    fireEvent.click(screen.getByText("Business"));
    // business defaults include Clients; remove it
    expect(screen.getByDisplayValue("Clients")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove Clients"));
    expect(screen.queryByDisplayValue("Clients")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Add Area"));
    expect(screen.getByDisplayValue("New Area")).toBeInTheDocument();
  });
});

// SHARED-F-07 (2026-09-05): the OS notification prompt used to fire on
// Today's first paint, from the check-in scheduler, before the user had seen
// a screen explaining why, and a denial there is permanent. The ask now rides
// the one question in the app it belongs to: when the morning brief arrives.
describe("OnboardingFlow asks for notifications in context", () => {
  it("choosing a brief time is what asks, and nothing before it does", () => {
    const spy = vi.spyOn(notifications, "requestNotificationPermission").mockResolvedValue(true);
    setup();
    fireEvent.click(screen.getByText("Begin"));
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "Alex" } });
    fireEvent.click(screen.getByLabelText("Send"));
    fireEvent.click(screen.getByText("Personal"));
    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(screen.getByText(/add people as I go/));
    fireEvent.click(screen.getByText("Skip for now"));
    fireEvent.click(screen.getByText("9 to 5"));
    fireEvent.click(screen.getByText("Skip these"));
    fireEvent.click(screen.getByText("Everything"));
    fireEvent.click(screen.getByText("Continue"));
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("7:00 AM"));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
