import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { Webview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { TFunction } from 'i18next'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import {
  closeChatGPTSidebarWindow,
  openAssistantSidebarExternalUrl,
  openChatGPTSidebarWindow,
  syncChatGPTSidebarWindow,
  type AssistantSidebarProvider,
  type ChatGPTSidebarWindowRequest,
} from '../api'
import { CloseIcon, RefreshCwIcon } from '../../../shared/ui/icons'

const DEFAULT_DOCKED_WIDTH = 400
const MIN_DOCKED_WIDTH = 360
const MAX_DOCKED_WIDTH = 640
const MAX_DOCKED_RATIO = 0.4
const OVERLAY_BREAKPOINT = 920
const OVERLAY_PADDING = 24
const OVERLAY_MAX_WIDTH = 460

interface ChatGPTSidebarProps {
  onClose: () => void
  provider: AssistantSidebarProvider
}

interface SidebarConfig {
  authHelpMessage?: string
  authHelpTitle?: string
  closeLabel: string
  displayName: string
  embeddedWebviewLabel: string
  externalOpenLabel?: string
  genericError: string
  loadFailureMessage: string
  loadFailureTitle: string
  nativeLoadingLabel: string
  nativeNotReadyError: string
  panelLabel: string
  resizeLabel: string
  storageKey: string
  url: string
  webAreaNotFoundError: string
  webLoadingLabel: string
  webNotReadyError: string
}

type SidebarStatus = 'loading' | 'ready' | 'error'
type SidebarStrategy = 'embedded' | 'native-window'

const SIDEBAR_BASE_CONFIG: Record<
  AssistantSidebarProvider,
  Pick<SidebarConfig, 'displayName' | 'embeddedWebviewLabel' | 'storageKey' | 'url'>
> = {
  chatgpt: {
    displayName: 'ChatGPT',
    embeddedWebviewLabel: 'chatgpt-panel',
    storageKey: 'openbanjo.chatgpt-sidebar-width',
    url: 'https://chatgpt.com',
  },
  claude: {
    displayName: 'Claude',
    embeddedWebviewLabel: 'claude-panel',
    storageKey: 'openbanjo.claude-sidebar-width',
    url: 'https://claude.ai',
  },
}

export function ChatGPTSidebar({ onClose, provider }: ChatGPTSidebarProps) {
  return getSidebarStrategy() === 'native-window' ? (
    <NativeWindowChatGPTSidebar onClose={onClose} provider={provider} />
  ) : (
    <EmbeddedChatGPTSidebar onClose={onClose} provider={provider} />
  )
}

function NativeWindowChatGPTSidebar({ onClose, provider }: ChatGPTSidebarProps) {
  const { t } = useTranslation()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [externalOpenError, setExternalOpenError] = useState<string | null>(null)
  const [isOpeningExternally, setIsOpeningExternally] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const [status, setStatus] = useState<SidebarStatus>('loading')
  const contentRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const isMountedRef = useRef(false)
  const config = getSidebarConfig(provider, t)
  const { handleResizeMouseDown, isOverlay, panelRef, panelWidth } =
    useSidebarLayout(config.storageKey)

  const closeNativeWindow = useCallback(async () => {
    await closeChatGPTSidebarWindow(getCurrentWindow().label, provider).catch((error) => {
      console.error(`Failed to close ${config.displayName} sidebar window:`, error)
    })
  }, [config.displayName, provider])

  const buildWindowRequest = useCallback(async () => {
    const contentElement = contentRef.current

    if (!contentElement) {
      return null
    }

    const rect = contentElement.getBoundingClientRect()

    if (rect.width < 1 || rect.height < 1) {
      return null
    }

    const currentWindow = getCurrentWindow()
    const [windowPosition, scaleFactor] = await Promise.all([
      currentWindow.innerPosition(),
      currentWindow.scaleFactor(),
    ])

    return {
      height: Math.max(1, Math.round(rect.height * scaleFactor)),
      parentWindowLabel: currentWindow.label,
      provider,
      width: Math.max(1, Math.round(rect.width * scaleFactor)),
      x: Math.round(windowPosition.x + rect.left * scaleFactor),
      y: Math.round(windowPosition.y + rect.top * scaleFactor),
    } satisfies ChatGPTSidebarWindowRequest
  }, [provider])

  const syncNativeWindow = useCallback(
    async (mode: 'open' | 'sync') => {
      const request = await buildWindowRequest()

      if (!request) {
        throw new Error(config.nativeNotReadyError)
      }

      if (mode === 'open') {
        await openChatGPTSidebarWindow(request)
      } else {
        await syncChatGPTSidebarWindow(request)
      }
    },
    [buildWindowRequest, config.nativeNotReadyError],
  )

  const scheduleNativeWindowSync = useCallback(() => {
    if (frameRef.current !== null) {
      return
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null

      void syncNativeWindow('sync').catch((error) => {
        if (!isMountedRef.current) {
          return
        }

        console.error(`Failed to sync ${config.displayName} sidebar window:`, error)
      })
    })
  }, [config.displayName, syncNativeWindow])

  const handleRetry = useCallback(() => {
    setRetryNonce((currentValue) => currentValue + 1)
  }, [])

  const handleOpenExternally = useCallback(async () => {
    setExternalOpenError(null)
    setIsOpeningExternally(true)

    try {
      await openAssistantSidebarExternalUrl(config.url)
    } catch (error) {
      setExternalOpenError(asErrorMessage(error, t('assistant.browserOpenError')))
    } finally {
      setIsOpeningExternally(false)
    }
  }, [config.url, t])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      setStatus('loading')
      setErrorMessage(null)

      await closeNativeWindow()
      await waitForNextPaint(2)

      if (cancelled || !isMountedRef.current) {
        return
      }

      try {
        await syncNativeWindow('open')

        if (cancelled || !isMountedRef.current) {
          return
        }

        setStatus('ready')
      } catch (error) {
        if (cancelled || !isMountedRef.current) {
          return
        }

        setStatus('error')
        setErrorMessage(asErrorMessage(error, config.genericError))
      }
    })()

    return () => {
      cancelled = true

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }

      void closeNativeWindow()
    }
  }, [closeNativeWindow, config.genericError, retryNonce, syncNativeWindow])

  useEffect(() => {
    scheduleNativeWindowSync()
  }, [isOverlay, panelWidth, scheduleNativeWindowSync])

  useEffect(() => {
    const contentElement = contentRef.current

    if (!contentElement) {
      return
    }

    const observer = new ResizeObserver(() => {
      scheduleNativeWindowSync()
    })

    observer.observe(contentElement)
    window.addEventListener('resize', scheduleNativeWindowSync)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', scheduleNativeWindowSync)
    }
  }, [scheduleNativeWindowSync])

  useEffect(() => {
    let unlistenMoved: (() => void) | null = null
    let unlistenResized: (() => void) | null = null
    let unlistenScaleChanged: (() => void) | null = null

    void (async () => {
      const currentWindow = getCurrentWindow()
      unlistenMoved = await currentWindow.onMoved(() => {
        scheduleNativeWindowSync()
      })
      unlistenResized = await currentWindow.onResized(() => {
        scheduleNativeWindowSync()
      })
      unlistenScaleChanged = await currentWindow.onScaleChanged(() => {
        scheduleNativeWindowSync()
      })
    })()

    return () => {
      unlistenMoved?.()
      unlistenResized?.()
      unlistenScaleChanged?.()
    }
  }, [scheduleNativeWindowSync])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const panel = (
    <ChatGPTPanelFrame
      config={config}
      contentSlot={<div ref={contentRef} className="absolute inset-0" />}
      errorMessage={errorMessage}
      handleResizeMouseDown={handleResizeMouseDown}
      isOverlay={isOverlay}
      loadingLabel={config.nativeLoadingLabel}
      onClose={onClose}
      onOpenExternally={config.externalOpenLabel ? handleOpenExternally : undefined}
      onRetry={handleRetry}
      panelRef={panelRef}
      panelWidth={panelWidth}
      status={status}
      externalOpenError={externalOpenError}
      isOpeningExternally={isOpeningExternally}
    />
  )

  if (isOverlay) {
    return (
      <>
        <button
          aria-label={config.closeLabel}
          className="absolute inset-0 z-20 bg-black/45 backdrop-blur-[2px]"
          onClick={onClose}
          type="button"
        />

        <div className="pointer-events-none absolute inset-0 z-30 p-3">
          <div className="pointer-events-auto flex h-full w-full justify-end">
            {panel}
          </div>
        </div>
      </>
    )
  }

  return panel
}

function EmbeddedChatGPTSidebar({ onClose, provider }: ChatGPTSidebarProps) {
  const { t } = useTranslation()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [externalOpenError, setExternalOpenError] = useState<string | null>(null)
  const [isOpeningExternally, setIsOpeningExternally] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const [status, setStatus] = useState<SidebarStatus>('loading')
  const contentRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const isMountedRef = useRef(false)
  const isWebviewReadyRef = useRef(false)
  const webviewRef = useRef<Webview | null>(null)
  const config = getSidebarConfig(provider, t)
  const { handleResizeMouseDown, isOverlay, panelRef, panelWidth } =
    useSidebarLayout(config.storageKey)

  const closeEmbeddedWebview = useCallback(async () => {
    const webview = webviewRef.current
    webviewRef.current = null
    isWebviewReadyRef.current = false

    if (!webview) {
      return
    }

    await webview.close().catch((error) => {
      console.error(`Failed to close ${config.displayName} webview:`, error)
    })
  }, [config.displayName])

  const syncEmbeddedWebview = useCallback(async () => {
    const webview = webviewRef.current
    const contentElement = contentRef.current

    if (!webview || !contentElement || !isWebviewReadyRef.current) {
      return
    }

    const rect = contentElement.getBoundingClientRect()
    const [windowPosition, scaleFactor] = await Promise.all([
      getCurrentWindow().innerPosition(),
      getCurrentWindow().scaleFactor(),
    ])
    const width = Math.max(1, Math.round(rect.width * scaleFactor))
    const height = Math.max(1, Math.round(rect.height * scaleFactor))
    const x = Math.round(windowPosition.x + rect.left * scaleFactor)
    const y = Math.round(windowPosition.y + rect.top * scaleFactor)

    await Promise.all([
      webview.setPosition(new PhysicalPosition(x, y)),
      webview.setSize(new PhysicalSize(width, height)),
    ]).catch((error) => {
      console.error(`Failed to sync ${config.displayName} webview bounds:`, error)
    })
  }, [config.displayName])

  const scheduleEmbeddedWebviewSync = useCallback(() => {
    if (frameRef.current !== null) {
      return
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      void syncEmbeddedWebview()
    })
  }, [syncEmbeddedWebview])

  const handleRetry = useCallback(() => {
    setRetryNonce((currentValue) => currentValue + 1)
  }, [])

  const handleOpenExternally = useCallback(async () => {
    setExternalOpenError(null)
    setIsOpeningExternally(true)

    try {
      await openAssistantSidebarExternalUrl(config.url)
    } catch (error) {
      setExternalOpenError(asErrorMessage(error, t('assistant.browserOpenError')))
    } finally {
      setIsOpeningExternally(false)
    }
  }, [config.url, t])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const contentElement = contentRef.current

    if (!contentElement) {
      return
    }

    const observer = new ResizeObserver(() => {
      scheduleEmbeddedWebviewSync()
    })

    observer.observe(contentElement)
    window.addEventListener('resize', scheduleEmbeddedWebviewSync)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', scheduleEmbeddedWebviewSync)
    }
  }, [scheduleEmbeddedWebviewSync])

  useEffect(() => {
    let unlistenMoved: (() => void) | null = null
    let unlistenResized: (() => void) | null = null

    void (async () => {
      const currentWindow = getCurrentWindow()
      unlistenMoved = await currentWindow.onMoved(() => {
        scheduleEmbeddedWebviewSync()
      })
      unlistenResized = await currentWindow.onResized(() => {
        scheduleEmbeddedWebviewSync()
      })
    })()

    return () => {
      unlistenMoved?.()
      unlistenResized?.()
    }
  }, [scheduleEmbeddedWebviewSync])

  useEffect(() => {
    scheduleEmbeddedWebviewSync()
  }, [isOverlay, panelWidth, scheduleEmbeddedWebviewSync])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      setStatus('loading')
      setErrorMessage(null)
      isWebviewReadyRef.current = false

      await closeEmbeddedWebview()
      await waitForNextPaint(2)

      if (cancelled || !isMountedRef.current) {
        return
      }

      const contentElement = contentRef.current
      if (!contentElement) {
        setStatus('error')
        setErrorMessage(config.webAreaNotFoundError)
        return
      }

      const rect = contentElement.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) {
        setStatus('error')
        setErrorMessage(config.webNotReadyError)
        return
      }

      try {
        const existingWebview = await Webview.getByLabel(config.embeddedWebviewLabel)

        if (existingWebview) {
          await existingWebview.close().catch(() => {})
        }

        if (cancelled || !isMountedRef.current) {
          return
        }

        const webview = new Webview(getCurrentWindow(), config.embeddedWebviewLabel, {
          focus: false,
          height: 1,
          url: config.url,
          width: 1,
          x: 0,
          y: 0,
        })

        webviewRef.current = webview

        void webview.once('tauri://created', () => {
          if (cancelled || !isMountedRef.current) {
            void closeEmbeddedWebview()
            return
          }

          isWebviewReadyRef.current = true

          void (async () => {
            await webview.setAutoResize(false).catch(() => {})
            await syncEmbeddedWebview()

            if (cancelled || !isMountedRef.current) {
              void closeEmbeddedWebview()
              return
            }

            setStatus('ready')
          })()
        })

        void webview.once('tauri://error', (event) => {
          if (cancelled || !isMountedRef.current) {
            return
          }

          webviewRef.current = null
          isWebviewReadyRef.current = false
          setStatus('error')
          setErrorMessage(String(event.payload))
          void webview.close().catch(() => {})
          console.error(`Failed to create ${config.displayName} webview:`, event.payload)
        })
      } catch (error) {
        if (cancelled || !isMountedRef.current) {
          return
        }

        setStatus('error')
        setErrorMessage(asErrorMessage(error, config.genericError))
      }
    })()

    return () => {
      cancelled = true

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }

      void closeEmbeddedWebview()
    }
  }, [
    closeEmbeddedWebview,
    config.displayName,
    config.embeddedWebviewLabel,
    config.genericError,
    config.url,
    config.webAreaNotFoundError,
    config.webNotReadyError,
    retryNonce,
    syncEmbeddedWebview,
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const panel = (
    <ChatGPTPanelFrame
      config={config}
      contentSlot={<div ref={contentRef} className="absolute inset-0" />}
      errorMessage={errorMessage}
      handleResizeMouseDown={handleResizeMouseDown}
      isOverlay={isOverlay}
      loadingLabel={config.webLoadingLabel}
      onClose={onClose}
      onOpenExternally={config.externalOpenLabel ? handleOpenExternally : undefined}
      onRetry={handleRetry}
      panelRef={panelRef}
      panelWidth={panelWidth}
      status={status}
      externalOpenError={externalOpenError}
      isOpeningExternally={isOpeningExternally}
    />
  )

  if (isOverlay) {
    return (
      <>
        <button
          aria-label={config.closeLabel}
          className="absolute inset-0 z-20 bg-black/45 backdrop-blur-[2px]"
          onClick={onClose}
          type="button"
        />

        <div className="pointer-events-none absolute inset-0 z-30 p-3">
          <div className="pointer-events-auto flex h-full w-full justify-end">
            {panel}
          </div>
        </div>
      </>
    )
  }

  return panel
}

function useSidebarLayout(storageKey: string) {
  const [availableWidth, setAvailableWidth] = useState(0)
  const [requestedWidth, setRequestedWidth] = useState(() =>
    readStoredSidebarWidth(storageKey),
  )
  const panelRef = useRef<HTMLElement | null>(null)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(DEFAULT_DOCKED_WIDTH)

  const isOverlay = availableWidth > 0 && availableWidth < OVERLAY_BREAKPOINT
  const panelWidth = isOverlay
    ? resolveOverlayWidth(availableWidth)
    : resolveDockedWidth(requestedWidth, availableWidth)

  function handleResizeMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault()
    dragStartXRef.current = event.clientX
    dragStartWidthRef.current = panelWidth

    function handleMouseMove(nextEvent: MouseEvent) {
      const delta = dragStartXRef.current - nextEvent.clientX
      setRequestedWidth(dragStartWidthRef.current + delta)
    }

    function handleMouseUp() {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(Math.round(requestedWidth)))
  }, [requestedWidth, storageKey])

  useEffect(() => {
    const panelElement = panelRef.current
    const hostElement = panelElement?.parentElement

    if (!panelElement || !hostElement) {
      return
    }

    const syncAvailableWidth = () => {
      const rect = hostElement.getBoundingClientRect()
      setAvailableWidth(Math.max(0, Math.round(rect.width)))
    }

    const observer = new ResizeObserver(syncAvailableWidth)
    observer.observe(hostElement)
    window.addEventListener('resize', syncAvailableWidth)
    syncAvailableWidth()

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncAvailableWidth)
    }
  }, [])

  return {
    handleResizeMouseDown,
    isOverlay,
    panelRef,
    panelWidth,
  }
}

function ChatGPTPanelFrame({
  config,
  contentSlot,
  errorMessage,
  externalOpenError,
  handleResizeMouseDown,
  isOverlay,
  isOpeningExternally,
  loadingLabel,
  onClose,
  onOpenExternally,
  onRetry,
  panelRef,
  panelWidth,
  status,
}: {
  config: SidebarConfig
  contentSlot: ReactNode
  errorMessage: string | null
  externalOpenError: string | null
  handleResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void
  isOverlay: boolean
  isOpeningExternally: boolean
  loadingLabel: string
  onClose: () => void
  onOpenExternally?: () => void
  onRetry?: () => void
  panelRef: MutableRefObject<HTMLElement | null>
  panelWidth: number
  status: SidebarStatus
}) {
  const { t } = useTranslation()

  return (
    <aside
      aria-label={config.panelLabel}
      aria-modal={isOverlay ? true : undefined}
      className={`relative flex h-full min-h-0 max-w-full flex-col overflow-hidden bg-[#080808] ${
        isOverlay ? 'w-full' : 'shrink-0'
      }`}
      ref={(element) => {
        panelRef.current = element
      }}
      role={isOverlay ? 'dialog' : 'complementary'}
      style={{ width: Math.round(panelWidth) }}
    >
      {!isOverlay ? (
        <div
          aria-label={config.resizeLabel}
          className="absolute inset-y-4 left-0 z-20 w-2 -translate-x-1/2 cursor-col-resize bg-transparent transition-colors hover:bg-white/[0.08] active:bg-white/[0.12]"
          onMouseDown={handleResizeMouseDown}
          role="separator"
        />
      ) : null}

      <div className="relative flex h-full min-h-0 flex-col overflow-hidden border-l border-white/[0.06] bg-[#080808]">
        <header className="relative flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] bg-[#090909] px-3 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-slate-100">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-white/[0.035]">
                <svg
                  fill="none"
                  height="17"
                  viewBox="0 0 24 24"
                  width="17"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"
                    fill="currentColor"
                    fillOpacity="0.15"
                  />
                  <path
                    d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"
                    fill="currentColor"
                  />
                  <circle cx="12" cy="12" fill="currentColor" r="2" />
                </svg>
              </div>

              <div className="min-w-0">
                <div className="truncate text-[0.82rem] font-semibold text-white">
                  {config.displayName}
                </div>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {onOpenExternally ? (
              <button
                className="inline-flex h-7 items-center rounded-md border border-white/[0.08] bg-white/[0.035] px-2.5 text-[0.72rem] font-medium text-slate-100 transition hover:border-white/[0.12] hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isOpeningExternally}
                onClick={onOpenExternally}
                type="button"
              >
                {isOpeningExternally ? t('common.opening') : config.externalOpenLabel}
              </button>
            ) : null}

            {onRetry ? (
              <button
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.035] px-2.5 text-[0.72rem] font-medium text-slate-200 transition hover:border-white/[0.12] hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={status === 'loading'}
                onClick={onRetry}
                type="button"
              >
                <RefreshCwIcon size={13} />
                {t('common.refresh')}
              </button>
            ) : null}

            <button
              aria-label={config.closeLabel}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-slate-500 transition hover:border-white/[0.08] hover:bg-white/[0.05] hover:text-white"
              onClick={onClose}
              type="button"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-hidden bg-[#080808] p-2">
          {config.authHelpTitle && config.authHelpMessage ? (
            <div className="relative shrink-0 rounded-md border border-amber-300/14 bg-amber-300/[0.07] px-3 py-2.5 text-left">
              <div className="text-[0.8rem] font-medium text-amber-100">
                {config.authHelpTitle}
              </div>
              <div className="mt-1 text-[0.78rem] leading-5 text-amber-50/80">
                {config.authHelpMessage}
              </div>
              {externalOpenError ? (
                <div className="mt-2 text-[0.74rem] text-rose-200">{externalOpenError}</div>
              ) : null}
            </div>
          ) : null}

          <div className="relative h-full overflow-hidden rounded-md border border-white/[0.06] bg-[#050505]">
            {contentSlot}

            {status !== 'ready' ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[rgba(5,5,5,0.92)] px-6 text-center backdrop-blur-sm">
                {status === 'error' ? (
                  <div className="max-w-[18rem]">
                    <div className="text-sm font-medium text-rose-100">
                      {config.loadFailureTitle}
                    </div>
                    <div className="mt-2 text-[0.82rem] leading-6 text-slate-400">
                      {errorMessage ?? config.loadFailureMessage}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                      {onRetry ? (
                        <button
                          className="inline-flex items-center rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.8rem] font-medium text-slate-200 transition hover:border-white/[0.12] hover:bg-white/[0.06]"
                          onClick={onRetry}
                          type="button"
                        >
                          {t('common.retry')}
                        </button>
                      ) : null}

                      {onOpenExternally ? (
                        <button
                          className="inline-flex items-center rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[0.8rem] font-medium text-slate-100 transition hover:border-white/[0.12] hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isOpeningExternally}
                          onClick={onOpenExternally}
                          type="button"
                        >
                          {isOpeningExternally ? t('common.opening') : config.externalOpenLabel}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="max-w-[16rem] text-[0.82rem] text-slate-400">
                    <div className="mx-auto mb-3 h-9 w-9 animate-spin rounded-full border-2 border-white/[0.08] border-t-white" />
                    {loadingLabel}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  )
}

function getSidebarStrategy(): SidebarStrategy {
  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }
  const platform =
    navigatorWithUserAgentData.userAgentData?.platform ??
    navigator.platform ??
    navigator.userAgent

  return /linux/i.test(platform) ? 'native-window' : 'embedded'
}

function getSidebarConfig(provider: AssistantSidebarProvider, t: TFunction): SidebarConfig {
  const base = SIDEBAR_BASE_CONFIG[provider]
  const prefix = provider === 'chatgpt' ? 'assistant.chatgpt' : 'assistant.claude'

  return {
    ...base,
    authHelpMessage: provider === 'claude' ? t('assistant.claude.authHelp') : undefined,
    authHelpTitle: provider === 'claude' ? t('assistant.claude.authTitle') : undefined,
    closeLabel: t(`${prefix}.close`),
    externalOpenLabel: provider === 'claude' ? t('assistant.claude.externalOpen') : undefined,
    genericError: t(`${prefix}.genericError`),
    loadFailureMessage: t(`${prefix}.loadFailure`),
    loadFailureTitle: t(`${prefix}.loadFailureTitle`),
    nativeLoadingLabel: t(`${prefix}.nativeLoading`),
    nativeNotReadyError: t(`${prefix}.nativeNotReady`),
    panelLabel: t(`${prefix}.panel`),
    resizeLabel: t(`${prefix}.resize`),
    webAreaNotFoundError: t(`${prefix}.webAreaMissing`),
    webLoadingLabel: t(`${prefix}.webLoading`),
    webNotReadyError: t(`${prefix}.webNotReady`),
  }
}

function readStoredSidebarWidth(storageKey: string) {
  try {
    const rawValue = window.localStorage.getItem(storageKey)

    if (!rawValue) {
      return DEFAULT_DOCKED_WIDTH
    }

    const parsedValue = JSON.parse(rawValue)
    return typeof parsedValue === 'number' ? parsedValue : DEFAULT_DOCKED_WIDTH
  } catch {
    return DEFAULT_DOCKED_WIDTH
  }
}

function resolveDockedWidth(requestedWidth: number, availableWidth: number) {
  if (availableWidth <= 0) {
    return DEFAULT_DOCKED_WIDTH
  }

  const maxWidth = Math.min(
    MAX_DOCKED_WIDTH,
    Math.max(MIN_DOCKED_WIDTH, Math.round(availableWidth * MAX_DOCKED_RATIO)),
  )

  return Math.max(MIN_DOCKED_WIDTH, Math.min(maxWidth, Math.round(requestedWidth)))
}

function resolveOverlayWidth(availableWidth: number) {
  if (availableWidth <= 0) {
    return OVERLAY_MAX_WIDTH
  }

  return Math.max(
    1,
    Math.min(OVERLAY_MAX_WIDTH, Math.round(availableWidth - OVERLAY_PADDING)),
  )
}

function asErrorMessage(error: unknown, fallbackMessage: string) {
  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return error.message
  }

  return fallbackMessage
}

async function waitForNextPaint(frames = 1) {
  for (let index = 0; index < frames; index += 1) {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  }
}
