// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
