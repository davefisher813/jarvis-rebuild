import { useState } from "react";
import { SunriseGlyph } from "../../shared/glyphs";
import { dismissSetupCard, setupCardDismissed } from "./triage";

/**
 * "Set up your brain": the one-time card on the Brain hub for existing
 * users. It deep-links the contact triage and the three-question seed, and
 * once dismissed it never comes back (localStorage).
 */
export default function SetupBrainCard({
  onOpenTriage,
  onOpenSeed,
}: {
  onOpenTriage: () => void;
  onOpenSeed: () => void;
}) {
  const [gone, setGone] = useState(setupCardDismissed());
  // Dismissal can also land while this card is mounted (the seed sheet and
  // the triage screen both dismiss it on completion), so the render reads
  // the flag every time, not just at mount.
  if (gone || setupCardDismissed()) return null;

  const dismiss = () => {
    dismissSetupCard();
    setGone(true);
  };

  return (
    <div className="pad-x"><div className="card list-card-ruled pad">
      <div className="offer-row">
        <div className="task-check-tap"><span className="row-glyph"><SunriseGlyph /></span></div>
        <div className="row-grow">
          <div className="conn-name">Set Up Your Brain</div>
          <div className="bp-sub">Three Questions and a Quick Sort, Then It Knows You</div>
        </div>
      </div>
      <div className="sheet-actions">
        <button className="btn btn-primary btn-block" onClick={onOpenSeed}>Answer 3 Questions</button>
        <button className="btn btn-secondary btn-block" onClick={onOpenTriage}>Sort Your Contacts</button>
        <button className="quiet-action" onClick={dismiss}>Not Now</button>
      </div>
    </div></div>
  );
}
