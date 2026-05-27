import LegalScreen from "./LegalScreen";

export default function SupportPage({ onBack }: { onBack: () => void }) {
  return (
    <LegalScreen title="Support" onBack={onBack}>
      <h4 className="legal-h">Need help?</h4>
      <p>Reach out and we'll get back to you. Replace this with your real support email or help-desk link before launch.</p>
      <p>Email: support@your-domain.com</p>
      <h4 className="legal-h">Before you write</h4>
      <p>You can export your data from Settings, Backup if you want to include a copy with your message.</p>
    </LegalScreen>
  );
}
