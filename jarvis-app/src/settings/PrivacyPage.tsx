import LegalScreen from "./LegalScreen";
import { SUPPORT_EMAIL } from "./support";

// SHELL-F-19 (2026-09-05): the reviewed policy published at
// public/privacy.html, kept in step with it. Four sections here have no
// counterpart on the web page and stay: uploaded files, chat history,
// document extraction and email open receipts each describe something this
// build actually does, and one of them (open receipts) is the policy line
// that licenses that feature having a switch at all. A policy that says less
// than the app does is the failure this finding is about.
export default function PrivacyPage({ onBack, back }: { onBack: () => void; back?: string }) {
  return (
    <LegalScreen title="Privacy Policy" updated="July 9, 2026" onBack={onBack} back={back}>
      <p>JARVIS is a personal productivity app. This policy explains what we collect, why, and what we never do with it. The short version: your data exists to run your app, and for nothing else.</p>
      <h4 className="legal-h">What We Collect</h4>
      <p><b>Account information.</b> Your email address, used to sign you in.</p>
      <p><b>Your content.</b> The tasks, events, notes, people, goals, categories, and settings you create. This is your data; we store it so the app works across sessions and devices.</p>
      <p><b>AI feature inputs.</b> When you use AI features (such as Plan My Day), the relevant text (for example, task names and your working hours) is sent to our AI provider, Anthropic, to generate the result. It is used to answer your request and is not used to train models.</p>
      <p><b>Basic usage records.</b> We count AI requests per account to prevent abuse and manage costs.</p>
      <h4 className="legal-h">Google Account Data</h4>
      <p>Optional. If you choose to connect Gmail or Google Calendar, JARVIS accesses that data solely to show your email and events inside the app. JARVIS's use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements. Access tokens are held in memory only and are not stored on our servers. You can disconnect at any time.</p>
      <h4 className="legal-h">What We Never Do</h4>
      <p>We do not sell your data. We do not share it with advertisers. We do not show ads. We do not use your content to train AI models.</p>
      <h4 className="legal-h">Where Your Data Lives</h4>
      <p>Your data is stored with Supabase (our database provider) with per-account access controls: your records are readable only by your account. Payments, if introduced, would be handled by their respective processors and covered by an updated policy.</p>
      <h4 className="legal-h">Files You Upload</h4>
      <p>Files you upload (images and PDFs) are stored privately in your account, readable only by you. We remove location data embedded in images before storing them. Files are deleted when you delete the item they belong to, or when you delete them directly.</p>
      <h4 className="legal-h">Conversations with JARVIS</h4>
      <p>Your conversations with JARVIS are stored in your account so the assistant can keep context. You can delete your entire chat history at any time in Settings. Deleted history is removed from our systems and is not used afterward.</p>
      <h4 className="legal-h">Documents You Upload for Extraction</h4>
      <p>Statements and documents you upload for extraction are processed to create the records you review. Merchant names from financial documents are retained with those records; you can delete any record and its source file at any time.</p>
      <h4 className="legal-h">Email Open Receipts</h4>
      <p>When enabled in Settings, mail you send through JARVIS includes an invisible image that reports back when the message is first displayed. Only an anonymous identifier and a timestamp are stored; never the recipient, subject, or content. You can turn this off any time under Settings, Connections.</p>
      <h4 className="legal-h">Your Controls</h4>
      <p><b>Export.</b> Settings, Backup lets you download everything you own as a file.</p>
      <p><b>Delete.</b> You can delete individual items in the app. To delete your entire account and its data, write to the address below and we will complete it within 30 days.</p>
      <h4 className="legal-h">Children</h4>
      <p>JARVIS is not directed at children under 13, and we do not knowingly collect data from them.</p>
      <h4 className="legal-h">Changes</h4>
      <p>If this policy changes materially, we will update this page and note it in the app.</p>
      <h4 className="legal-h">Contact</h4>
      <p>Questions or requests: {SUPPORT_EMAIL}</p>
    </LegalScreen>
  );
}
