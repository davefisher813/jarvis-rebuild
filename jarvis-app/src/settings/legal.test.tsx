// @vitest-environment jsdom
// SHELL-F-19 (2026-09-05): every legal screen opened with "Template copy.
// Replace with your legal-reviewed text before launch." and Support gave out
// support@your-domain.com. Two of these screens are reachable from Sign In,
// before an account exists, so they were the first thing a stranger could
// read about this app. These pages carry the reviewed text published in
// public/ now, and this test is what keeps a placeholder from coming back.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TermsPage from "./TermsPage";
import PrivacyPage from "./PrivacyPage";
import SupportPage from "./SupportPage";
import { SUPPORT_EMAIL } from "./support";

const PAGES = [
  { name: "Terms of Service", node: <TermsPage onBack={() => {}} />, publicFile: "terms.html" },
  { name: "Privacy Policy", node: <PrivacyPage onBack={() => {}} />, publicFile: "privacy.html" },
  { name: "Support", node: <SupportPage onBack={() => {}} />, publicFile: "support.html" },
];

describe("the legal screens", () => {
  it("carry no template banner and no placeholder address", () => {
    for (const p of PAGES) {
      const { unmount, container } = render(p.node);
      expect(screen.getAllByText(p.name).length).toBeGreaterThan(0);
      expect(container.textContent).not.toMatch(/Template copy|before launch|your-domain/);
      unmount();
    }
  });

  it("give the same support address the published pages give", () => {
    for (const p of PAGES) {
      const published = readFileSync(join(__dirname, "../../public", p.publicFile), "utf8");
      expect(published).toContain(SUPPORT_EMAIL);
    }
    const { container } = render(<SupportPage onBack={() => {}} />);
    expect(container.textContent).toContain(SUPPORT_EMAIL);
  });

  // These four have no counterpart on the published page and describe things
  // this build actually does. A policy that says less than the app does is
  // the same failure in the other direction.
  it("keep the app-specific disclosures the published policy has no room for", () => {
    const { container } = render(<PrivacyPage onBack={() => {}} />);
    for (const heading of ["Files You Upload", "Conversations with JARVIS", "Documents You Upload for Extraction", "Email Open Receipts"]) {
      expect(container.textContent).toContain(heading);
    }
  });
});
