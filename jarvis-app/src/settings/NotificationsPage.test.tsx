// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotesProvider } from "../data/NotesProvider";
import NotificationsPage from "./NotificationsPage";

describe("NotificationsPage", () => {
  it("toggles a pref off", async () => {
    render(<NotesProvider userId="u1"><NotificationsPage onBack={() => {}} /></NotesProvider>);
    const row = (await screen.findByText("Today's events")).closest(".row")!;
    const sw = row.querySelector(".switch")!;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("false"));
  });
});
