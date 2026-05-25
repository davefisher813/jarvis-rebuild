// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import NotificationsFlow from "./NotificationsFlow";

describe("NotificationsFlow", () => {
  it("shows caught-up empty state with no data", async () => {
    render(<NotesProvider userId="u1"><NotificationsFlow /></NotesProvider>);
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
  });
});
