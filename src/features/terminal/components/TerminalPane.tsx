import '@xterm/xterm/css/xterm.css'

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import type { TFunction } from 'i18next'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'

import { ChangePreviewPane } from './ChangePreviewPane'
import { translateError } from '../../../shared/i18n'
import { getCliToolStatus } from '../api'
import { useChangePreview } from '../hooks/useChangePreview'
import { useTerminalSession } from '../hooks/useTerminalSession'
import type {
  CliLaunchTarget,
  CliToolStatus,
  TerminalEvent,
  TerminalLifecycleStatus,
} from '../types'
import { getCliLaunchTargetLabel, isCliLaunchTarget } from '../types'

interface TerminalPaneProps {
  isActive: boolean
  onRequestClose: () => void
  selectedLaunchTarget: CliLaunchTarget
  workspacePath: string
}

interface SessionApi {
  sendInput: (input: string) => Promise<void>
  resize: (cols: number, rows: number) => Promise<void>
}

const PREVIEW_OVERLAY_BREAKPOINT = 1180
const PREVIEW_DEFAULT_DOCKED_WIDTH = 520
const PREVIEW_MIN_DOCKED_WIDTH = 420
const PREVIEW_MAX_DOCKED_WIDTH = 720
const PREVIEW_MAX_DOCKED_RATIO = 0.46
const PREVIEW_OVERLAY_PADDING = 24
const PREVIEW_OVERLAY_MAX_WIDTH = 680
const OUTPUT_FOLLOW_BOTTOM_THRESHOLD = 0
const TERMINAL_WHEEL_FALLBACK_LINE_HEIGHT = 20

export interface TerminalPaneHandle {
  focus: () => void
  startSession: () => void
}

export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(
  function TerminalPane(
    {
      isActive,
      onRequestClose,
      selectedLaunchTarget,
      workspacePath,
    },
    ref,
  ) {
    const { t } = useTranslation()
    const bodyRef = useRef<HTMLDivElement | null>(null)
    const containerRef = useRef<HTMLDivElement | null>(null)
    const terminalRef = useRef<Terminal | null>(null)
    const viewportRef = useRef<HTMLElement | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const initialSizeRef = useRef<{ cols: number; rows: number } | null>(null)
    const terminalResizeFrameRef = useRef<number | null>(null)
    const terminalSizeRef = useRef<{ cols: number; rows: number } | null>(null)
    const pendingOutputScrollFrameRef = useRef<number | null>(null)
    const pendingOutputTrackingFrameRef = useRef<number | null>(null)
    const exitPromptPrimaryButtonRef = useRef<HTMLButtonElement | null>(null)
    const touchScrollYRef = useRef<number | null>(null)
    const wheelScrollRemainderRef = useRef(0)
    const isActiveRef = useRef(isActive)
    const isFollowingOutputRef = useRef(true)
    const sessionApiRef = useRef<SessionApi>({
      sendInput: async () => {},
      resize: async () => {},
    })

    const [initialSize, setInitialSize] = useState<{ cols: number; rows: number } | null>(null)
    const [shouldStartSession, setShouldStartSession] = useState(false)
    const [, setCliStatus] = useState<CliToolStatus | null>(null)
    const [cliValidationError, setCliValidationError] = useState<unknown>(null)
    const [sessionLaunchTarget, setSessionLaunchTarget] =
      useState<CliLaunchTarget>(selectedLaunchTarget)
    const [isFollowingOutput, setIsFollowingOutput] = useState(true)
    const [unseenOutputCount, setUnseenOutputCount] = useState(0)
    const [isPreviewEnabled, setIsPreviewEnabled] = useState(false)
    const [bodyWidth, setBodyWidth] = useState(0)
    const [isExitPromptOpen, setIsExitPromptOpen] = useState(false)

    const getTerminalDistanceFromBottom = useCallback(() => {
      const terminal = terminalRef.current

      if (!terminal) {
        return 0
      }

      const buffer = terminal.buffer.active

      return Math.max(0, buffer.baseY - buffer.viewportY)
    }, [])

    const cancelPendingOutputScroll = useCallback(() => {
      if (pendingOutputScrollFrameRef.current === null) {
        return
      }

      window.cancelAnimationFrame(pendingOutputScrollFrameRef.current)
      pendingOutputScrollFrameRef.current = null
    }, [])

    const cancelPendingOutputTracking = useCallback(() => {
      if (pendingOutputTrackingFrameRef.current === null) {
        return
      }

      window.cancelAnimationFrame(pendingOutputTrackingFrameRef.current)
      pendingOutputTrackingFrameRef.current = null
    }, [])

    const isViewportAtBottom = useCallback(
      () => getTerminalDistanceFromBottom() <= OUTPUT_FOLLOW_BOTTOM_THRESHOLD,
      [getTerminalDistanceFromBottom],
    )

    const pauseFollowingOutput = useCallback(() => {
      cancelPendingOutputScroll()
      cancelPendingOutputTracking()
      isFollowingOutputRef.current = false
      setIsFollowingOutput(false)
    }, [cancelPendingOutputScroll, cancelPendingOutputTracking])

    const scrollTerminalToBottom = useCallback(() => {
      cancelPendingOutputScroll()

      terminalRef.current?.scrollToBottom()

      isFollowingOutputRef.current = true
      setIsFollowingOutput(true)
      setUnseenOutputCount(0)
    }, [cancelPendingOutputScroll])

    const syncOutputTracking = useCallback(() => {
      const nextFollowState = isViewportAtBottom()

      isFollowingOutputRef.current = nextFollowState
      setIsFollowingOutput(nextFollowState)

      if (nextFollowState) {
        setUnseenOutputCount(0)
      }
    }, [isViewportAtBottom])

    const scheduleOutputTracking = useCallback(() => {
      cancelPendingOutputTracking()
      pendingOutputTrackingFrameRef.current = window.requestAnimationFrame(() => {
        pendingOutputTrackingFrameRef.current = null
        syncOutputTracking()
      })
    }, [cancelPendingOutputTracking, syncOutputTracking])

    const revealIncomingOutput = useCallback(
      () => {
        if (isFollowingOutputRef.current) {
          cancelPendingOutputScroll()
          pendingOutputScrollFrameRef.current = window.requestAnimationFrame(() => {
            pendingOutputScrollFrameRef.current = null

            if (!isFollowingOutputRef.current) {
              return
            }

            scrollTerminalToBottom()
          })
          return
        }

        setUnseenOutputCount((currentCount) => Math.min(currentCount + 1, 99))
      },
      [cancelPendingOutputScroll, scrollTerminalToBottom],
    )

    const focusTerminal = useCallback(() => {
      terminalRef.current?.focus()
    }, [])

    const {
      snapshot,
      error,
      isConnecting,
      lifecycleStatus,
      lastExit,
      sendInput,
      resize,
      restart,
    } = useTerminalSession({
      enabled: initialSize !== null && shouldStartSession,
      launchTarget: sessionLaunchTarget,
      workspacePath,
      initialCols: initialSize?.cols ?? 80,
      initialRows: initialSize?.rows ?? 24,
      onEvent: handleTerminalEvent,
    })
    const snapshotId = snapshot?.id ?? null
    const changePreview = useChangePreview({
      enabled: isPreviewEnabled,
      sessionId: snapshotId,
    })
    const isPreviewOverlay =
      isPreviewEnabled && bodyWidth > 0 && bodyWidth < PREVIEW_OVERLAY_BREAKPOINT
    const previewPanelWidth = isPreviewOverlay
      ? resolvePreviewOverlayWidth(bodyWidth)
      : resolvePreviewDockedWidth(bodyWidth)
    const isSessionOpen = lifecycleStatus === 'starting' || lifecycleStatus === 'running'
    const activeSessionTarget =
      isSessionOpen && isCliLaunchTarget(snapshot?.launchTarget)
        ? snapshot.launchTarget
        : isSessionOpen
          ? sessionLaunchTarget
          : selectedLaunchTarget
    const activeSessionLabel = getCliLaunchTargetLabel(activeSessionTarget)
    const selectedLaunchTargetLabel = getCliLaunchTargetLabel(selectedLaunchTarget)
    const hasPendingTargetChange = isSessionOpen && selectedLaunchTarget !== sessionLaunchTarget

    useEffect(() => {
      sessionApiRef.current = { sendInput, resize }
    }, [resize, sendInput])

    useEffect(() => {
      if (lastExit) {
        setIsExitPromptOpen(true)
      }
    }, [lastExit])

    useEffect(() => {
      if (!isExitPromptOpen || !isActive) {
        return
      }

      const focusFrame = window.requestAnimationFrame(() => {
        exitPromptPrimaryButtonRef.current?.focus()
      })

      return () => {
        window.cancelAnimationFrame(focusFrame)
      }
    }, [isActive, isExitPromptOpen])

    useEffect(() => {
      isActiveRef.current = isActive
    }, [isActive])

    useEffect(() => {
      const bodyElement = bodyRef.current

      if (!bodyElement) {
        return
      }

      const syncBodyWidth = () => {
        setBodyWidth(Math.round(bodyElement.getBoundingClientRect().width))
      }
      const resizeObserver = new ResizeObserver(syncBodyWidth)

      resizeObserver.observe(bodyElement)
      window.addEventListener('resize', syncBodyWidth)
      syncBodyWidth()

      return () => {
        resizeObserver.disconnect()
        window.removeEventListener('resize', syncBodyWidth)
      }
    }, [])

    useEffect(() => {
      if (!isPreviewOverlay) {
        return
      }

      function handleKeyDown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
          setIsPreviewEnabled(false)
          requestAnimationFrame(() => {
            focusTerminal()
          })
        }
      }

      window.addEventListener('keydown', handleKeyDown)

      return () => {
        window.removeEventListener('keydown', handleKeyDown)
      }
    }, [focusTerminal, isPreviewOverlay])

    const startCliSession = useCallback(
      async (isRestart: boolean) => {
        setCliValidationError(null)

        try {
          const nextStatus = await getCliToolStatus(selectedLaunchTarget)
          setCliStatus(nextStatus)

          if (!nextStatus.isInstalled) {
            setCliValidationError(
              nextStatus.error ??
                t('terminal.cliUnavailable', { label: selectedLaunchTargetLabel }),
            )
            return
          }

          setSessionLaunchTarget(selectedLaunchTarget)
          terminalRef.current?.reset()
          scrollTerminalToBottom()

          if (isRestart || shouldStartSession) {
            restart()
            return
          }

          setShouldStartSession(true)
        } catch (validationError) {
          setCliValidationError(asErrorMessage(validationError, selectedLaunchTarget, t))
        }
      },
      [
        restart,
        scrollTerminalToBottom,
        selectedLaunchTarget,
        selectedLaunchTargetLabel,
        shouldStartSession,
        t,
      ],
    )

    useEffect(() => {
      setShouldStartSession(false)
      setCliStatus(null)
      setCliValidationError(null)
      setSessionLaunchTarget(selectedLaunchTarget)
      setUnseenOutputCount(0)
      isFollowingOutputRef.current = true
      setIsFollowingOutput(true)
      setIsPreviewEnabled(false)
      setIsExitPromptOpen(false)
    }, [selectedLaunchTarget, workspacePath])

    useEffect(() => {
      let ignore = false

      async function refreshCliStatus() {
        try {
          const nextStatus = await getCliToolStatus(selectedLaunchTarget)

          if (ignore) {
            return
          }

          setCliStatus(nextStatus)
          setCliValidationError(nextStatus.isInstalled ? null : nextStatus.error)
        } catch (statusError) {
          if (ignore) {
            return
          }

          setCliStatus(null)
          setCliValidationError(asErrorMessage(statusError, selectedLaunchTarget, t))
        }
      }

      void refreshCliStatus()

      return () => {
        ignore = true
      }
    }, [selectedLaunchTarget, t, workspacePath])

    useEffect(() => {
      const container = containerRef.current

      if (!container) {
        return
      }

      function syncTerminalSize(terminal: Terminal, fitAddon: FitAddon) {
        if (!isActiveRef.current) {
          return
        }

        fitAddon.fit()

        if (terminal.cols > 0 && terminal.rows > 0) {
          const currentSize = terminalSizeRef.current
          const hasSizeChanged =
            !currentSize ||
            currentSize.cols !== terminal.cols ||
            currentSize.rows !== terminal.rows

          if (!hasSizeChanged) {
            return
          }

          terminalSizeRef.current = {
            cols: terminal.cols,
            rows: terminal.rows,
          }

          if (initialSizeRef.current === null) {
            const nextSize = { cols: terminal.cols, rows: terminal.rows }
            initialSizeRef.current = nextSize
            setInitialSize(nextSize)
          }

          void sessionApiRef.current.resize(terminal.cols, terminal.rows)
        }
      }

      function scheduleTerminalSizeSync(terminal: Terminal, fitAddon: FitAddon) {
        if (terminalResizeFrameRef.current !== null) {
          window.cancelAnimationFrame(terminalResizeFrameRef.current)
        }

        terminalResizeFrameRef.current = window.requestAnimationFrame(() => {
          terminalResizeFrameRef.current = null
          syncTerminalSize(terminal, fitAddon)
        })
      }

      const terminal = new Terminal({
        allowTransparency: true,
        cursorBlink: true,
        cursorStyle: 'block',
        drawBoldTextInBrightColors: false,
        fontFamily: '"JetBrains Mono", "SF Mono", "IBM Plex Mono", "Fira Code", monospace',
        fontSize: 13,
        lineHeight: 1.22,
        minimumContrastRatio: 4.5,
        scrollback: 5000,
        theme: {
          background: '#050607',
          foreground: '#eef2f7',
          cursor: '#e6edf3',
          cursorAccent: '#050607',
          selectionBackground: 'rgba(125, 211, 252, 0.24)',
          selectionForeground: '#f8fafc',
          black: '#111317',
          red: '#ff7b72',
          green: '#7ee787',
          yellow: '#f2cc60',
          blue: '#79c0ff',
          magenta: '#d2a8ff',
          cyan: '#56d4dd',
          white: '#dbe3ed',
          brightBlack: '#6e7681',
          brightRed: '#ffa198',
          brightGreen: '#9be9a8',
          brightYellow: '#f7da77',
          brightBlue: '#a5d6ff',
          brightMagenta: '#e2c5ff',
          brightCyan: '#7eeef8',
          brightWhite: '#ffffff',
        },
      })

      const fitAddon = new FitAddon()
      terminal.loadAddon(fitAddon)
      terminal.open(container)
      terminalRef.current = terminal
      fitAddonRef.current = fitAddon

      let viewport: HTMLElement | null = null

      const handleWheel = (event: WheelEvent) => {
        if (terminal.buffer.active.baseY <= 0) {
          return
        }

        const scrollLines = resolveTerminalWheelScrollLines(
          event,
          terminal,
          wheelScrollRemainderRef,
        )

        if (event.cancelable) {
          event.preventDefault()
        }

        event.stopPropagation()

        if (scrollLines !== 0) {
          if (scrollLines < 0) {
            pauseFollowingOutput()
          }

          terminal.scrollLines(scrollLines)
          scheduleOutputTracking()
        }
      }

      const handleTouchStart = (event: TouchEvent) => {
        touchScrollYRef.current = event.touches[0]?.clientY ?? null
      }

      const handleTouchMove = (event: TouchEvent) => {
        const previousTouchY = touchScrollYRef.current
        const nextTouchY = event.touches[0]?.clientY ?? null

        if (previousTouchY !== null && nextTouchY !== null && nextTouchY > previousTouchY) {
          pauseFollowingOutput()
        }

        touchScrollYRef.current = nextTouchY
        scheduleOutputTracking()
      }

      const resetTouchTracking = () => {
        touchScrollYRef.current = null
      }

      const bindViewport = () => {
        const nextViewport = container.querySelector('.xterm-scrollable-element, .xterm-viewport')

        if (!(nextViewport instanceof HTMLElement) || nextViewport === viewport) {
          return
        }

        viewport = nextViewport
        viewportRef.current = nextViewport
        syncOutputTracking()
      }

      bindViewport()

      const dataDisposable = terminal.onData((data) => {
        void sessionApiRef.current.sendInput(data)
      })
      const scrollDisposable = terminal.onScroll(syncOutputTracking)
      const bufferDisposable = terminal.buffer.onBufferChange(() => {
        wheelScrollRemainderRef.current = 0
        scheduleOutputTracking()
      })

      container.addEventListener('wheel', handleWheel, { capture: true, passive: false })
      container.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true })
      container.addEventListener('touchmove', handleTouchMove, { capture: true, passive: true })
      container.addEventListener('touchend', resetTouchTracking, { capture: true, passive: true })
      container.addEventListener('touchcancel', resetTouchTracking, { capture: true, passive: true })

      const resizeObserver = new ResizeObserver(() => {
        bindViewport()
        scheduleTerminalSizeSync(terminal, fitAddon)
      })

      resizeObserver.observe(container)

      requestAnimationFrame(() => {
        bindViewport()
        scheduleTerminalSizeSync(terminal, fitAddon)
        scrollTerminalToBottom()
      })

      return () => {
        if (terminalResizeFrameRef.current !== null) {
          window.cancelAnimationFrame(terminalResizeFrameRef.current)
          terminalResizeFrameRef.current = null
        }

        cancelPendingOutputScroll()
        cancelPendingOutputTracking()
        container.removeEventListener('wheel', handleWheel, true)
        container.removeEventListener('touchstart', handleTouchStart, true)
        container.removeEventListener('touchmove', handleTouchMove, true)
        container.removeEventListener('touchend', resetTouchTracking, true)
        container.removeEventListener('touchcancel', resetTouchTracking, true)
        scrollDisposable.dispose()
        bufferDisposable.dispose()
        resizeObserver.disconnect()
        dataDisposable.dispose()
        terminal.dispose()
        terminalRef.current = null
        fitAddonRef.current = null
        viewportRef.current = null
      }
    }, [
      cancelPendingOutputScroll,
      cancelPendingOutputTracking,
      pauseFollowingOutput,
      scheduleOutputTracking,
      scrollTerminalToBottom,
      syncOutputTracking,
    ])

    useEffect(() => {
      if (!isActive || snapshotId === null) {
        return
      }

      const terminal = terminalRef.current
      const fitAddon = fitAddonRef.current

      if (!terminal || !fitAddon) {
        return
      }

      requestAnimationFrame(() => {
        fitAddon.fit()

        if (terminal.cols > 0 && terminal.rows > 0) {
          void sessionApiRef.current.resize(terminal.cols, terminal.rows)
        }

        focusTerminal()
        syncOutputTracking()
      })
    }, [focusTerminal, isActive, snapshotId, syncOutputTracking])

    useEffect(() => {
      if (!isActive) {
        return
      }

      const terminal = terminalRef.current
      const fitAddon = fitAddonRef.current

      if (!terminal || !fitAddon) {
        return
      }

      requestAnimationFrame(() => {
        fitAddon.fit()

        if (terminal.cols > 0 && terminal.rows > 0) {
          if (initialSizeRef.current === null) {
            const nextSize = { cols: terminal.cols, rows: terminal.rows }
            initialSizeRef.current = nextSize
            setInitialSize(nextSize)
          }

          void sessionApiRef.current.resize(terminal.cols, terminal.rows)
        }

        focusTerminal()
        syncOutputTracking()
      })
    }, [focusTerminal, isActive, syncOutputTracking])

    useImperativeHandle(
      ref,
      () => ({
        focus() {
          focusTerminal()
        },
        startSession() {
          focusTerminal()
          void startCliSession(shouldStartSession)
        },
      }),
      [focusTerminal, shouldStartSession, startCliSession],
    )

    function handleJumpToLatest() {
      scrollTerminalToBottom()
    }

    function handleReactivateSession() {
      setIsExitPromptOpen(false)
      void startCliSession(true)
    }

    function handleConfirmCloseSession() {
      setIsExitPromptOpen(false)
      onRequestClose()
    }

    function handleExitPromptKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    function handleTerminalEvent(event: TerminalEvent) {
      const terminal = terminalRef.current

      if (!terminal) {
        return
      }

      if (event.event === 'output') {
        terminal.write(event.data.payload, () => {
          revealIncomingOutput()
        })
        return
      }

      if (event.event === 'error') {
        terminal.write(`\r\n\x1b[31m[${t('terminal.sessionError')}]\x1b[0m ${event.data.message}\r\n`, () => {
          revealIncomingOutput()
        })
        return
      }

      terminal.write(
        `\r\n\x1b[33m[${t('terminal.sessionExited')}]\x1b[0m code=${event.data.exitCode}${
          event.data.signal ? ` signal=${event.data.signal}` : ''
        }\r\n`,
        () => {
          revealIncomingOutput()
        },
      )
    }

    const statusPresentation = getStatusPresentation(lifecycleStatus, t)
    function handleClosePreview() {
      setIsPreviewEnabled(false)
      requestAnimationFrame(() => {
        focusTerminal()
      })
    }

    return (
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--cli-bg-deep)]">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--cli-border-muted)] bg-[var(--cli-bg-raised)] px-2.5 py-1.5 sm:px-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                lifecycleStatus === 'running'
                  ? 'bg-emerald-400'
                  : lifecycleStatus === 'error'
                    ? 'bg-rose-400'
                    : 'bg-amber-300'
              }`}
            />
            <div className="min-w-0">
              <div className="truncate text-[0.73rem] font-semibold text-[var(--cli-text)]">
                {activeSessionLabel}
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[0.62rem] text-[var(--cli-text-muted)]">
                <span>{statusPresentation.label}</span>
                {isConnecting ? <span>{t('terminal.initializing')}</span> : null}
                {hasPendingTargetChange ? (
                  <StatusPill
                    label={t('terminal.pendingSwitch', { label: selectedLaunchTargetLabel })}
                    tone="warning"
                  />
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5 text-[0.62rem] text-[var(--cli-text-muted)]">
            <span className="hidden sm:inline">
              {isFollowingOutput ? t('terminal.following') : t('terminal.scrollHistory')}
            </span>

            <label className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md border border-[var(--cli-border)] bg-[var(--cli-bg-deep)] px-2 py-1 text-[0.68rem] font-medium text-[var(--cli-text)] transition hover:border-white/[0.1] hover:bg-white/[0.05]">
              <input
                checked={isPreviewEnabled}
                className="h-3 w-3 accent-white"
                onChange={(event) => setIsPreviewEnabled(event.target.checked)}
                type="checkbox"
              />
              <span>{t('terminal.preview')}</span>
            </label>

            {!isFollowingOutput || unseenOutputCount > 0 ? (
              <button
                className="inline-flex items-center rounded-md border border-[var(--cli-border)] bg-white/[0.035] px-2 py-1 text-[0.65rem] font-medium text-[var(--cli-text)] transition hover:border-white/[0.12] hover:bg-white/[0.07]"
                onClick={handleJumpToLatest}
                type="button"
              >
                {unseenOutputCount > 0
                  ? t('terminal.newOutput', { count: unseenOutputCount })
                  : t('terminal.goToEnd')}
              </button>
            ) : null}

          </div>
        </div>

        {cliValidationError || error || lastExit ? (
          <div className="shrink-0 border-b border-[var(--cli-border-muted)] bg-[var(--cli-bg)] px-3 pt-2 sm:px-4">
            {cliValidationError ? (
              <FeedbackBanner tone="warning">{translateError(cliValidationError, t)}</FeedbackBanner>
            ) : null}

            {error ? <FeedbackBanner tone="danger">{error}</FeedbackBanner> : null}

            {lastExit ? (
              <FeedbackBanner tone="warning">
                {t('terminal.exitCode', { code: lastExit.exitCode })}
                {lastExit.signal ? ` (${lastExit.signal})` : ''}
              </FeedbackBanner>
            ) : null}
          </div>
        ) : null}

        <div className="relative flex min-h-0 flex-1 overflow-hidden" ref={bodyRef}>
          <div className="terminal-cli-surface relative min-h-0 flex-1 bg-[var(--cli-bg-deep)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-5 bg-[linear-gradient(180deg,rgba(2,9,12,0.92),transparent)]" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-5 bg-[linear-gradient(0deg,rgba(2,9,12,0.96),transparent)]" />

            {unseenOutputCount > 0 ? (
              <button
                className="absolute bottom-4 right-4 z-[2] inline-flex items-center gap-2 rounded-md border border-white/[0.08] bg-[#121212] px-3 py-1.5 text-[0.76rem] font-medium text-[var(--cli-text)] transition hover:border-white/[0.14] hover:bg-[#181818]"
                onClick={handleJumpToLatest}
                type="button"
              >
                <span>{t('terminal.updates', { count: unseenOutputCount })}</span>
                <span className="text-[var(--cli-text-muted)]">{t('terminal.jumpNow')}</span>
              </button>
            ) : null}

            <div className="h-full w-full overflow-hidden bg-[var(--cli-bg-deep)]">
              <div
                className="h-full w-full cursor-text"
                onClick={focusTerminal}
                ref={containerRef}
              />
            </div>
          </div>

          {isPreviewEnabled && !isPreviewOverlay ? (
            <div
              className="h-full min-h-0 shrink-0 border-l border-[var(--cli-border-muted)] bg-[var(--cli-bg)]"
              style={{ width: previewPanelWidth }}
            >
              <ChangePreviewPane
                error={changePreview.error}
                isStarting={
                  changePreview.isStarting ||
                  (snapshotId === null && shouldStartSession && lifecycleStatus === 'starting')
                }
                onClose={handleClosePreview}
                snapshot={changePreview.snapshot}
              />
            </div>
          ) : null}

          {isPreviewEnabled && isPreviewOverlay ? (
            <>
              <button
                aria-label={t('preview.close')}
                className="absolute inset-0 z-20 bg-black/45 backdrop-blur-[2px]"
                onClick={handleClosePreview}
                type="button"
              />

              <div className="pointer-events-none absolute inset-0 z-30 p-3">
                <div className="pointer-events-auto flex h-full w-full justify-end">
                  <div
                    className="h-full min-h-0 max-w-full overflow-hidden border border-[var(--cli-border)] bg-[var(--cli-bg)] shadow-[0_18px_42px_rgba(0,0,0,0.42)]"
                    style={{ width: previewPanelWidth }}
                  >
                    <ChangePreviewPane
                      error={changePreview.error}
                      isStarting={
                        changePreview.isStarting ||
                        (snapshotId === null &&
                          shouldStartSession &&
                          lifecycleStatus === 'starting')
                      }
                      onClose={handleClosePreview}
                      snapshot={changePreview.snapshot}
                    />
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {isExitPromptOpen ? (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm">
              <div
                aria-label={t('terminal.exitPrompt.title')}
                aria-modal="true"
                className="w-full max-w-sm rounded-md border border-white/[0.1] bg-[#101010] p-4 shadow-[0_18px_44px_rgba(0,0,0,0.48)]"
                onKeyDown={handleExitPromptKeyDown}
                role="dialog"
              >
                <div className="mb-3">
                  <h2 className="text-sm font-semibold text-[var(--cli-text)]">
                    {t('terminal.exitPrompt.title')}
                  </h2>
                  <p className="mt-1.5 text-[0.78rem] leading-5 text-[var(--cli-text-muted)]">
                    {t('terminal.exitPrompt.message', { label: activeSessionLabel })}
                  </p>
                </div>

                {lastExit ? (
                  <div className="mb-4 rounded-md border border-amber-400/16 bg-amber-400/[0.08] px-3 py-2 text-[0.72rem] text-amber-100">
                    {t('terminal.exitCode', { code: lastExit.exitCode })}
                    {lastExit.signal ? ` (${lastExit.signal})` : ''}
                  </div>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    className="inline-flex h-8 items-center justify-center rounded-md border border-[var(--cli-border)] bg-[var(--cli-bg-deep)] px-3 text-[0.75rem] font-medium text-[var(--cli-text)] transition hover:border-white/[0.12] hover:bg-white/[0.055]"
                    onClick={handleConfirmCloseSession}
                    type="button"
                  >
                    {t('terminal.exitPrompt.closeTerminal')}
                  </button>
                  <button
                    className="inline-flex h-8 items-center justify-center rounded-md border border-white bg-white px-3 text-[0.75rem] font-semibold text-slate-950 transition hover:bg-slate-200"
                    onClick={handleReactivateSession}
                    ref={exitPromptPrimaryButtonRef}
                    type="button"
                  >
                    {t('terminal.exitPrompt.reactivate')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    )
  },
)

function resolvePreviewDockedWidth(availableWidth: number) {
  if (availableWidth <= 0) {
    return PREVIEW_DEFAULT_DOCKED_WIDTH
  }

  const maxWidth = Math.min(
    PREVIEW_MAX_DOCKED_WIDTH,
    Math.max(
      PREVIEW_MIN_DOCKED_WIDTH,
      Math.round(availableWidth * PREVIEW_MAX_DOCKED_RATIO),
    ),
  )

  return Math.max(
    PREVIEW_MIN_DOCKED_WIDTH,
    Math.min(maxWidth, PREVIEW_DEFAULT_DOCKED_WIDTH),
  )
}

function resolvePreviewOverlayWidth(availableWidth: number) {
  if (availableWidth <= 0) {
    return PREVIEW_OVERLAY_MAX_WIDTH
  }

  return Math.max(
    1,
    Math.min(PREVIEW_OVERLAY_MAX_WIDTH, availableWidth - PREVIEW_OVERLAY_PADDING),
  )
}

function resolveTerminalWheelScrollLines(
  event: WheelEvent,
  terminal: Terminal,
  wheelScrollRemainderRef: MutableRefObject<number>,
) {
  let deltaRows = event.deltaY

  if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
    const configuredFontSize =
      typeof terminal.options.fontSize === 'number' ? terminal.options.fontSize : 14
    const configuredLineHeight =
      typeof terminal.options.lineHeight === 'number' ? terminal.options.lineHeight : 1
    const lineHeight = Math.max(
      1,
      configuredFontSize * configuredLineHeight || TERMINAL_WHEEL_FALLBACK_LINE_HEIGHT,
    )

    deltaRows = event.deltaY / lineHeight
  } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    deltaRows = event.deltaY * terminal.rows
  }

  wheelScrollRemainderRef.current += deltaRows

  const wholeRows =
    wheelScrollRemainderRef.current < 0
      ? Math.ceil(wheelScrollRemainderRef.current)
      : Math.floor(wheelScrollRemainderRef.current)

  wheelScrollRemainderRef.current -= wholeRows

  return wholeRows
}

function FeedbackBanner({
  children,
  tone,
}: {
  children: ReactNode
  tone: 'danger' | 'warning'
}) {
  const toneClassName =
    tone === 'danger'
      ? 'border-rose-400/18 bg-rose-400/[0.08] text-rose-100'
      : 'border-amber-400/18 bg-amber-400/[0.08] text-amber-100'

  return (
    <div className={`mb-2 rounded-md border px-3 py-2 text-[0.76rem] ${toneClassName}`}>
      {children}
    </div>
  )
}

function StatusPill({
  label,
  tone = 'default',
}: {
  label: string
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info'
}) {
  const toneClassName = {
    default: 'border-[var(--cli-border)] bg-white/[0.02] text-[var(--cli-text)]',
    success: 'border-emerald-400/16 bg-emerald-400/[0.08] text-emerald-100',
    warning: 'border-amber-400/16 bg-amber-400/[0.08] text-amber-100',
    danger: 'border-rose-400/16 bg-rose-400/[0.08] text-rose-100',
    info: 'border-blue-400/16 bg-blue-400/[0.08] text-blue-100',
  }[tone]

  return (
    <span className={`rounded border px-1.5 py-0.5 text-[0.62rem] ${toneClassName}`}>
      {label}
    </span>
  )
}

function getStatusPresentation(status: TerminalLifecycleStatus, t: TFunction) {
  switch (status) {
    case 'starting':
      return {
        label: t('terminal.starting'),
        tone: 'info' as const,
      }
    case 'running':
      return {
        label: t('terminal.running'),
        tone: 'success' as const,
      }
    case 'error':
      return {
        label: t('terminal.error'),
        tone: 'danger' as const,
      }
    case 'closed':
      return {
        label: t('terminal.closed'),
        tone: 'warning' as const,
      }
  }
}

function asErrorMessage(error: unknown, launchTarget: CliLaunchTarget, t: TFunction) {
  if (error instanceof Error) {
    return error.message
  }

  return t('terminal.validateError', { label: getCliLaunchTargetLabel(launchTarget) })
}
