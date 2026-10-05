import { useEffect, useState } from "react";
import { readSystemTextScale } from "../appearance/textZoom";
import { useAppearance, type Appearance, type TextSize, type Theme } from "../appearance/AppearanceProvider";
import { useSettings } from "../data/NotesProvider";
import { SETTING_APPEARANCE } from "../data/SettingsService";
import LargeTitleNav from "../shared/LargeTitleNav";
import { Head, Card, Menu } from "./kit";

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

  // THE FOOTER KEEPS ONLY PROMISES THE CODE KEEPS (2026-10-04, audit; the seam stays honest for the text-zoom work
  // that lands later). The phone's own Larger Text answers through appearance/textZoom.ts readSystemTextScale, which
  // is null until the native plugin is wired. The moment it answers a number, Default follows the phone (the
  // AppearanceProvider already applies it) and the footer says so; until then it says only what the menu does.
  const [phoneScale, setPhoneScale] = useState<number | null>(null);
  useEffect(() => {
    let on = true;
    void readSystemTextScale().then((n) => { if (on) setPhoneScale(n); });
    return () => { on = false; };
  }, []);

  return (
    <div className="screen ruled">
      <LargeTitleNav title="Appearance" back="Settings" onBack={onBack} />
      {/* ONE HEAD, ONE CARD (Dave 2026-10-05, "say it once"): Theme and Text Size were two heads over two rows that said
          the same two words again. */}
      <Head label="Display" />
      <Card>
        <Menu label="Theme" value={appearance.theme} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]}
          onPick={(v) => { setTheme(v as Theme); save({ theme: v as Theme }); }} />
        <Menu label="Text Size" meta={phoneScale !== null ? "Default Follows Your Phone" : "Larger Text Everywhere"} value={appearance.textSize} options={SIZE_OPTIONS}
          onPick={(v) => { setTextSize(v as TextSize); save({ textSize: v as TextSize }); }} />
      </Card>
      {/* THE CHOICE, SHOWN (2026-10-05, Dave "he opens the app and finds nothing": two rows on a blank page said nothing about
          what either did). The sample is a real row on the real tokens, so it is drawn at whatever the Text Size menu says and in
          whichever theme is on. It is not tappable; it is a ruler. */}
      <Head label="Preview" />
      <Card className="set-preview">
        <div className="row set-row" aria-hidden="true">
          <div className="row-grow">
            <div className="conn-name">Pick Up the Dry Cleaning</div>
            <div className="conn-meta"><span className="facts"><span className="fact warn">Today</span><span className="fact date">4:30 PM</span></span></div>
          </div>
        </div>
      </Card>
      <div className="screen-foot" />
    </div>
  );
}
