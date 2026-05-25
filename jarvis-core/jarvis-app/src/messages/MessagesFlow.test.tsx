// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MessagesFlow from "./MessagesFlow";

describe("MessagesFlow", () => {
  it("shows email by default, with drafts + scheduled, and switches to texts", () => {
    render(<MessagesFlow />);
    expect(screen.getByText("Re: Q3 roadmap review")).toBeInTheDocument();
    expect(screen.getByText("Drafts")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Texts"));
    expect(screen.getByText("Dana Whitfield")).toBeInTheDocument();
    expect(screen.queryByText("Re: Q3 roadmap review")).not.toBeInTheDocument();
  });
});
