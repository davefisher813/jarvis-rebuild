// iOS-style pushed-screen header: a tinted back button labeled with the parent
// screen ("< Settings") above a large bold title. Pairs with the
// `.nav-bar + .nav-large` spacing rule.
export default function LargeTitleNav({ title, back, onBack }: { title: string; back: string; onBack: () => void }) {
  return (
    <>
      <div className="nav-bar"><button className="nav-back" onClick={onBack}>{back}</button></div>
      <div className="nav-large">{title}</div>
    </>
  );
}
