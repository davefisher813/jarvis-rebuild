import LegalScreen from "./LegalScreen";

export default function PrivacyPage({ onBack }: { onBack: () => void }) {
  return (
    <LegalScreen title="Privacy Policy" updated="May 2026" onBack={onBack}>
      <h4 className="legal-h">What we collect</h4>
      <p>The content you create in the app (notes, tasks, events, and similar), plus basic account information when you sign in.</p>
      <h4 className="legal-h">How it is used</h4>
      <p>Your data is used to provide the app's features to you. It is not sold.</p>
      <h4 className="legal-h">Where it is stored</h4>
      <p>Until you sign in with a synced account, your data stays on your device. With an account, it is stored to sync across your devices.</p>
      <h4 className="legal-h">Third parties</h4>
      <p>We use service providers for sign-in, sync, and error reporting. They process data only to deliver those functions.</p>
      <h4 className="legal-h">Your choices</h4>
      <p>You can export your data at any time from Settings, and request deletion of your account.</p>
      <h4 className="legal-h">Children</h4>
      <p>JARVIS is not directed to children under the age required by your local law.</p>
      <h4 className="legal-h">Contact</h4>
      <p>Privacy questions can be sent to your support contact listed in the app.</p>
    </LegalScreen>
  );
}
