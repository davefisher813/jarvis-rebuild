import LegalScreen from "./LegalScreen";

export default function TermsPage({ onBack }: { onBack: () => void }) {
  return (
    <LegalScreen title="Terms of Service" updated="May 2026" onBack={onBack}>
      <h4 className="legal-h">1. Acceptance</h4>
      <p>By using JARVIS you agree to these terms. If you do not agree, do not use the app.</p>
      <h4 className="legal-h">2. Your account</h4>
      <p>You are responsible for the activity on your account and for keeping your sign-in credentials secure.</p>
      <h4 className="legal-h">3. Acceptable use</h4>
      <p>Use JARVIS only for lawful purposes. Do not attempt to disrupt, reverse engineer, or misuse the service.</p>
      <h4 className="legal-h">4. Your content</h4>
      <p>You own the notes, tasks, and other content you create. You grant us the limited permission needed to store and display it back to you.</p>
      <h4 className="legal-h">5. Availability</h4>
      <p>The service is provided on an "as is" basis. We do not guarantee it will always be available or error free.</p>
      <h4 className="legal-h">6. Termination</h4>
      <p>You may stop using JARVIS at any time. We may suspend access if these terms are violated.</p>
      <h4 className="legal-h">7. Contact</h4>
      <p>Questions about these terms can be sent to your support contact listed in the app.</p>
    </LegalScreen>
  );
}
