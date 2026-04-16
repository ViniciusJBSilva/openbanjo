import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getCliUsage } from '../../terminal/api'
import type { CliToolKind, CliUsageResult } from '../../terminal/types'
import { RefreshCwIcon } from '../../../shared/ui/icons'

const CACHE_TTL_MS = 5 * 60 * 1000

interface CachedResult {
  data: CliUsageResult
  fetchedAt: number
}

function useCliUsageCache() {
  const cacheRef = useRef<Map<string, CachedResult>>(new Map())

  const getCached = useCallback((tool: CliToolKind): CachedResult | null => {
    const entry = cacheRef.current.get(tool)
    if (!entry) return null
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
      cacheRef.current.delete(tool)
      return null
    }
    return entry
  }, [])

  const setCached = useCallback((tool: CliToolKind, data: CliUsageResult) => {
    cacheRef.current.set(tool, { data, fetchedAt: Date.now() })
  }, [])

  const invalidate = useCallback((tool?: CliToolKind) => {
    if (tool) {
      cacheRef.current.delete(tool)
    } else {
      cacheRef.current.clear()
    }
  }, [])

  return { getCached, setCached, invalidate }
}

function formatTimeAgo(ms: number, t: (key: string, options: { count: number }) => string): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return t('usage.timeAgo.seconds', { count: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('usage.timeAgo.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  return t('usage.timeAgo.hours', { count: hours })
}

function UsageCard({
  tool,
  label,
  version,
  cachedResult,
  onRefresh,
}: {
  tool: CliToolKind
  label: string
  version: string | null
  cachedResult: CachedResult | null | undefined
  onRefresh: (tool: CliToolKind) => void
}) {
  const { t } = useTranslation()
  const isLoading = cachedResult == null
  const age = cachedResult ? Date.now() - cachedResult.fetchedAt : null

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${
              cachedResult?.data.success
                ? 'bg-emerald-400'
                : cachedResult
                  ? 'bg-amber-400'
                  : 'bg-slate-500'
            }`}
          />
          <h3 className="text-sm font-semibold text-white">{label}</h3>
          {version && (
            <span className="rounded-full border border-white/[0.06] bg-white/[0.04] px-2 py-0.5 text-xs text-slate-400">
              {version}
            </span>
          )}
        </div>
        <button
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
          onClick={() => onRefresh(tool)}
          title={t('usage.refresh')}
          type="button"
        >
          <RefreshCwIcon size={14} />
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <div className="h-4 w-3/4 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-white/[0.06]" />
        </div>
      ) : cachedResult?.data.success ? (
        <pre className="max-h-48 overflow-y-auto text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">
          {cachedResult.data.output}
        </pre>
      ) : cachedResult?.data.error ? (
        <p className="text-xs text-amber-400/80">{cachedResult.data.error}</p>
      ) : (
        <p className="text-xs text-slate-500">{t('usage.empty')}</p>
      )}

      {age !== null && (
        <p className="mt-2 text-[10px] text-slate-500">
          {t('usage.updated', { time: formatTimeAgo(age, t) })}
        </p>
      )}
    </div>
  )
}

export function UsagePopover({
  isOpen,
  onClose,
  claudeVersion,
  codexVersion,
}: {
  isOpen: boolean
  onClose: () => void
  claudeVersion: string | null
  codexVersion: string | null
}) {
  const { t } = useTranslation()
  const [claudeCache, setClaudeCache] = useState<CachedResult | null>(null)
  const [codexCache, setCodexCache] = useState<CachedResult | null>(null)
  const { getCached, setCached, invalidate } = useCliUsageCache()
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchUsage = useCallback(
    async (tool: CliToolKind) => {
      try {
        const result = await getCliUsage(tool)
        setCached(tool, result)
        if (tool === 'claude') {
          setClaudeCache({ data: result, fetchedAt: Date.now() })
        } else {
          setCodexCache({ data: result, fetchedAt: Date.now() })
        }
      } catch {
        const errorResult: CliUsageResult = {
          tool,
          output: '',
          success: false,
          error: t('usage.backendError'),
        }
        setCached(tool, errorResult)
        if (tool === 'claude') {
          setClaudeCache({ data: errorResult, fetchedAt: Date.now() })
        } else {
          setCodexCache({ data: errorResult, fetchedAt: Date.now() })
        }
      }
    },
    [setCached, t],
  )

  useEffect(() => {
    if (!isOpen) return

    const cachedClaude = getCached('claude')
    const cachedCodex = getCached('codex')
    setClaudeCache(cachedClaude)
    setCodexCache(cachedCodex)

    if (!cachedClaude) {
      void fetchUsage('claude')
    }
    if (!cachedCodex) {
      void fetchUsage('codex')
    }
  }, [isOpen, fetchUsage, getCached])

  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose])

  const handleRefresh = useCallback(
    (tool: CliToolKind) => {
      invalidate(tool)
      void fetchUsage(tool)
    },
    [invalidate, fetchUsage],
  )

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        ref={containerRef}
        className="mx-4 w-full max-w-lg rounded-2xl border border-white/[0.1] bg-[#16181d] p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">
            {t('usage.title')}
          </h2>
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
            onClick={onClose}
            type="button"
          >
            <svg
              fill="none"
              height={18}
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth={2}
              viewBox="0 0 24 24"
              width={18}
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <UsageCard
            tool="claude"
            label="Claude"
            version={claudeVersion}
            cachedResult={claudeCache}
            onRefresh={handleRefresh}
          />
          <UsageCard
            tool="codex"
            label="Codex"
            version={codexVersion}
            cachedResult={codexCache}
            onRefresh={handleRefresh}
          />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-[10px] text-slate-500">
            {t('usage.fetchedVia')}
          </p>
          <button
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
            onClick={() => {
              invalidate()
              void fetchUsage('claude')
              void fetchUsage('codex')
            }}
            type="button"
          >
            <RefreshCwIcon size={12} />
            {t('usage.all')}
          </button>
        </div>
      </div>
    </div>
  )
}
