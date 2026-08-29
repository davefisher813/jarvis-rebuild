import type { ConsentGrant, HealthCategoryId } from "../types";
import { HEALTH_CATEGORIES, HEALTH_CATEGORY_LABEL, HEALTH_CATEGORY_DESC, KID_ROOM_CATEGORIES, KID_ROOM_LABEL, DEFAULT_GRANTED } from "../shareLine";
import { haptics } from "../../shared/haptics";

// THE SHARE LINE (Part 7). One screen, every category, an explicit on/off
// the ATHLETE controls. Off by default for everything except logistics.
// Revocable at any time: this is one tap, no confirmation sheet, no "are you
// sure", no notification framed as an accusation when it changes.
//
// THE KID'S ROOM lives on this same screen, on purpose: the strongest thing
// this screen can say is that some rows are not switches at all. Its rows
// carry no onClick, so there is no code path here that can ever call
// onToggle with a Kid's Room category. src/laws/healthPrivacy.test.ts checks
// that literally.
export default function ShareLineScreen({
  grants, onToggle, onOpenWhatTheySee, onBack,
}: {
  grants: ConsentGrant[];
  onToggle: (category: HealthCategoryId, granted: boolean) => void;
  onOpenWhatTheySee: () => void;
  onBack: () => void;
}) {
  const grantedFor = (c: HealthCategoryId) => grants.find((g) => g.category === c)?.granted ?? DEFAULT_GRANTED[c];

  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">The Share Line</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">What Crosses To Your Parent</div>
        <div className="bp-sub">Off by default. Turn on only what you want them to see, one category at a time. Turn it back off whenever you want, no explanation needed.</div>
      </div></div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Areas</div></div></div>
      <div className="pad-x"><div className="card">
        {HEALTH_CATEGORIES.map((c) => (
          <div className="row" key={c}>
            <div className="row-grow">
              <div className="conn-name">{HEALTH_CATEGORY_LABEL[c]}</div>
              <div className="bp-sub">{HEALTH_CATEGORY_DESC[c]}</div>
            </div>
            <button
              className={"switch" + (grantedFor(c) ? "" : " off")}
              role="switch"
              aria-checked={grantedFor(c)}
              aria-label={HEALTH_CATEGORY_LABEL[c]}
              onClick={() => { haptics.selection(); onToggle(c, !grantedFor(c)); }}
            />
          </div>
        ))}
      </div></div>

      <div className="sec-head"><div className="sec-left"><div className="sec-title">Never Shared, No Matter What</div></div></div>
      <div className="pad-x"><div className="card">
        {KID_ROOM_CATEGORIES.map((c) => (
          <div className="row" key={c}>
            <div className="row-grow">
              <div className="conn-name">{KID_ROOM_LABEL[c]}</div>
              <div className="bp-sub">Not a setting. This never crosses to your parent, no matter what.</div>
            </div>
            {/* This control takes no tap, ever, from anyone, including a
                parent with the app open in front of them. */}
            <div className="switch off switch-locked" role="switch" aria-checked={false} aria-disabled="true" aria-label={KID_ROOM_LABEL[c] + ", never shared"} />
          </div>
        ))}
      </div></div>

      {/* THE OFFER. Every health screen ends in an action, never a dead
          end: here it is the direct check on the promise above. */}
      <div className="pad-x"><button className="btn btn-secondary btn-block" onClick={onOpenWhatTheySee}>See What They See</button></div>
      <div className="screen-foot" />
    </div>
  );
}
