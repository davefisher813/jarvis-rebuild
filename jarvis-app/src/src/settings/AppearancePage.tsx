import { useAppearance } from "../appearance/AppearanceProvider";
import LargeTitleNav from "../shared/LargeTitleNav";

const BACK = (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
);

export default function AppearancePage({ onBack }: { onBack: () => void }) {
  const { appearance, setTheme } = useAppearance();
  return (
    <div className="screen">
      <LargeTitleNav title="Appearance" back="Settings" onBack={onBack} />
      <div className="grp"><div className="eyebrow">Theme</div></div>
      <div className="seg-card">
        <div className="segmented">
          <div className={"seg" + (appearance.theme === "dark" ? " active" : "")} role="button" tabIndex={0} onClick={() => setTheme("dark")}>Dark</div>
          <div className={"seg" + (appearance.theme === "light" ? " active" : "")} role="button" tabIndex={0} onClick={() => setTheme("light")}>Light</div>
        </div>
      </div>
    </div>
  );
}
