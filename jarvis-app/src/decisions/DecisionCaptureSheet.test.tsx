// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import DecisionCaptureSheet, { type AttachOption } from "./DecisionCaptureSheet";

// BRAIN-F-17 (2026-09-05): Change It on a decision attached to a project that
// has since been closed saved the new call with NO attachment and no warning,
// because the attach menu is the "common homes" list and the closed project
// had left it, so the id carried in from the record matched nothing on save.

const OPEN_ONE: AttachOption[] = [{ type: "project", id: "p1", label: "Spring Launch" }];

describe("DecisionCaptureSheet supersede (BRAIN-F-17)", () => {
  it("keeps an attachment whose home has left the options list", () => {
    const onSave = vi.fn();
    render(
      <DecisionCaptureSheet
        mode="supersede"
        initial={{ linkedType: "project", linkedId: "p-done", linkedLabel: "Fall Clinics" }}
        attachOptions={OPEN_ONE}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    // The menu can still name where this decision lives.
    expect(screen.getByLabelText("Attached to")).toHaveTextContent("Fall Clinics");
    fireEvent.change(screen.getByLabelText("What you decided"), { target: { value: "Saturdays only" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      decision: "Saturdays only", linkedType: "project", linkedId: "p-done", linkedLabel: "Fall Clinics",
    }));
  });

  it("still lets the attachment be moved or cleared", () => {
    const onSave = vi.fn();
    render(
      <DecisionCaptureSheet
        mode="supersede"
        initial={{ linkedType: "project", linkedId: "p-done", linkedLabel: "Fall Clinics" }}
        attachOptions={OPEN_ONE}
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Attached to"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Spring Launch" }));
    fireEvent.change(screen.getByLabelText("What you decided"), { target: { value: "Move it" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ linkedId: "p1", linkedLabel: "Spring Launch" }));
  });

  it("a new decision offers only the common homes, with nothing carried", () => {
    const onSave = vi.fn();
    render(<DecisionCaptureSheet attachOptions={OPEN_ONE} onSave={onSave} onCancel={() => {}} />);
    expect(screen.getByLabelText("Attached to")).toHaveTextContent("None");
    fireEvent.change(screen.getByLabelText("What you decided"), { target: { value: "Ship it" } });
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ decision: "Ship it", linkedId: undefined }));
  });
});
