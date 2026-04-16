import { useTranslation } from 'react-i18next'

import { getResolvedLocale } from '../../../shared/i18n'
import { WindowControls, WindowDragRegion } from '../../../shared/ui/WindowChrome'
import type { RecentWorkspace } from '../types'

interface WorkspaceHomeScreenProps {
  error: string | null
  isLoading: boolean
  recentWorkspaces: RecentWorkspace[]
  onOpenRecent: (path: string) => void
}

export function WorkspaceHomeScreen({
  error,
  isLoading,
  recentWorkspaces,
  onOpenRecent,
}: WorkspaceHomeScreenProps) {
  const { i18n, t } = useTranslation()
  const locale = getResolvedLocale(i18n.resolvedLanguage)

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-white/[0.06] bg-[#090909] px-4 py-2.5">
        <WindowDragRegion className="min-w-0">
          <div className="text-[0.68rem] font-medium uppercase tracking-[0.14em] text-slate-500">
            {t('workspace.home.subtitle')}
          </div>
          <h1 className="mt-1 truncate text-lg font-semibold tracking-tight text-white">
            {t('workspace.home.title')}
          </h1>
        </WindowDragRegion>

        <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">
          <div className="hidden rounded-md border border-white/[0.06] bg-white/[0.025] px-2.5 py-1.5 text-[0.75rem] text-slate-400 sm:block">
            {isLoading
              ? t('workspace.home.loading')
              : t('workspace.home.count', { count: recentWorkspaces.length })}
          </div>
          <WindowDragRegion className="hidden h-9 min-w-4 flex-1 sm:block" />
          <WindowControls align="right" />
        </div>
      </header>

      {error ? (
        <div className="shrink-0 border-b border-rose-500/20 bg-rose-500/[0.08] px-4 py-2 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-white/[0.06] px-4 py-2 text-[0.68rem] font-medium uppercase tracking-[0.14em] text-slate-500">
            {t('workspace.home.recent')}
          </div>

          {recentWorkspaces.length > 0 ? (
            <div className="divide-y divide-white/[0.05]">
              {recentWorkspaces.map((workspace) => (
                <WorkspaceRow
                  key={workspace.path}
                  locale={locale}
                  onOpenRecent={onOpenRecent}
                  workspace={workspace}
                />
              ))}
            </div>
          ) : (
            <div className="px-4 py-10 text-sm text-slate-500">
              {t('workspace.home.empty')}
            </div>
          )}
        </div>
      </section>
    </main>
  )
}

function WorkspaceRow({
  locale,
  onOpenRecent,
  workspace,
}: {
  locale: string
  onOpenRecent: (path: string) => void
  workspace: RecentWorkspace
}) {
  return (
    <button
      className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-white/[0.025]"
      onClick={() => onOpenRecent(workspace.path)}
      type="button"
    >
      <span className="min-w-0">
        <span className="block truncate text-[0.9rem] font-medium text-white">
          {workspace.name}
        </span>
        <span className="mt-0.5 block truncate text-[0.74rem] text-slate-500">
          {workspace.path}
        </span>
      </span>
      <span className="shrink-0 text-[0.68rem] text-slate-600">
        {formatRelativeTimestamp(workspace.lastOpenedAt, locale)}
      </span>
    </button>
  )
}

function formatRelativeTimestamp(value: number, locale: string) {
  const elapsed = value - Date.now()
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (Math.abs(elapsed) < hour) {
    return formatter.format(Math.round(elapsed / minute), 'minute')
  }

  if (Math.abs(elapsed) < day) {
    return formatter.format(Math.round(elapsed / hour), 'hour')
  }

  return formatter.format(Math.round(elapsed / day), 'day')
}
