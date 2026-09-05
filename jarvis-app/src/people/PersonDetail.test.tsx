// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import PersonDetail from "./screens/PersonDetail";
import type { Person } from "./types";

// The richer person card (2026-08-10): email, phone, writing style, and
// categories were all STORED and all hidden. Now the card shows them, and
// phone/email are launchers (tel/sms/mailto), not text to retype.

const MOM: Person = {
  id: "p1",
  data: {
    name: "Mom", group: "contacts", relationship: "Mother",
    email: "mom@example.com", phone: "(607) 555-0142",
    register: "friend", categoryIds: ["c1"],
  },
};

describe("PersonDetail reach and facts", () => {
  it("renders tappable call, text, and email rows with real hrefs", () => {
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}} categoryNames={["Family"]} />);
    expect(screen.getByText("Call").closest("a")).toHaveAttribute("href", "tel:6075550142");
    expect(screen.getByText("Text").closest("a")).toHaveAttribute("href", "sms:6075550142");
    expect(screen.getByText("Email").closest("a")).toHaveAttribute("href", "mailto:mom@example.com");
  });

  it("shows how JARVIS writes to them and their categories", () => {
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}} categoryNames={["Family"]} />);
    expect(screen.getByText("Like a close friend")).toBeInTheDocument();
    expect(screen.getByText("Family")).toBeInTheDocument();
  });

  it("flagged wins over register, same precedence as drafting", () => {
    const flagged: Person = { id: "p2", data: { ...MOM.data, flagged: true } };
    render(<PersonDetail person={flagged} onEdit={() => {}} onBack={() => {}} />);
    expect(screen.getByText("With care, always professional")).toBeInTheDocument();
  });

  it("no email or phone means no reach card, not empty launchers", () => {
    const bare: Person = { id: "p3", data: { name: "Old Import", group: "contacts" } };
    render(<PersonDetail person={bare} onEdit={() => {}} onBack={() => {}} />);
    expect(screen.queryByText("Call")).not.toBeInTheDocument();
    expect(screen.queryByText("Email")).not.toBeInTheDocument();
  });
});

// S6-Q40 (2026-09-05): "a person's card cannot reach their email." Last
// Talked and the gone-quiet check-in draft (already written for the
// Family/area pages) brought to the person's own card, presentationally --
// this screen has no service access, so the caller resolves everything.
describe("PersonDetail: Last Talked and the check-in draft (S6-Q40)", () => {
  it("no lastTalked means no row at all, not an empty one", () => {
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}} />);
    expect(screen.queryByText("Last Talked")).not.toBeInTheDocument();
  });

  it("shows the ago sentence with no Check In action while still in touch", () => {
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}} lastTalked="3 Days ago" quiet={false} onCheckIn={() => {}} />);
    expect(screen.getByText("Last Talked")).toBeInTheDocument();
    expect(screen.getByText("3 Days ago")).toBeInTheDocument();
    expect(screen.queryByText("Check In")).not.toBeInTheDocument();
  });

  it("offers Check In once gone quiet, and it fires the draft", () => {
    const onCheckIn = vi.fn();
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}} lastTalked="Gone quiet · 2 Months ago" quiet onCheckIn={onCheckIn} />);
    expect(screen.getByText("Gone quiet · 2 Months ago")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Check In"));
    expect(onCheckIn).toHaveBeenCalledTimes(1);
  });

  it("reads Drafting and stays disabled while a draft is in flight", () => {
    render(<PersonDetail person={MOM} onEdit={() => {}} onBack={() => {}} lastTalked="Gone quiet · 2 Months ago" quiet onCheckIn={() => {}} checkingIn />);
    expect(screen.getByText("Drafting")).toBeDisabled();
  });

  it("a lastTalked row appears even with no other fact, so About isn't gated shut", () => {
    const bare: Person = { id: "p4", data: { name: "Old Coach", group: "contacts" } };
    render(<PersonDetail person={bare} onEdit={() => {}} onBack={() => {}} lastTalked="Yesterday" />);
    expect(screen.getByText("Last Talked")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
  });
});
