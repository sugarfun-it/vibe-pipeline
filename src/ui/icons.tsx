import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export const PlusIcon = (p: IconProps) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const BellIcon = (p: IconProps) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M6 8a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7Z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </svg>
);

export const GearIcon = (p: IconProps) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
);

export const FolderIcon = (p: IconProps) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
  </svg>
);

export const ChevronIcon = (p: IconProps) => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const CheckIconSm = (p: IconProps) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M4 12.5 9.5 18 20 6" />
  </svg>
);

export const WarnIcon = (p: IconProps) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 3 2 21h20L12 3Z" />
    <path d="M12 9v5" />
    <circle cx="12" cy="17.5" r="0.8" fill="currentColor" />
  </svg>
);

export const MergeIcon = (p: IconProps) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="6" cy="6" r="2" />
    <circle cx="6" cy="18" r="2" />
    <circle cx="18" cy="18" r="2" />
    <path d="M6 8v8" />
    <path d="M6 8a8 8 0 0 0 8 8h2" />
  </svg>
);

export const CheckCircleIcon = (p: IconProps) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 3 3 5-6" />
  </svg>
);

export const CloseIcon = (p: IconProps) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const FolderQuestionIcon = (p: IconProps) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    <path d="M12 11.5a1.6 1.6 0 1 1 2.4 1.4c-.7.4-.9.7-.9 1.3" />
    <circle cx="13.5" cy="16.5" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const RefreshIcon = (p: IconProps) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);

// Lucide history:時鐘 + 逆時針箭頭,語意「歷史紀錄」最典型
export const HistoryIcon = (p: IconProps) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </svg>
);

export const SpinnerIcon = (p: IconProps) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="spin" {...p}>
    <path d="M12 3a9 9 0 1 1-9 9" />
  </svg>
);

export const ScissorsIcon = (p: IconProps) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
  </svg>
);

export const TrashIcon = (p: IconProps) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const InboxEmptyIcon = (p: IconProps) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="m4 12 5 5 11-11" />
  </svg>
);

export const SunIcon = (p: IconProps) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

export const MoonIcon = (p: IconProps) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

// 取代 raw glyph `⋯`
export const DotsHorizontalIcon = (p: IconProps) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

// alias used by codex spec
export const MoreHorizontalIcon = DotsHorizontalIcon;

// 取代 raw glyph `⎇`(branch / worktree)
export const BranchIcon = (p: IconProps) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="6" cy="5" r="2" />
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="7" r="2" />
    <path d="M6 7v10" />
    <path d="M18 9c0 4-6 4-6 8" />
  </svg>
);

// 取代 raw glyph `✎` / `✏︎`(edit)
export const PencilIcon = (p: IconProps) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M4 20h4l10-10-4-4L4 16v4Z" />
    <path d="m14 6 4 4" />
  </svg>
);

// alias
export const EditIcon = PencilIcon;

// 取代 raw glyph `▶`(play / run)
export const PlayIcon = (p: IconProps) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M7 5v14l12-7L7 5Z" fill="currentColor" />
  </svg>
);

// 取代 raw glyph `⏹`(stop)
export const StopIcon = (p: IconProps) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
  </svg>
);

// 取代 raw glyph `⏳`(hourglass / pending)
export const HourglassIcon = (p: IconProps) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M6 3h12" />
    <path d="M6 21h12" />
    <path d="M7 3v3a5 5 0 0 0 2 4l3 2 3-2a5 5 0 0 0 2-4V3" />
    <path d="M7 21v-3a5 5 0 0 1 2-4l3-2 3 2a5 5 0 0 1 2 4v3" />
  </svg>
);

// 取代 raw glyph `↑`(arrow up)
export const ArrowUpIcon = (p: IconProps) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 19V5" />
    <path d="m6 11 6-6 6 6" />
  </svg>
);

// 取代 raw glyph `→`(arrow right;next / 流程箭頭)
export const ArrowRightIcon = (p: IconProps) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
);

// 取代 raw glyph `🏠`(home / project home)
export const HomeIcon = (p: IconProps) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M3 11 12 3l9 8" />
    <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
  </svg>
);

// 取代 raw glyph `📄`(file / doc)
export const FileIcon = (p: IconProps) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
  </svg>
);

// 取代 raw glyph `⚠`(warning;同 WarnIcon,提供與 codex spec 對齊的命名)
export const WarningIcon = WarnIcon;

// alias used by codex spec
export const AlertTriangleIcon = WarnIcon;

// 取代外連結 glyph(↗ 等)
export const ExternalLinkIcon = (p: IconProps) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4 10 14" />
    <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
  </svg>
);

// 通用點(status dot 等);size 由 width/height props 控制
export const DotIcon = (p: IconProps) => (
  <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" {...p}>
    <circle cx="12" cy="12" r="6" />
  </svg>
);

