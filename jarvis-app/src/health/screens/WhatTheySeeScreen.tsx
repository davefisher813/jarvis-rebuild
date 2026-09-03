import type { ConsentGrant, LightsOutEntry, AteBeforeEntry, TookItEntry, CallItEntry, PointAtItEntry } from "../types";
import { HEALTH_CATEGORIES, HEALTH_CATEGORY_LABEL, sharedView } from "../shareLine";
import { ateBeforeMarks, tookItTimeline, callItHistory } from "../timelines";

// WHAT THEY SEE (Part 7). Not a summary of the parent's view. THE SAME
// FUNCTION (sharedView, from shareLine.ts) that a real parent-facing screen
// will call runs right here, over the athlete's own full data, so what
// renders below is provably the identical filtered set a parent would get,
// not a paraphrase of it. There is no separate "preview" code path to drift
// out of sync with the real one.
export default function WhatTheySeeScreen({
  grants, lightsOut, ateBefore, tookIt, callIt, pointAtIt, onManage, onBack,
}: {
  grants: ConsentGrant[];
  lightsOut: LightsOutEntry[];
  ateBefore: AteBeforeEntry[];
  tookIt: TookItEntry[];
  callIt: CallItEntry[];
  pointAtIt: PointAtItEntry[];
  onManage: () => void;
  onBack: () => void;
}) {
  const grantedCats = HEALTH_CATEGORIES.filter((c) => grants.find((g) => g.category === c)?.granted);
  const visibleSleep = sharedView(lightsOut, grants);
  const visibleFuel = ateBeforeMarks(sharedView(ateBefore, grants));
  const visibleMed = tookItTimeline(sharedView(tookIt, grants));
  const visibleLoad = callItHistory(sharedView(callIt, grants));
  const visibleBody = sharedView(pointAtIt, grants);

  return (
    <div className="screen ruled">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">What They See</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">Your Parent's Whole View</div>
        <div className="bp-sub">This is the exact screen they get. Nothing hidden from you, nothing extra for them.</div>
      </div></div>

      {grantedCats.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">Nothing Shared Yet</div>
          <div className="empty-sub">Turn on a category and it shows up here first, exactly as your parent will see it</div>
        </div>
      ) : (
        <>
          {grantedCats.includes("sleep") && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">{HEALTH_CATEGORY_LABEL.sleep}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {visibleSleep.length === 0 ? <div className="row"><div className="row-grow"><div className="conn-name">Nothing Logged Yet</div></div></div> :
                  visibleSleep.map((e) => (
                    <div className="row" key={e.id}><div className="row-grow"><div className="conn-name">{new Date(e.data.at).toLocaleString()}</div></div></div>
                  ))}
              </div></div>
            </>
          )}
          {grantedCats.includes("fuel") && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">{HEALTH_CATEGORY_LABEL.fuel}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {visibleFuel.length === 0 ? <div className="row"><div className="row-grow"><div className="conn-name">Nothing Logged Yet</div></div></div> :
                  visibleFuel.map((m, i) => (
                    <div className="row" key={i}><div className="row-grow"><div className="conn-name">{m.eventTitle ?? m.date}</div><div className="bp-sub">{m.date}</div></div>
                      <span className={"pill " + (m.ate ? "pill-good" : "")}>{m.ate ? "Ate" : "Did Not Eat"}</span></div>
                  ))}
              </div></div>
            </>
          )}
          {grantedCats.includes("medication") && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">{HEALTH_CATEGORY_LABEL.medication}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {visibleMed.length === 0 ? <div className="row"><div className="row-grow"><div className="conn-name">Nothing Logged Yet</div></div></div> :
                  visibleMed.map((m, i) => (
                    <div className="row" key={i}><div className="row-grow"><div className="conn-name">{new Date(m.at).toLocaleString()}</div></div></div>
                  ))}
              </div></div>
            </>
          )}
          {grantedCats.includes("load") && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">{HEALTH_CATEGORY_LABEL.load}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {visibleLoad.length === 0 ? <div className="row"><div className="row-grow"><div className="conn-name">Nothing Logged Yet</div></div></div> :
                  visibleLoad.map((p, i) => (
                    <div className="row" key={i}><div className="row-grow"><div className="conn-name">{new Date(p.at).toLocaleDateString()}</div></div><span className="pill">{p.rpe}/10</span></div>
                  ))}
              </div></div>
            </>
          )}
          {grantedCats.includes("body") && (
            <>
              <div className="sh2 sh2-quiet"><span className="t">{HEALTH_CATEGORY_LABEL.body}</span></div>
              <div className="pad-x"><div className="card list-card-ruled">
                {visibleBody.length === 0 ? <div className="row"><div className="row-grow"><div className="conn-name">Nothing Logged Yet</div></div></div> :
                  visibleBody.map((e) => (
                    <div className="row" key={e.id}><div className="row-grow"><div className="conn-name">{new Date(e.data.at).toLocaleDateString()}</div><div className="bp-sub">{e.data.side}</div></div></div>
                  ))}
              </div></div>
            </>
          )}
        </>
      )}

      <div className="pad-x"><button className="btn btn-secondary btn-block" onClick={onManage}>Manage What's Shared</button></div>
      <div className="screen-foot" />
    </div>
  );
}
