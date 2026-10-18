import { ChevronLeft } from "./icons";

// THE ONE BACK CONTROL (Dave 2026-10-18: "We don't need both of these. The labeled one should take place of the regular one
// everywhere. Just needs to make sure it adjusts accordingly."). The app had two: a bare red chevron in a screen's bar, and the
// shell's labeled return pill ("< Life"). There is one now, the labeled capsule, and it cannot be drawn without a label: the
// label is the screen it returns to (Life, Today, Schedule, Health, a note's name), said by whoever knows the destination, never
// a default that is right for one parent and wrong for another (laws/backNav.test.ts holds that).
//
// A bar draws it with the default class (.nav-back, kept as the bar's name for it so the places that find the back by it keep
// finding it); the shell's return pill passes its own class for where it stands. The look is the same capsule either way.
export default function BackPill({ label, onClick, className = "nav-back", disabled }: { label: string; onClick: () => void; className?: string; disabled?: boolean }) {
  return (
    <button type="button" className={"back-pill " + className} onClick={onClick} {...(disabled ? { disabled: true } : {})}>
      <ChevronLeft className="ic" />
      <span className="back-pill-t">{label}</span>
    </button>
  );
}
