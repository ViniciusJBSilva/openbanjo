import { getCurrentWindow } from '@tauri-apps/api/window'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type ResizeDirection =
  | 'East'
  | 'North'
  | 'NorthEast'
  | 'NorthWest'
  | 'South'
  | 'SouthEast'
  | 'SouthWest'
  | 'West'

type WindowControlAction = 'close' | 'maximize' | 'minimize'
type WindowControlVariant = 'linux' | 'macos'

const currentWindow = getCurrentWindow()
const windowControlVariant = getWindowControlVariant()

export function WindowChrome() {
  return <WindowResizeHandles />
}

export function WindowDragRegion({
  children,
  className = '',
}: {
  children?: ReactNode
  className?: string
}) {
  function handleDrag(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.detail > 1) {
      return
    }

    void currentWindow.startDragging()
  }

  function handleToggleMaximize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault()
    void currentWindow.toggleMaximize()
  }

  return (
    <div
      className={`select-none ${className}`}
      onDoubleClick={handleToggleMaximize}
      onMouseDown={handleDrag}
    >
      {children}
    </div>
  )
}

export function WindowControls({
  align = windowControlVariant === 'macos' ? 'left' : 'right',
}: {
  align?: 'left' | 'right'
}) {
  const { t } = useTranslation()
  const controls = (
    <div
      className={`flex items-center ${windowControlVariant === 'macos' ? 'gap-2' : 'gap-0'}`}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {align === 'left' ? (
        <>
          <WindowControlButton action="close" label={t('window.close')} />
          <WindowControlButton action="minimize" label={t('window.minimize')} />
          <WindowControlButton action="maximize" label={t('window.maximize')} />
        </>
      ) : (
        <>
          <WindowControlButton action="minimize" label={t('window.minimize')} />
          <WindowControlButton action="maximize" label={t('window.maximize')} />
          <WindowControlButton action="close" label={t('window.close')} />
        </>
      )}
    </div>
  )

  return align === 'left' ? controls : <div className="ml-auto">{controls}</div>
}

function WindowControlButton({
  action,
  label,
}: {
  action: WindowControlAction
  label: string
}) {
  function handleClick(event: ReactMouseEvent<HTMLButtonElement>) {
    event.stopPropagation()

    if (action === 'close') {
      void currentWindow.close()
      return
    }

    if (action === 'maximize') {
      void currentWindow.toggleMaximize()
      return
    }

    void currentWindow.minimize()
  }

  return (
    <button
      aria-label={label}
      className={getControlClassName(action)}
      onClick={handleClick}
      title={label}
      type="button"
    >
      <WindowControlGlyph action={action} />
    </button>
  )
}

function WindowControlGlyph({ action }: { action: WindowControlAction }) {
  if (windowControlVariant === 'macos') {
    return (
      <span className="h-1.5 w-1.5 rounded-full bg-black/40 opacity-0 transition group-hover:opacity-70 group-focus-visible:opacity-70" />
    )
  }

  if (action === 'minimize') {
    return <span className="h-px w-3 rounded-full bg-current" />
  }

  if (action === 'maximize') {
    return <span className="h-2.5 w-2.5 rounded-[2px] border border-current" />
  }

  return (
    <span className="relative h-3 w-3">
      <span className="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 rotate-45 rounded-full bg-current" />
      <span className="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 -rotate-45 rounded-full bg-current" />
    </span>
  )
}

function WindowResizeHandles() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <WindowResizeHandle className="left-0 top-0 h-2 w-2 cursor-nwse-resize" direction="NorthWest" />
      <WindowResizeHandle className="right-0 top-0 h-2 w-2 cursor-nesw-resize" direction="NorthEast" />
      <WindowResizeHandle className="bottom-0 left-0 h-4 w-4 cursor-nesw-resize" direction="SouthWest" />
      <WindowResizeHandle className="bottom-0 right-0 h-4 w-4 cursor-nwse-resize" direction="SouthEast" />
      <WindowResizeHandle className="left-2 right-2 top-0 h-1 cursor-ns-resize" direction="North" />
      <WindowResizeHandle className="bottom-0 left-4 right-4 h-1 cursor-ns-resize" direction="South" />
      <WindowResizeHandle className="bottom-4 left-0 top-2 w-1 cursor-ew-resize" direction="West" />
      <WindowResizeHandle className="bottom-4 right-0 top-2 w-1 cursor-ew-resize" direction="East" />
    </div>
  )
}

function WindowResizeHandle({
  className,
  direction,
}: {
  className: string
  direction: ResizeDirection
}) {
  return (
    <div
      className={`pointer-events-auto absolute ${className}`}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        if (event.button !== 0) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        void currentWindow.startResizeDragging(direction)
      }}
    />
  )
}

function getControlClassName(action: WindowControlAction) {
  if (windowControlVariant === 'linux') {
    const baseClassName =
      'group flex h-7 w-8 items-center justify-center rounded-md border border-transparent text-slate-400 transition focus:outline-none focus:ring-2 focus:ring-white/20'

    if (action === 'close') {
      return `${baseClassName} hover:bg-[#c6463d] hover:text-white`
    }

    return `${baseClassName} hover:bg-white/[0.08] hover:text-white`
  }

  switch (action) {
    case 'close':
      return 'group flex h-3.5 w-3.5 items-center justify-center rounded-full border border-rose-400/30 bg-rose-400/70 transition hover:border-rose-200/60 hover:bg-rose-300 focus:outline-none focus:ring-2 focus:ring-white/20'
    case 'maximize':
      return 'group flex h-3.5 w-3.5 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/70 transition hover:border-emerald-200/60 hover:bg-emerald-300 focus:outline-none focus:ring-2 focus:ring-white/20'
    case 'minimize':
      return 'group flex h-3.5 w-3.5 items-center justify-center rounded-full border border-amber-300/30 bg-amber-300/70 transition hover:border-amber-100/60 hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-white/20'
  }
}

function getWindowControlVariant(): WindowControlVariant {
  const platform = getNavigatorPlatform()

  if (/Mac|iPhone|iPad|iPod/i.test(platform)) {
    return 'macos'
  }

  return 'linux'
}

function getNavigatorPlatform() {
  if (typeof navigator === 'undefined') {
    return ''
  }

  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }

  return (
    navigatorWithUserAgentData.userAgentData?.platform ??
    navigator.platform ??
    navigator.userAgent
  )
}
