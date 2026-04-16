import { Channel } from '@tauri-apps/api/core'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  closeTerminalSession,
  createTerminalSession,
  resizeTerminalSession,
  writeTerminalInput,
} from '../api'
import type {
  TerminalEvent,
  TerminalExitInfo,
  TerminalLaunchTarget,
  TerminalLifecycleStatus,
  TerminalSessionSnapshot,
} from '../types'

interface UseTerminalSessionOptions {
  enabled: boolean
  launchTarget: TerminalLaunchTarget
  workspacePath: string
  initialCols: number
  initialRows: number
  onEvent: (event: TerminalEvent) => void
}

export function useTerminalSession({
  enabled,
  launchTarget,
  workspacePath,
  initialCols,
  initialRows,
  onEvent,
}: UseTerminalSessionOptions) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<TerminalSessionSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lifecycleStatus, setLifecycleStatus] =
    useState<TerminalLifecycleStatus>('starting')
  const [lastExit, setLastExit] = useState<TerminalExitInfo | null>(null)
  const [sessionRevision, setSessionRevision] = useState(0)
  const [isSessionEnabled, setIsSessionEnabled] = useState(true)

  const sessionIdRef = useRef<number | null>(null)
  const onEventRef = useRef(onEvent)
  const connectionIdRef = useRef(0)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    setIsSessionEnabled(true)
    setSessionRevision(0)
    setError(null)
    setLastExit(null)
    setLifecycleStatus(enabled ? 'starting' : 'closed')
  }, [enabled, workspacePath])

  useEffect(() => {
    if (!enabled || !isSessionEnabled) {
      if (enabled && !isSessionEnabled) {
        setLifecycleStatus('closed')
      }
      return
    }

    let ignore = false
    const connectionId = connectionIdRef.current + 1
    connectionIdRef.current = connectionId

    setLifecycleStatus('starting')
    setError(null)
    setLastExit(null)
    setSnapshot(null)

    const eventChannel = new Channel<TerminalEvent>()
    eventChannel.onmessage = (event) => {
      if (connectionIdRef.current !== connectionId) {
        return
      }

      onEventRef.current(event)

      if (event.event === 'error') {
        setError(event.data.message)
        setLifecycleStatus('error')
      }

      if (event.event === 'exit') {
        setLastExit({
          exitCode: event.data.exitCode,
          signal: event.data.signal,
        })
        setLifecycleStatus('closed')
        setSnapshot((currentSnapshot) => {
          if (!currentSnapshot) {
            return currentSnapshot
          }

          return {
            ...currentSnapshot,
            status: 'exited',
            exitedAt: Date.now(),
          }
        })
        sessionIdRef.current = null
      }
    }

    async function bootstrapSession() {
      try {
        const nextSnapshot = await createTerminalSession({
          workspacePath,
          cols: initialCols,
          rows: initialRows,
          launchTarget,
          onEvent: eventChannel,
        })

        if (ignore) {
          await closeTerminalSession(nextSnapshot.id).catch(() => {})
          return
        }

        sessionIdRef.current = nextSnapshot.id
        setSnapshot(nextSnapshot)
        setLifecycleStatus('running')
      } catch (sessionError) {
        if (ignore) {
          return
        }

        setError(asErrorMessage(sessionError, t('terminal.validateError', { label: 'terminal' })))
        setLifecycleStatus('error')
      }
    }

    void bootstrapSession()

    return () => {
      ignore = true
      if (connectionIdRef.current === connectionId) {
        connectionIdRef.current = 0
      }

      const activeSessionId = sessionIdRef.current
      sessionIdRef.current = null

      if (activeSessionId !== null) {
        void closeTerminalSession(activeSessionId).catch(() => {})
      }
    }
  }, [
    enabled,
    initialCols,
    initialRows,
    isSessionEnabled,
    launchTarget,
    sessionRevision,
    t,
    workspacePath,
  ])

  async function sendInput(input: string) {
    const activeSessionId = sessionIdRef.current

    if (activeSessionId === null) {
      return
    }

    try {
      await writeTerminalInput(activeSessionId, input)
    } catch (writeError) {
      setError(asErrorMessage(writeError, t('terminal.validateError', { label: 'terminal' })))
      setLifecycleStatus('error')
    }
  }

  async function resize(cols: number, rows: number) {
    const activeSessionId = sessionIdRef.current

    if (activeSessionId === null) {
      return
    }

    try {
      await resizeTerminalSession(activeSessionId, cols, rows)
      setSnapshot((currentSnapshot) =>
        currentSnapshot
          ? {
              ...currentSnapshot,
              cols,
              rows,
            }
          : currentSnapshot,
      )
    } catch (resizeError) {
      setError(asErrorMessage(resizeError, t('terminal.validateError', { label: 'terminal' })))
      setLifecycleStatus('error')
    }
  }

  function close() {
    setError(null)
    setLastExit(null)
    setLifecycleStatus('closed')
    setSnapshot((currentSnapshot) =>
      currentSnapshot
        ? {
            ...currentSnapshot,
            status: 'exited',
            exitedAt: currentSnapshot.exitedAt ?? Date.now(),
          }
        : currentSnapshot,
    )
    setIsSessionEnabled(false)
  }

  function restart() {
    setError(null)
    setLastExit(null)
    setIsSessionEnabled(true)
    setSessionRevision((currentRevision) => currentRevision + 1)
  }

  return {
    snapshot,
    error,
    isConnecting: lifecycleStatus === 'starting',
    lifecycleStatus,
    lastExit,
    sendInput,
    resize,
    close,
    restart,
  }
}

function asErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    return error.message
  }

  return fallbackMessage
}
