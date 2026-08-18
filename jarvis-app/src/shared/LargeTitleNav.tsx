// iOS-style pushed-screen header, rebuilt on the Library chassis (Design 2,
// approved 2026-08-18): the back button rides the sticky bar, the large title
// condenses into it on scroll with the glass + red energy line. Every pushed
// page inherits this by keeping the same signature.
import PageHeader from "./PageHeader";
import type { ReactNode } from "react";

export default function LargeTitleNav({ title, back, onBack, actions }: { title: string; back: string; onBack: () => void; actions?: ReactNode }) {
  return <PageHeader title={title} back={back} onBack={onBack} actions={actions} />;
}
