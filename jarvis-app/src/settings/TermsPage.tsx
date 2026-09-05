import LegalScreen from "./LegalScreen";
import { SUPPORT_EMAIL } from "./support";

// SHELL-F-19 (2026-09-05): this was template copy under a banner that said
// so, reachable from Sign In before any account exists. The text below is the
// reviewed Terms already published at public/terms.html, kept in step with it
// so the page a person reads in the app and the page they read on the web are
// the same agreement.
export default function TermsPage({ onBack, back }: { onBack: () => void; back?: string }) {
  return (
    <LegalScreen title="Terms of Service" updated="July 9, 2026" onBack={onBack} back={back}>
      <p>These terms are a plain-language agreement between you and JARVIS ("we"). By creating an account or using the app, you agree to them.</p>
      <h4 className="legal-h">The Service</h4>
      <p>JARVIS is a personal productivity app: tasks, schedule, notes, and related features, with optional AI assistance. We work to keep it available and improving, but it is provided "as is", without warranties, and features may change.</p>
      <h4 className="legal-h">Your Account</h4>
      <p>You are responsible for your account and for keeping access to your email secure. You must be at least 13 years old.</p>
      <h4 className="legal-h">Your Content</h4>
      <p>Everything you create in JARVIS remains yours. You grant us only the limited license needed to store, process, and display it back to you, which is what makes the app function. We claim no other rights to it.</p>
      <h4 className="legal-h">Acceptable Use</h4>
      <p>Don't attempt to break, overload, reverse engineer, or gain unauthorized access to the service or other people's data, and don't use the service for unlawful activity. We may suspend accounts that do.</p>
      <h4 className="legal-h">AI Features</h4>
      <p>AI-generated suggestions (like a proposed day plan) are assistance, not professional advice. Review them before relying on them. AI features have usage limits to keep the service healthy.</p>
      <h4 className="legal-h">Availability and Data</h4>
      <p>We aim for reliability and provide an export feature (Settings, Backup); we recommend keeping backups of important data. To the maximum extent permitted by law, our liability is limited to the amount you paid us in the past 12 months.</p>
      <h4 className="legal-h">Ending Things</h4>
      <p>You can stop using JARVIS at any time and request deletion of your account. We may terminate accounts that violate these terms.</p>
      <h4 className="legal-h">Changes</h4>
      <p>If these terms change materially, we will update this page and note it in the app. Continued use after changes means acceptance.</p>
      <h4 className="legal-h">Contact</h4>
      <p>{SUPPORT_EMAIL}</p>
    </LegalScreen>
  );
}
