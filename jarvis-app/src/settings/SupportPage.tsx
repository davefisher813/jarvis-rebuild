import LegalScreen from "./LegalScreen";
import { SUPPORT_EMAIL } from "./support";

// SHELL-F-19 (2026-09-05): this page told the person reading it to replace it
// ("Replace this with your real support email or help-desk link before
// launch. Email: support@your-domain.com"), on a screen reachable from Sign
// In. It is the help page published at public/support.html now, with the
// address that page has always carried.
export default function SupportPage({ onBack }: { onBack: () => void }) {
  return (
    <LegalScreen title="Support" onBack={onBack}>
      <p>Need help with JARVIS? You're in the right place.</p>
      <h4 className="legal-h">Common Fixes</h4>
      <p><b>App looks out of date or blank.</b> Fully close the app and reopen it twice; it self-updates.</p>
      <p><b>Can't log in.</b> Check that your email is typed correctly and look for the sign-in email in spam.</p>
      <p><b>Something looks wrong.</b> Close and reopen the app; if it persists, email us a screenshot.</p>
      <h4 className="legal-h">Get Your Data</h4>
      <p>Settings, Backup exports everything you own as a single file, any time.</p>
      <h4 className="legal-h">Contact Us</h4>
      <p>Email {SUPPORT_EMAIL} and we'll get back to you as soon as we can. Include what you were doing and a screenshot if possible.</p>
    </LegalScreen>
  );
}
