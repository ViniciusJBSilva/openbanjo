import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number
}

function SvgIcon({
  children,
  className,
  size = 18,
  strokeWidth = 1.8,
  ...props
}: IconProps) {
  return (
    <svg
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {children}
    </svg>
  )
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M5 12h14" />
      <path d="m11 18-6-6 6-6" />
    </SvgIcon>
  )
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M9 12.75 11.25 15 15.5 9.75" />
      <circle cx="12" cy="12" r="9" />
    </SvgIcon>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="m6 9 6 6 6-6" />
    </SvgIcon>
  )
}

export function CodeIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="m9 18-6-6 6-6" />
      <path d="m15 6 6 6-6 6" />
    </SvgIcon>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
    </SvgIcon>
  )
}

export function GitBranchIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="19" r="2" />
      <circle cx="18" cy="5" r="2" />
      <path d="M8 5h8" />
      <path d="M6 7v7a5 5 0 0 0 5 5h5" />
    </SvgIcon>
  )
}

export function MenuIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </SvgIcon>
  )
}

export function PlayIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="m8 6 10 6-10 6z" />
    </SvgIcon>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </SvgIcon>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </SvgIcon>
  )
}

export function SidebarCloseIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect height="14" rx="2" width="16" x="4" y="5" />
      <path d="M9 5v14" />
    </SvgIcon>
  )
}

export function SparklesIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
      <path d="m19 14 .75 2.25L22 17l-2.25.75L19 20l-.75-2.25L16 17l2.25-.75z" />
      <path d="m5 14 .75 2.25L8 17l-2.25.75L5 20l-.75-2.25L2 17l2.25-.75z" />
    </SvgIcon>
  )
}

export function StarIcon({
  fill = 'none',
  strokeWidth = 1.8,
  ...props
}: IconProps) {
  return (
    <SvgIcon fill={fill} strokeWidth={strokeWidth} {...props}>
      <path d="m12 3.8 2.54 5.15 5.68.82-4.1 4 1 5.65L12 16.7l-5.08 2.72 1-5.65-4.1-4 5.68-.82z" />
    </SvgIcon>
  )
}

export function TerminalIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="m5 7 5 5-5 5" />
      <path d="M12 17h7" />
    </SvgIcon>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="m6 7 1 12h10l1-12" />
      <path d="M9 7V4h6v3" />
    </SvgIcon>
  )
}

export function RefreshCwIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M21 12a9 9 0 1 1-6.22-8.56" />
      <path d="M21 3v5h-5" />
    </SvgIcon>
  )
}

export function ActivityIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.48 12H2" />
    </SvgIcon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </SvgIcon>
  )
}
