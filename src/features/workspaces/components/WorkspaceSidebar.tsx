import { useRef, useState, type FocusEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { getResolvedLocale } from '../../../shared/i18n'
import {
  CheckCircleIcon,
  PlusIcon,
  SearchIcon,
  SidebarCloseIcon,
  SparklesIcon,
  StarIcon,
  TrashIcon,
} from '../../../shared/ui/icons'
import { LanguageSwitch } from '../../../shared/ui/LanguageSwitch'
import type { RecentWorkspace } from '../types'

interface WorkspaceSidebarProps {
  activeWorkspacePath: string | null
  favoritePaths: string[]
  isLoading: boolean
  isPickingWorkspace: boolean
  isPinned: boolean
  recentWorkspaces: RecentWorkspace[]
  onOpenRecent: (path: string) => void
  onPickWorkspace: () => void
  onRemoveRecent: (path: string) => void
  onShowHome: () => void
  onTogglePinned: () => void
  onToggleFavorite: (path: string) => void
}

export function WorkspaceSidebar({
  activeWorkspacePath,
  favoritePaths,
  isLoading,
  isPickingWorkspace,
  isPinned,
  recentWorkspaces,
  onOpenRecent,
  onPickWorkspace,
  onRemoveRecent,
  onShowHome,
  onTogglePinned,
  onToggleFavorite,
}: WorkspaceSidebarProps) {
  const { i18n } = useTranslation()
  const locale = getResolvedLocale(i18n.resolvedLanguage)
  const desktopSidebarRef = useRef<HTMLDivElement>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [hasKeyboardFocus, setHasKeyboardFocus] = useState(false)
  const [workspaceQuery, setWorkspaceQuery] = useState('')
  const favoriteWorkspaces = recentWorkspaces.filter((workspace) =>
    favoritePaths.includes(workspace.path),
  )
  const recentItems = recentWorkspaces.filter(
    (workspace) => !favoritePaths.includes(workspace.path),
  )
  const normalizedWorkspaceQuery = workspaceQuery.trim().toLocaleLowerCase(locale)
  const isFilteringWorkspaces = normalizedWorkspaceQuery.length > 0
  const visibleFavoriteWorkspaces = isFilteringWorkspaces
    ? favoriteWorkspaces.filter((workspace) =>
        matchesWorkspaceQuery(workspace, normalizedWorkspaceQuery, locale),
      )
    : favoriteWorkspaces
  const visibleRecentItems = isFilteringWorkspaces
    ? recentItems.filter((workspace) =>
        matchesWorkspaceQuery(workspace, normalizedWorkspaceQuery, locale),
      )
    : recentItems
  const isExpanded = isPinned || isHovered || hasKeyboardFocus
  const collapsedExpandedPanelProps = isExpanded ? {} : { inert: '' }

  function handleBlurCapture(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget

    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return
    }

    setHasKeyboardFocus(false)
  }

  function handleTogglePinned() {
    if (isPinned) {
      setIsHovered(false)
      setHasKeyboardFocus(false)

      const activeElement = document.activeElement

      if (
        activeElement instanceof HTMLElement &&
        desktopSidebarRef.current?.contains(activeElement)
      ) {
        activeElement.blur()
      }
    }

    onTogglePinned()
  }

  return (
    <>
      <aside className="w-full shrink-0 border-b border-white/[0.06] bg-[#111113] lg:hidden">
        <SidebarExpandedContent
          activeWorkspacePath={activeWorkspacePath}
          favoritePaths={favoritePaths}
          favoriteWorkspaces={visibleFavoriteWorkspaces}
          isFilteringWorkspaces={isFilteringWorkspaces}
          isLoading={isLoading}
          isPickingWorkspace={isPickingWorkspace}
          isLogoPinControl={false}
          locale={locale}
          recentItems={visibleRecentItems}
          recentWorkspaces={recentWorkspaces}
          workspaceQuery={workspaceQuery}
          onOpenRecent={onOpenRecent}
          onPickWorkspace={onPickWorkspace}
          onRemoveRecent={onRemoveRecent}
          onShowHome={onShowHome}
          onToggleFavorite={onToggleFavorite}
          onTogglePinned={handleTogglePinned}
          onWorkspaceQueryChange={setWorkspaceQuery}
        />
      </aside>

      <aside
        className={`relative z-20 hidden h-full shrink-0 overflow-hidden bg-[#111113] transition-[width] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none lg:block ${
          isExpanded ? 'lg:w-[14rem]' : 'lg:w-[3.75rem]'
        }`}
      >
        <div
          ref={desktopSidebarRef}
          className="relative h-full"
          onBlurCapture={handleBlurCapture}
          onFocusCapture={() => setHasKeyboardFocus(true)}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <SidebarRail
            isPickingWorkspace={isPickingWorkspace}
            isPinned={isPinned}
            onPickWorkspace={onPickWorkspace}
            onTogglePinned={handleTogglePinned}
          />

          <div
            aria-hidden={!isExpanded}
            className={`pointer-events-none absolute left-0 top-0 z-20 h-full w-[14rem] origin-left transform-gpu transition-[opacity,transform] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[opacity,transform] motion-reduce:transition-none ${
              isExpanded
                ? 'translate-x-0 opacity-100'
                : '-translate-x-3 opacity-0'
            }`}
            {...collapsedExpandedPanelProps}
          >
            <div className={`h-full ${isExpanded ? 'pointer-events-auto' : 'pointer-events-none'}`}>
              <SidebarExpandedContent
                activeWorkspacePath={activeWorkspacePath}
                favoritePaths={favoritePaths}
                favoriteWorkspaces={visibleFavoriteWorkspaces}
                isFilteringWorkspaces={isFilteringWorkspaces}
                isLoading={isLoading}
                isPinned={isPinned}
                isPickingWorkspace={isPickingWorkspace}
                isLogoPinControl
                locale={locale}
                recentItems={visibleRecentItems}
                recentWorkspaces={recentWorkspaces}
                workspaceQuery={workspaceQuery}
                onOpenRecent={onOpenRecent}
                onPickWorkspace={onPickWorkspace}
                onRemoveRecent={onRemoveRecent}
                onShowHome={onShowHome}
                onToggleFavorite={onToggleFavorite}
                onTogglePinned={handleTogglePinned}
                onWorkspaceQueryChange={setWorkspaceQuery}
              />
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

function matchesWorkspaceQuery(
  workspace: RecentWorkspace,
  normalizedQuery: string,
  locale: string,
) {
  return (
    workspace.name.toLocaleLowerCase(locale).includes(normalizedQuery) ||
    workspace.path.toLocaleLowerCase(locale).includes(normalizedQuery)
  )
}

interface WorkspaceListSectionProps {
  activeWorkspacePath: string | null
  emptyLabel: string
  favoritePaths: string[]
  items: RecentWorkspace[]
  locale: string
  title: string
  onOpenRecent: (path: string) => void
  onRemoveRecent: (path: string) => void
  onToggleFavorite: (path: string) => void
}

interface SidebarExpandedContentProps {
  activeWorkspacePath: string | null
  favoritePaths: string[]
  favoriteWorkspaces: RecentWorkspace[]
  isFilteringWorkspaces: boolean
  isLoading: boolean
  isLogoPinControl: boolean
  locale: string
  isPinned?: boolean
  isPickingWorkspace: boolean
  recentItems: RecentWorkspace[]
  recentWorkspaces: RecentWorkspace[]
  workspaceQuery: string
  onOpenRecent: (path: string) => void
  onPickWorkspace: () => void
  onRemoveRecent: (path: string) => void
  onShowHome: () => void
  onToggleFavorite: (path: string) => void
  onTogglePinned: () => void
  onWorkspaceQueryChange: (query: string) => void
}

interface SidebarRailProps {
  isPickingWorkspace: boolean
  isPinned: boolean
  onPickWorkspace: () => void
  onTogglePinned: () => void
}

function SidebarRail({
  isPickingWorkspace,
  isPinned,
  onPickWorkspace,
  onTogglePinned,
}: SidebarRailProps) {
  const { t } = useTranslation()
  const sidebarToggleLabel = isPinned ? t('workspace.sidebarClose') : t('workspace.sidebarOpen')

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#111113] px-2 py-2">
      <div className="flex items-center justify-center">
        <button
          aria-label={sidebarToggleLabel}
          aria-pressed={isPinned}
          className={`flex h-9 w-9 items-center justify-center rounded-md transition ${
            isPinned
              ? 'bg-white/[0.1] text-white'
              : 'bg-transparent text-slate-400 hover:bg-white/[0.06] hover:text-white'
          }`}
          onClick={onTogglePinned}
          title={sidebarToggleLabel}
          type="button"
        >
          <SidebarCloseIcon size={16} strokeWidth={1.7} />
        </button>
      </div>

      <div className="mt-4 flex flex-1 flex-col items-center gap-1.5">
        <SidebarRailButton
          disabled={isPickingWorkspace}
          icon={<PlusIcon size={17} strokeWidth={1.9} />}
          label={isPickingWorkspace ? t('workspace.pickerOpening') : t('workspace.selectFolder')}
          onClick={onPickWorkspace}
        />
      </div>

      <div className="pt-2">
        <LanguageSwitch compact />
      </div>
    </div>
  )
}

function SidebarRailButton({
  disabled = false,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      className="relative flex h-9 w-9 items-center justify-center rounded-md bg-transparent text-slate-400 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {icon}
    </button>
  )
}

function WorkspaceSearchControl({
  isPickingWorkspace,
  query,
  onClick,
  onQueryChange,
}: {
  isPickingWorkspace: boolean
  query: string
  onClick: () => void
  onQueryChange: (query: string) => void
}) {
  const { t } = useTranslation()
  const pickWorkspaceLabel = isPickingWorkspace
    ? t('workspace.pickerOpening')
    : t('workspace.selectFolder')

  return (
    <div className="flex h-8 items-center rounded-md border border-white/[0.08] bg-white/[0.035] text-slate-300 transition focus-within:border-white/[0.16] focus-within:bg-white/[0.055]">
      <SearchIcon className="ml-2 shrink-0 text-slate-500" size={13} strokeWidth={1.9} />
      <input
        aria-label={t('workspace.searchAria')}
        className="min-w-0 flex-1 bg-transparent px-2 text-[0.75rem] text-slate-200 outline-none placeholder:text-slate-500"
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={t('workspace.searchPlaceholder')}
        type="search"
        value={query}
      />
      <button
        aria-label={pickWorkspaceLabel}
        className="flex h-full w-8 shrink-0 items-center justify-center rounded-r-md border-l border-white/[0.08] text-slate-400 transition hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isPickingWorkspace}
        onClick={onClick}
        title={pickWorkspaceLabel}
        type="button"
      >
        <PlusIcon size={15} strokeWidth={2} />
      </button>
    </div>
  )
}

function SidebarExpandedContent({
  activeWorkspacePath,
  favoritePaths,
  favoriteWorkspaces,
  isFilteringWorkspaces,
  isLoading,
  isLogoPinControl,
  locale,
  isPinned = false,
  isPickingWorkspace,
  recentItems,
  recentWorkspaces,
  workspaceQuery,
  onOpenRecent,
  onPickWorkspace,
  onRemoveRecent,
  onShowHome,
  onToggleFavorite,
  onTogglePinned,
  onWorkspaceQueryChange,
}: SidebarExpandedContentProps) {
  const { t } = useTranslation()
  const pinButtonLabel = isPinned ? t('workspace.sidebarClose') : t('workspace.sidebarOpen')

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#111113] px-2 py-2.5 lg:border-r lg:border-white/[0.06]">
      <div className="flex items-center gap-2">
        <button
          aria-label={t('workspace.goHome')}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition hover:bg-white/[0.05]"
          onClick={onShowHome}
          title={t('workspace.goHome')}
          type="button"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.06] text-slate-100">
            <SparklesIcon size={16} strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[0.78rem] font-semibold tracking-[0.12em] text-white">
              CLI APP
            </div>
            <div className="truncate text-[0.58rem] uppercase tracking-[0.16em] text-slate-500">
              Workspace hub
            </div>
          </div>
        </button>

        {isLogoPinControl ? (
          <button
            aria-label={pinButtonLabel}
            aria-pressed={isPinned}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition ${
              isPinned
                ? 'bg-white/[0.1] text-white'
                : 'bg-transparent text-slate-400 hover:bg-white/[0.06] hover:text-white'
            }`}
            onClick={onTogglePinned}
            title={pinButtonLabel}
            type="button"
          >
            <SidebarCloseIcon size={15} strokeWidth={1.7} />
          </button>
        ) : null}
      </div>

      <div className="mt-4">
        <WorkspaceSearchControl
          isPickingWorkspace={isPickingWorkspace}
          query={workspaceQuery}
          onClick={onPickWorkspace}
          onQueryChange={onWorkspaceQueryChange}
        />
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <WorkspaceListSection
          activeWorkspacePath={activeWorkspacePath}
          emptyLabel={
            isFilteringWorkspaces
              ? t('workspace.recentEmptyFiltered')
              : isLoading
                ? t('workspace.home.loading')
                : t('workspace.recentEmpty')
          }
          favoritePaths={favoritePaths}
          items={recentItems}
          locale={locale}
          title={t('workspace.recent')}
          onOpenRecent={onOpenRecent}
          onRemoveRecent={onRemoveRecent}
          onToggleFavorite={onToggleFavorite}
        />

        <WorkspaceListSection
          activeWorkspacePath={activeWorkspacePath}
          emptyLabel={
            isFilteringWorkspaces
              ? t('workspace.favoritesEmptyFiltered')
              : t('workspace.favoritesEmpty')
          }
          favoritePaths={favoritePaths}
          items={favoriteWorkspaces}
          locale={locale}
          title={t('workspace.favorites')}
          onOpenRecent={onOpenRecent}
          onRemoveRecent={onRemoveRecent}
          onToggleFavorite={onToggleFavorite}
        />
      </div>

      <div className="mt-3 px-1 pt-2">
        <div className="flex items-center justify-between gap-2 px-1 py-1.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[0.66rem] font-medium text-slate-500">
              <CheckCircleIcon size={14} />
              {t('workspace.runtimeReady')}
            </div>
            <div className="mt-0.5 text-[0.64rem] text-slate-500">
              {recentWorkspaces.length > 0
                ? t('workspace.projectsCount', { count: recentWorkspaces.length })
                : t('workspace.withoutProjects')}
            </div>
          </div>
          <LanguageSwitch />
        </div>
      </div>
    </div>
  )
}

function WorkspaceListSection({
  activeWorkspacePath,
  emptyLabel,
  favoritePaths,
  items,
  locale,
  title,
  onOpenRecent,
  onRemoveRecent,
  onToggleFavorite,
}: WorkspaceListSectionProps) {
  const { t } = useTranslation()

  return (
    <section>
      <div className="mb-1.5 px-1 text-[0.58rem] font-medium uppercase tracking-[0.16em] text-slate-500">
        {title}
      </div>

      <div className="space-y-0.5">
        {items.length === 0 ? (
          <div className="px-2 py-2 text-[0.76rem] leading-5 text-slate-600">
            {emptyLabel}
          </div>
        ) : null}

        {items.map((workspace) => {
          const isFavorite = favoritePaths.includes(workspace.path)
          const isActive = workspace.path === activeWorkspacePath

          return (
            <div
              className={`group rounded-md px-2 py-2 transition focus-within:bg-white/[0.06] ${
                isActive
                  ? 'bg-white/[0.1]'
                  : 'bg-transparent hover:bg-white/[0.055]'
              }`}
              key={workspace.path}
            >
              <div className="flex items-start gap-2">
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onOpenRecent(workspace.path)}
                  type="button"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`truncate text-[0.8rem] font-medium ${
                        isActive ? 'text-white' : 'text-slate-200'
                      }`}
                    >
                      {workspace.name}
                    </div>
                    {isActive ? (
                      <span className="rounded bg-white/[0.08] px-1 py-0.5 text-[0.54rem] uppercase tracking-[0.12em] text-slate-300">
                        {t('common.active')}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-[0.66rem] text-slate-500">
                    {workspace.path}
                  </div>
                  <div className="mt-1 text-[0.55rem] uppercase tracking-[0.12em] text-slate-600">
                    {formatRelativeTimestamp(workspace.lastOpenedAt, locale)}
                  </div>
                </button>

                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    aria-label={
                      isFavorite
                        ? t('workspace.removeFavorite', { name: workspace.name })
                        : t('workspace.favorite', { name: workspace.name })
                    }
                    className={`rounded-md p-1 transition ${
                      isFavorite
                        ? 'text-amber-300 hover:bg-amber-400/10'
                        : 'text-slate-600 hover:bg-white/5 hover:text-slate-300'
                    }`}
                    onClick={() => onToggleFavorite(workspace.path)}
                    type="button"
                  >
                    <StarIcon
                      fill={isFavorite ? 'currentColor' : 'none'}
                      size={14}
                      strokeWidth={isFavorite ? 1.3 : 1.8}
                    />
                  </button>

                  <button
                    aria-label={t('workspace.remove', { name: workspace.name })}
                    className="rounded-md p-1 text-slate-600 transition hover:bg-rose-500/10 hover:text-rose-200"
                    onClick={() => onRemoveRecent(workspace.path)}
                    type="button"
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
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
