// HAND-DRAWN GLYPHS, PAIRED (Dave 2026-08-22, sending examples of outline
// icons: the Today double-chevron, the Checklist document, the note files).
//
// Not every icon in the app came from a library. Forty-three shapes were
// drawn inline as raw SVG, and those were invisible to the icons.tsx pairing
// -- they would have stayed outline in light while everything around them
// filled, which is the mixed-state a surface is never allowed to be.
//
// The OUTLINE half here is the exact markup that was already in the file,
// character for character, so dark cannot move. Only the filled twin is new.
// Controls that happen to be hand-drawn (back chevrons, plus, trash, search,
// send, drag handles) are deliberately absent: fill is for glyphs that NAME
// a thing, and a filled control is a blob.

import {
  ArrowsClockwise as ArrowsClockwiseFill,
  Barbell as BarbellFill,
  BellSimple as BellSimpleFill,
  CalendarBlank as CalendarBlankFill,
  CaretDoubleRight as CaretDoubleRightFill,
  CheckCircle as CheckCircleFill,
  Clock as ClockFill,
  Cloud as CloudFill,
  CurrencyDollar as CurrencyDollarFill,
  EnvelopeSimple as EnvelopeSimpleFill,
  FileText as FileTextFill,
  Folder as FolderFill,
  FolderOpen as FolderOpenFill,
  Gift as GiftFill,
  GitFork as GitForkFill,
  Lock as LockFill,
  MapPin as MapPinFill,
  Sun as SunFill,
  SunHorizon as SunHorizonFill,
  Target as TargetFill,
  UsersThree as UsersThreeFill,
  Wallet as WalletFill,
  Warning as WarningFill,
} from "@phosphor-icons/react";

export function TargetGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /></svg>
      <TargetFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function FolderOpenGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>
      <FolderOpenFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function CalendarGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
      <CalendarBlankFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function FolderGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
      <FolderFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function BarbellGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m6.5 6.5 11 11" /><path d="m21 21-1-1" /><path d="m3 3 1 1" /><path d="m18 22 4-4" /><path d="m2 6 4-4" /><path d="m3 10 7-7" /><path d="m14 21 7-7" /></svg>
      <BarbellFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function EnvelopeGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
      <EnvelopeSimpleFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function WalletGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>
      <WalletFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function RepeatGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
      <ArrowsClockwiseFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function DollarGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
      <CurrencyDollarFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function BellGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
      <BellSimpleFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function PeopleGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></svg>
      <UsersThreeFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function ForkGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
      <GitForkFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function PinGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></svg>
      <MapPinFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function LockGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
      <LockFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function WarningGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
      <WarningFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function SunGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></svg>
      <SunFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function ClockGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
      <ClockFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function SweepGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="13 17 18 12 13 7" /><polyline points="6 17 11 12 6 7" /></svg>
      <CaretDoubleRightFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function DocGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
      <FileTextFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function CheckCircleGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
      <CheckCircleFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function GiftGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg>
      <GiftFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function SunriseGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 18a5 5 0 0 0-10 0" /><line x1="12" y1="2" x2="12" y2="9" /><line x1="4.2" y1="10.2" x2="5.6" y2="11.6" /><line x1="1" y1="18" x2="3" y2="18" /><line x1="21" y1="18" x2="23" y2="18" /><line x1="18.4" y1="11.6" x2="19.8" y2="10.2" /><polyline points="8 6 12 2 16 6" /><line x1="3" y1="22" x2="21" y2="22" /></svg>
      <SunHorizonFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function BullseyeGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /></svg>
      <TargetFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}

export function CloudGlyph({ className = "ic" }: { className?: string }) {
  return (
    <>
      <svg className={className + " ic-out"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 19a4.5 4.5 0 1 0 0-9h-1.8A7 7 0 1 0 4 14.9" /></svg>
      <CloudFill className={className + " ic-fill"} weight="fill" />
    </>
  );
}
