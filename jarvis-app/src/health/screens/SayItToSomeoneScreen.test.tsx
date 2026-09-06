// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SayItToSomeoneScreen from "./SayItToSomeoneScreen";

// UP-ATH-05 (2026-09-06): Still There? used to hand this screen nothing, and
// this screen used to dial a US number from anywhere on earth. Both halves.

const PERSON = { name: "Mom", phone: "(607) 555-0142" };
const SUMMARY = "Front, same spot. 4 sessions over 9 days: Aug 28, Sep 1, Sep 3, Sep 5.\nWorth showing someone who can look at it.";

describe("Say It to Someone carries the summary", () => {
  it("the chosen person's row opens a message with the dated summary in it", () => {
    render(<SayItToSomeoneScreen {...PERSON} handOff={SUMMARY} onSetTrustedAdult={() => {}} onBack={() => {}} />);
    const row = screen.getByText("Send This to Mom").closest("a");
    expect(row).toHaveAttribute("href", "sms:6075550142&body=" + encodeURIComponent(SUMMARY));
  });

  it("shows the athlete the whole message before any of it is sent", () => {
    render(<SayItToSomeoneScreen {...PERSON} handOff={SUMMARY} onSetTrustedAdult={() => {}} onBack={() => {}} />);
    expect(screen.getByText("What Gets Sent")).toBeInTheDocument();
    expect(screen.getByText(/4 sessions over 9 days/)).toBeInTheDocument();
  });

  it("offers the share sheet as the way out when the summary should reach somebody else", () => {
    const onShare = vi.fn();
    render(<SayItToSomeoneScreen {...PERSON} handOff={SUMMARY} onShare={onShare} onSetTrustedAdult={() => {}} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Hand It to Someone Else"));
    expect(onShare).toHaveBeenCalledWith(SUMMARY);
  });

  it("with no summary in hand it is the plain screen it always was: a call, not a message", () => {
    render(<SayItToSomeoneScreen {...PERSON} onSetTrustedAdult={() => {}} onBack={() => {}} />);
    expect(screen.getByText("Mom").closest("a")).toHaveAttribute("href", "tel:6075550142");
    expect(screen.queryByText("What Gets Sent")).not.toBeInTheDocument();
  });
});

describe("Say It to Someone dials a line that connects, or none", () => {
  it("states the line for the region it was handed", () => {
    render(
      <SayItToSomeoneScreen
        {...PERSON}
        crisisLine={{ label: "Samaritans", number: "116123" }}
        onSetTrustedAdult={() => {}}
        onBack={() => {}}
      />,
    );
    expect(screen.getByText("Samaritans").closest("a")).toHaveAttribute("href", "tel:116123");
    expect(screen.queryByText(/988/)).not.toBeInTheDocument();
  });

  it("offers no line at all where there is none we can state, and still offers the person", () => {
    render(<SayItToSomeoneScreen {...PERSON} crisisLine={null} onSetTrustedAdult={() => {}} onBack={() => {}} />);
    expect(screen.getByText("Mom")).toBeInTheDocument();
    expect(screen.queryByText(/Always here, day or night/)).not.toBeInTheDocument();
  });
});
