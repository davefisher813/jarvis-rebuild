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
    expect(screen.getByText(/life areas/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Work")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Continue"));

    // people
    expect(screen.getByText(/most important people/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Skip for now"));

    // priority (new optional step)
    expect(screen.getByText(/most important thing on your plate/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Skip for now"));

    // connect
    expect(screen.getByText(/Gmail and Google Calendar/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Continue"));

    // daily rhythm
    expect(screen.getByText(/morning brief/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("7:00 AM"));

    // done, personalized
    expect(screen.getByText(/all set, Alex/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Enter JARVIS"));

    await waitFor(() => expect(onFinish).toHaveBeenCalled());
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
    fireEvent.click(screen.getByText("Add Category"));
    expect(screen.getByDisplayValue("New Area")).toBeInTheDocument();
  });
});
