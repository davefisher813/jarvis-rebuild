import type { AgeRuleFact } from "../ageRule";

// THE AGE RULE (Part 2, built carefully). Once per season: hours a week vs
// age, months in-season, days off, each citing NATA on the row. An offer,
// never a verdict -- this screen states numbers and never says "too much".
export default function AgeRuleScreen({ facts, onProtectAGap, onBack }: {
  facts: AgeRuleFact[];
  onProtectAGap: () => void;
  onBack: () => void;
}) {
  return (
    <div className="screen">
      <div className="nav-bar">
        <button className="nav-back" aria-label="Back" onClick={onBack}></button>
        <div className="nav-title">The Age Rule</div>
      </div>

      <div className="pad-x"><div className="card pad">
        <div className="p3-q">What NATA's Guideline Says</div>
        <div className="bp-sub">A fact once a season, never a verdict.</div>
      </div></div>

      <div className="pad-x"><div className="card">
        {facts.map((f, i) => (
          <div className="row" key={i}>
            <div className="row-grow">
              <div className="conn-name">{f.label}</div>
              <div className="bp-sub">Source: {f.source}</div>
            </div>
            <div className="row-value">{f.value}</div>
          </div>
        ))}
      </div></div>

      <div className="pad-x"><button className="btn btn-secondary btn-block" onClick={onProtectAGap}>Protect A Gap On The Calendar</button></div>
      <div className="screen-foot" />
    </div>
  );
}
