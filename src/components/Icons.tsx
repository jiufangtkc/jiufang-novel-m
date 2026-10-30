import type { ReactNode } from 'react';

interface IconProps {
  size?: number;
}

function Stroke({ size = 22, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function BookIcon({ size = 28 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.2 3.5h9.2A2.6 2.6 0 0 1 18 6.1V20l-5.2-2.4L7.6 20V6.1A2.6 2.6 0 0 0 5 3.5H6.2z"
      />
    </svg>
  );
}

export function GripIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M5 7h14M5 12h14M5 17h14" />
    </Stroke>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Stroke>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M12 5v14M5 12h14" />
    </Stroke>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M3.5 7.5h6l1.6 2H20.5v8.2a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8z" />
    </Stroke>
  );
}

export function FolderPlusIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M3 7.5h5.2l1.5 1.8H15" />
      <path d="M3 7.5V17a1.5 1.5 0 0 0 1.5 1.5H14" />
      <path d="M18 13v6M15 16h6" />
    </Stroke>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" />
      <path d="M14 3.5V8h4.5" />
    </Stroke>
  );
}

export function FilePlusIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M6 3.5h6l3 3V11" />
      <path d="M6 3.5V19a1.5 1.5 0 0 0 1.5 1.5H12" />
      <path d="M12 3.5V7h3.5" />
      <path d="M17 13v6M14 16h6" />
    </Stroke>
  );
}

export function BookmarkIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M8 4.5h8a1 1 0 0 1 1 1V20l-5-2.6L7 20V5.5a1 1 0 0 1 1-1z" />
    </Stroke>
  );
}

export function ChevronIcon({ expanded, size = 18 }: { expanded: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="12" cy="5.5" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="18.5" r="1" fill="currentColor" />
    </Stroke>
  );
}

export function SaveIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M5 4.5h11l3 3V19.5H5z" />
      <path d="M8 4.5V9h7" />
      <path d="M8 19.5v-5h8v5" />
    </Stroke>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M15 5l-7 7 7 7" />
    </Stroke>
  );
}

export function PenIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M4 20l4.2-1.1L19 8.1a1.8 1.8 0 0 0 0-2.5L18.4 5a1.8 1.8 0 0 0-2.5 0L4 16.8V20z" />
      <path d="M13.5 6.5l4 4" />
    </Stroke>
  );
}

export function CardsIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
    </Stroke>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M5 19V5" />
      <path d="M5 19h14" />
      <path d="M9 15v-4" />
      <path d="M13 15V8" />
      <path d="M17 15v-2" />
    </Stroke>
  );
}

export function GearIcon({ size = 22 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.22-1.14.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.4.31.6.22l2.39-.96c.49.4 1.04.72 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.22 1.14-.54 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"
      />
    </svg>
  );
}

export function FlameIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M12 3s4 4 4 8a4 4 0 1 1-8 0c0-1.2.6-2.2 1.2-3.1C8.4 9.2 8 11 8 11s1.2-1 2-2.5C11 7 12 3 12 3z" />
    </Stroke>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3.5V7M16 3.5V7M4 10h16" />
    </Stroke>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 2" />
    </Stroke>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M4 20l1-4L16.5 4.5a1.8 1.8 0 0 1 2.5 2.5L7.5 18.5 4 20z" />
    </Stroke>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M4 11.5L12 4l8 7.5" />
      <path d="M7 10.5V20h10v-9.5" />
    </Stroke>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M12 4v10" />
      <path d="M8 10l4 4 4-4" />
      <path d="M5 19h14" />
    </Stroke>
  );
}

export function CloudUploadIcon(props: IconProps) {
  return (
    <Stroke {...props}>
      <path d="M7 18h10" />
      <path d="M12 14V8" />
      <path d="M9 11l3-3 3 3" />
      <path d="M6.5 18a4 4 0 0 1-.5-7.9A5.5 5.5 0 0 1 17 10.5a4 4 0 0 1 .5 7.5" />
    </Stroke>
  );
}
