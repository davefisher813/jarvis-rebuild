// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import OnboardingFlow from "./OnboardingFlow";

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
