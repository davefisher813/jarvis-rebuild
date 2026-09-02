import { useAppearance } from "../appearance/AppearanceProvider";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Head, Card, Menu } from "./kit";

export default function AppearancePage({ onBack }: { onBack: () => void }) {
  const { appearance, setTheme } = useAppearance();
  return (
    <div className="screen ruled">
      <LargeTitleNav title="Appearance" back="Settings" onBack={onBack} />
      <Head label="Theme" />
      <Card>
        <Menu label="Theme" value={appearance.theme} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]}
          onPick={(v) => setTheme(v as "dark" | "light")} />
      </Card>
      <div className="screen-foot" />
    </div>
  );
}
