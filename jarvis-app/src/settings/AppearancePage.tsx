import { useAppearance, type TextSize } from "../appearance/AppearanceProvider";
import { useOptionalProfile } from "../data/NotesProvider";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Head, Card, Menu, Foot } from "./kit";
import { attemptWrite } from "../shared/guard";

// UP-PLAT-09 (2026-09-06): Title Case, because these name a setting.
const SIZE_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "larger", label: "Larger" },
  { value: "largest", label: "Largest" },
];

export default function AppearancePage({ onBack }: { onBack: () => void }) {
  const { appearance, setTheme, setTextSize } = useAppearance();
  const profile = useOptionalProfile();

  // UP-PLAT-09: the choice follows the account, not the phone. It applies to
  // this session at once (the provider owns the root attribute) and the
  // profile write is guarded, so a failed save says so rather than coming
  // back at the next launch with nothing having been said. The local mirror
  // in the provider still holds it for the synchronous first paint.
  const pickSize = async (v: string) => {
    const next = v as TextSize;
    const prev = appearance.textSize;
    setTextSize(next);
    if (!profile) return;
    if (!(await attemptWrite(() => profile.save({ textSize: next })))) setTextSize(prev);
  };

  return (
    <div className="screen ruled">
      <LargeTitleNav title="Appearance" back="Settings" onBack={onBack} />
      <Head label="Theme" />
      <Card>
        <Menu label="Theme" value={appearance.theme} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]}
          onPick={(v) => setTheme(v as "dark" | "light")} />
      </Card>
      <Head label="Text Size" />
      <Card>
        <Menu label="Text Size" value={appearance.textSize} options={SIZE_OPTIONS} onPick={(v) => void pickSize(v)} />
      </Card>
      {/* Sentence case: this talks. It says what the setting is for and what
          it does not do, which is override the phone downward. */}
      <Foot>Bigger text everywhere in JARVIS. Your phone&rsquo;s own text size still applies.</Foot>
      <div className="screen-foot" />
    </div>
  );
}
