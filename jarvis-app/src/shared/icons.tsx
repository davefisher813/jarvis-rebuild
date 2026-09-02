// DUAL-WEIGHT ICONS (Dave 2026-08-22: "on the light version filled in
// icons look MUCH better. Can we fill those in exclusively on the light
// version?").
//
// A stroke icon cannot simply be filled -- pouring fill into an outline
// path is the compass-blob bug, banned by law since 2026-08-18. A filled
// glyph has to be a DIFFERENT, professionally drawn shape. So every icon
// ships as a pair: the lucide outline the app already used, and Phosphor's
// FILL-weight twin. The stylesheet shows exactly one per theme.
//
// Why a pair instead of swapping the library outright: dark theme keeps the
// lucide drawings it already had, pixel for pixel. Only light changes.
// Call sites are untouched apart from their import line, so an icon cannot
// be added later that forgets to have a filled state.

import type { ComponentProps, ReactElement } from "react";
import { AlertTriangle as AlertTriangleOutline, AlignLeft as AlignLeftOutline, Archive as ArchiveOutline, ArrowDown as ArrowDownOutline, ArrowUp as ArrowUpOutline, Bell as BellOutline, BellRing as BellRingOutline, Bold as BoldOutline, Brain as BrainOutline, Calendar as CalendarOutline, CalendarCheck as CalendarCheckOutline, CalendarClock as CalendarClockOutline, CalendarDays as CalendarDaysOutline, CalendarPlus as CalendarPlusOutline, Camera as CameraOutline, Check as CheckOutline, CheckSquare as CheckSquareOutline, ChevronDown as ChevronDownOutline, ChevronLeft as ChevronLeftOutline, ChevronRight as ChevronRightOutline, ChevronUp as ChevronUpOutline, CircleSlash as CircleSlashOutline, Clock as ClockOutline, CornerUpLeft as CornerUpLeftOutline, DollarSign as DollarSignOutline, Dumbbell as DumbbellOutline, Ellipsis as EllipsisOutline, FileText as FileTextOutline, Flame as FlameOutline, Gauge as GaugeOutline, Hourglass as HourglassOutline, PersonStanding as PersonStandingOutline, Shuffle as ShuffleOutline, StickyNote as StickyNoteOutline, Timer as TimerOutline, FolderKanban as FolderKanbanOutline, Forward as ForwardOutline, Heading as HeadingOutline, Heading1 as Heading1Outline, Highlighter as HighlighterOutline, Home as HomeOutline, Image as ImageOutline, Info as InfoOutline, Italic as ItalicOutline, Lightbulb as LightbulbOutline, Link2 as Link2Outline, List as ListOutline, ListChecks as ListChecksOutline, ListOrdered as ListOrderedOutline, ListTodo as ListTodoOutline, Mail as MailOutline, MessageSquare as MessageSquareOutline, MoreHorizontal as MoreHorizontalOutline, Paperclip as PaperclipOutline, PenLine as PenLineOutline, Pilcrow as PilcrowOutline, Plus as PlusOutline, Redo2 as Redo2Outline, RotateCcw as RotateCcwOutline, Search as SearchOutline, Send as SendOutline, ShieldAlert as ShieldAlertOutline, Sparkles as SparklesOutline, Strikethrough as StrikethroughOutline, Table as TableOutline, Tag as TagOutline, Target as TargetOutline, Trash2 as Trash2Outline, Type as TypeOutline, Undo2 as Undo2Outline, User as UserOutline, Volume2 as Volume2Outline, Wallet as WalletOutline, X as XOutline, Zap as ZapOutline } from "lucide-react";
import { Archive as ArchiveFill, ArrowBendUpLeft as ArrowBendUpLeftFill, ArrowBendUpRight as ArrowBendUpRightFill, ArrowCounterClockwise as ArrowCounterClockwiseFill, ArrowDown as ArrowDownFill, ArrowUUpLeft as ArrowUUpLeftFill, ArrowUUpRight as ArrowUUpRightFill, ArrowUp as ArrowUpFill, BellRinging as BellRingingFill, BellSimple as BellSimpleFill, Brain as BrainFill, CalendarBlank as CalendarBlankFill, CalendarCheck as CalendarCheckFill, CalendarDot as CalendarDotFill, CalendarDots as CalendarDotsFill, CalendarPlus as CalendarPlusFill, Camera as CameraFill, CaretDown as CaretDownFill, CaretLeft as CaretLeftFill, CaretRight as CaretRightFill, CaretUp as CaretUpFill, ChatCircle as ChatCircleFill, Check as CheckFill, CheckSquare as CheckSquareFill, Clock as ClockFill, CurrencyDollar as CurrencyDollarFill, DotsThree as DotsThreeFill, Barbell as BarbellFill, EnvelopeSimple as EnvelopeSimpleFill, FileText as FileTextFill, Flame as FlameFill, Gauge as GaugeFill, Hourglass as HourglassFill, Person as PersonFill, Shuffle as ShuffleFill, Note as NoteFill, Timer as TimerFill, Highlighter as HighlighterFill, House as HouseFill, Image as ImageFill, Info as InfoFill, Kanban as KanbanFill, Lightbulb as LightbulbFill, Lightning as LightningFill, LinkSimple as LinkSimpleFill, ListBullets as ListBulletsFill, ListChecks as ListChecksFill, ListNumbers as ListNumbersFill, MagnifyingGlass as MagnifyingGlassFill, PaperPlaneTilt as PaperPlaneTiltFill, Paperclip as PaperclipFill, Paragraph as ParagraphFill, PencilSimple as PencilSimpleFill, Plus as PlusFill, Prohibit as ProhibitFill, ShieldWarning as ShieldWarningFill, Sparkle as SparkleFill, SpeakerHigh as SpeakerHighFill, Table as TableFill, Tag as TagFill, Target as TargetFill, TextAlignLeft as TextAlignLeftFill, TextB as TextBFill, TextH as TextHFill, TextHOne as TextHOneFill, TextItalic as TextItalicFill, TextStrikethrough as TextStrikethroughFill, TextT as TextTFill, Trash as TrashFill, User as UserFill, Wallet as WalletFill, Warning as WarningFill, X as XFill } from "@phosphor-icons/react";


type IconProps = ComponentProps<"svg"> & { size?: number | string };

// The app's icon TYPE is now the pair component, not lucide's. Kept under
// the old name so no call site has to learn a new one.
export type LucideIcon = (props: IconProps) => ReactElement;

// CONTROLS STAY OUTLINE, IN BOTH THEMES. Fill is for glyphs that NAME a
// thing (a house, an envelope, a wallet). A control is something you operate
// with, and Phosphor's fill weight turns those into blobs the same way
// poured fill did: a filled magnifier is a disc, a filled "..." is a badge,
// and a filled chevron is a triangle. Apple never fills them either.
function outline(Out: React.ElementType) {
  return function Icon(props: IconProps) {
    return <Out {...props} />;
  };
}

function pair(Out: React.ElementType, Fill: React.ElementType) {
  return function Icon({ className, ...rest }: IconProps) {
    const cls = className ?? "";
    return (
      <>
        <Out className={cls + " ic-out"} {...rest} />
        <Fill className={cls + " ic-fill"} weight="fill" {...rest} />
      </>
    );
  };
}

export const AlertTriangle = /* @__PURE__ */ pair(AlertTriangleOutline, WarningFill);
export const AlignLeft = /* @__PURE__ */ outline(AlignLeftOutline);
export const Archive = /* @__PURE__ */ pair(ArchiveOutline, ArchiveFill);
export const ArrowDown = /* @__PURE__ */ outline(ArrowDownOutline);
export const ArrowUp = /* @__PURE__ */ outline(ArrowUpOutline);
export const Bell = /* @__PURE__ */ pair(BellOutline, BellSimpleFill);
export const BellRing = /* @__PURE__ */ pair(BellRingOutline, BellRingingFill);
export const Bold = /* @__PURE__ */ outline(BoldOutline);
export const Brain = /* @__PURE__ */ pair(BrainOutline, BrainFill);
export const Calendar = /* @__PURE__ */ pair(CalendarOutline, CalendarBlankFill);
export const CalendarCheck = /* @__PURE__ */ pair(CalendarCheckOutline, CalendarCheckFill);
export const CalendarClock = /* @__PURE__ */ pair(CalendarClockOutline, CalendarDotFill);
export const CalendarDays = /* @__PURE__ */ pair(CalendarDaysOutline, CalendarDotsFill);
export const CalendarPlus = /* @__PURE__ */ pair(CalendarPlusOutline, CalendarPlusFill);
export const Camera = /* @__PURE__ */ outline(CameraOutline);
export const Check = /* @__PURE__ */ outline(CheckOutline);
export const CheckSquare = /* @__PURE__ */ pair(CheckSquareOutline, CheckSquareFill);
export const ChevronDown = /* @__PURE__ */ outline(ChevronDownOutline);
export const ChevronLeft = /* @__PURE__ */ outline(ChevronLeftOutline);
export const ChevronRight = /* @__PURE__ */ outline(ChevronRightOutline);
export const ChevronUp = /* @__PURE__ */ outline(ChevronUpOutline);
export const CircleSlash = /* @__PURE__ */ pair(CircleSlashOutline, ProhibitFill);
export const Clock = /* @__PURE__ */ pair(ClockOutline, ClockFill);
export const CornerUpLeft = /* @__PURE__ */ outline(CornerUpLeftOutline);
export const DollarSign = /* @__PURE__ */ pair(DollarSignOutline, CurrencyDollarFill);
export const Ellipsis = /* @__PURE__ */ outline(EllipsisOutline);
export const FileText = /* @__PURE__ */ pair(FileTextOutline, FileTextFill);
// THE EXERCISE SHEET'S ROW TILES (Fewer Buttons, 2026-09-02): each row of
// the grouped table leads with the glyph that names it, in a coloured tile,
// the way Settings rows do on iOS. Names, so they pair.
export const Dumbbell = /* @__PURE__ */ pair(DumbbellOutline, BarbellFill);
export const Flame = /* @__PURE__ */ pair(FlameOutline, FlameFill);
export const Gauge = /* @__PURE__ */ pair(GaugeOutline, GaugeFill);
export const Hourglass = /* @__PURE__ */ pair(HourglassOutline, HourglassFill);
export const PersonStanding = /* @__PURE__ */ pair(PersonStandingOutline, PersonFill);
export const Shuffle = /* @__PURE__ */ pair(ShuffleOutline, ShuffleFill);
export const StickyNote = /* @__PURE__ */ pair(StickyNoteOutline, NoteFill);
export const Timer = /* @__PURE__ */ pair(TimerOutline, TimerFill);
export const FolderKanban = /* @__PURE__ */ pair(FolderKanbanOutline, KanbanFill);
export const Forward = /* @__PURE__ */ outline(ForwardOutline);
export const Heading = /* @__PURE__ */ outline(HeadingOutline);
export const Heading1 = /* @__PURE__ */ outline(Heading1Outline);
export const Highlighter = /* @__PURE__ */ outline(HighlighterOutline);
export const Home = /* @__PURE__ */ pair(HomeOutline, HouseFill);
export const Image = /* @__PURE__ */ outline(ImageOutline);
export const Info = /* @__PURE__ */ pair(InfoOutline, InfoFill);
export const Italic = /* @__PURE__ */ outline(ItalicOutline);
export const Lightbulb = /* @__PURE__ */ pair(LightbulbOutline, LightbulbFill);
export const Link2 = /* @__PURE__ */ outline(Link2Outline);
export const List = /* @__PURE__ */ outline(ListOutline);
export const ListChecks = /* @__PURE__ */ pair(ListChecksOutline, ListChecksFill);
export const ListOrdered = /* @__PURE__ */ outline(ListOrderedOutline);
export const ListTodo = /* @__PURE__ */ pair(ListTodoOutline, ListChecksFill);
export const Mail = /* @__PURE__ */ pair(MailOutline, EnvelopeSimpleFill);
export const MessageSquare = /* @__PURE__ */ pair(MessageSquareOutline, ChatCircleFill);
export const MoreHorizontal = /* @__PURE__ */ outline(MoreHorizontalOutline);
export const Paperclip = /* @__PURE__ */ outline(PaperclipOutline);
export const PenLine = /* @__PURE__ */ pair(PenLineOutline, PencilSimpleFill);
export const Pilcrow = /* @__PURE__ */ outline(PilcrowOutline);
export const Plus = /* @__PURE__ */ outline(PlusOutline);
export const Redo2 = /* @__PURE__ */ outline(Redo2Outline);
export const RotateCcw = /* @__PURE__ */ outline(RotateCcwOutline);
export const Search = /* @__PURE__ */ outline(SearchOutline);
export const Send = /* @__PURE__ */ outline(SendOutline);
export const ShieldAlert = /* @__PURE__ */ pair(ShieldAlertOutline, ShieldWarningFill);
export const Sparkles = /* @__PURE__ */ pair(SparklesOutline, SparkleFill);
export const Strikethrough = /* @__PURE__ */ outline(StrikethroughOutline);
export const Table = /* @__PURE__ */ outline(TableOutline);
export const Tag = /* @__PURE__ */ pair(TagOutline, TagFill);
export const Target = /* @__PURE__ */ pair(TargetOutline, TargetFill);
export const Trash2 = /* @__PURE__ */ outline(Trash2Outline);
export const Type = /* @__PURE__ */ outline(TypeOutline);
export const Undo2 = /* @__PURE__ */ outline(Undo2Outline);
export const User = /* @__PURE__ */ pair(UserOutline, UserFill);
export const Volume2 = /* @__PURE__ */ pair(Volume2Outline, SpeakerHighFill);
export const Wallet = /* @__PURE__ */ pair(WalletOutline, WalletFill);
export const X = /* @__PURE__ */ outline(XOutline);
export const Zap = /* @__PURE__ */ pair(ZapOutline, LightningFill);
