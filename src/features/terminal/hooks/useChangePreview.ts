import { Channel } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { startChangePreview, stopChangePreview } from '../api'
import type { ChangePreviewEvent, ChangePreviewSnapshot } from '../types'

interface UseChangePreviewOptions {
  enabled: boolean
  sessionId: number | null
}

export function useChangePreview({ enabled, sessionId }: UseChangePreviewOptions) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<ChangePreviewSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  useEffect(() => {
    if (!enabled || sessionId === null) {
      setSnapshot(null)
      setError(null)
      setIsStarting(false)
      return
    }

    let ignore = false
    const activeSessionId = sessionId
    const eventChannel = new Channel<ChangePreviewEvent>()

    setError(null)
    setIsStarting(true)

    eventChannel.onmessage = (event) => {
      if (ignore) {
        return
      }

      if (event.event === 'snapshot') {
        setSnapshot(event.data)
        setError(event.data.error)
        return
      }

      setError(event.data.message)
    }

    async function startPreview() {
      try {
        const initialSnapshot = await startChangePreview(activeSessionId, eventChannel)

        if (ignore) {
          return
        }

        setSnapshot(initialSnapshot)
        setError(initialSnapshot.error)
      } catch (previewError) {
        if (ignore) {
          return
        }

        setError(asErrorMessage(previewError, t('preview.startError')))
      } finally {
        if (!ignore) {
          setIsStarting(false)
        }
      }
    }

    void startPreview()

    return () => {
      ignore = true
      void stopChangePreview(activeSessionId).catch(() => {})
    }
  }, [enabled, sessionId, t])

  return {
    snapshot,
    error,
    isStarting,
  }
}

function asErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    return error.message
  }

  return fallbackMessage
}
