import { useAppearance, type Appearance, type TextSize, type Theme } from "../appearance/AppearanceProvider";
import { useSettings } from "../data/NotesProvider";
import { SETTING_APPEARANCE } from "../data/SettingsService";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Head, Card, Menu, Foot } from "./kit";

// UP-PLAT-09 (2026-09-06): Title Case, because these name a setting.
const SIZE_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "larger", label: "Larger" },
  { value: "largest", label: "Largest" },
];

export default function AppearancePage({ onBack }: { onBack: () => void }) {
  const { appearance, setTheme, setTextSize } = useAppearance();
  const settings = useSettings();

  // UP-PLAT-10 (2026-09-06): both choices follow the ACCOUNT now, through
  // data/SettingsService.ts over scalar_setting. The provider still applies
  // them to this session immediately and still mirrors them into
  // localStorage, so nothing waits on the network and an offline change is
  // kept; the account write is what makes the next phone already right.
  //
  // No failure toast on purpose, and this is the one place in the app where
  // that is correct: the write cannot fail in a way the person needs to act
  // on. Offline it stays in the mirror and goes up on the next pull or set,
  // and Settings, Backup is the one screen that says what is still waiting
  // (UP-PLAT-05).
  const save = (patch: Partial<Appearance>) => {
    void settings?.set(SETTING_APPEARANCE, { ...appearance, ...patch });
  };

  return (
    <div className="screen ruled">
      <LargeTitleNav title="Appearance" back="Settings" onBack={onBack} />
      <Head label="Theme" />
      <Card>
        <Menu label="Theme" value={appearance.theme} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]}
          onPick={(v) => { setTheme(v as Theme); save({ theme: v as Theme }); }} />
      </Card>
      <Head label="Text Size" />
      <Card>
        <Menu label="Text Size" value={appearance.textSize} options={SIZE_OPTIONS}
          onPick={(v) => { setTextSize(v as TextSize); save({ textSize: v as TextSize }); }} />
      </Card>
      {/* Sentence case: this talks. It says what the setting is for and what
          it does not do, which is override the phone downward. */}
      <Foot>Bigger text everywhere in JARVIS. Your phone&rsquo;s own text size still applies.</Foot>
      <div className="screen-foot" />
    </div>
  );
}
