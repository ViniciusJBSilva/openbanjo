import type { TFunction } from 'i18next'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import chatGptIconUrl from '../../../assets/chatgpt-icon.svg'
import claudeIconUrl from '../../../assets/claude-color.svg'
import { getResolvedLocale, translateError } from '../../../shared/i18n'
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  CloseIcon,
  CodeIcon,
  FolderIcon,
  GitBranchIcon,
  PlayIcon,
  RefreshCwIcon,
  SearchIcon,
} from '../../../shared/ui/icons'
import { WindowControls, WindowDragRegion } from '../../../shared/ui/WindowChrome'
import { ChatGPTSidebar } from '../../chatgpt/components/ChatGPTSidebar'
import type { AssistantSidebarProvider } from '../../chatgpt/api'
import { TerminalPane, type TerminalPaneHandle } from '../../terminal/components/TerminalPane'
import { getCliToolStatus } from '../../terminal/api'
import {
  CLI_LAUNCH_TARGETS,
  getCliLaunchTargetLabel,
  type CliLaunchTarget,
  type CliToolStatus,
} from '../../terminal/types'
import {
  checkoutWorkspaceBranch,
  listWorkspaceBranches,
} from '../../workspaces/api'
import type {
  WorkspaceEditorAvailability,
  WorkspaceEditorId,
  WorkspaceBranchOption,
  WorkspaceSummary,
} from '../../workspaces/types'

interface ProjectScreenProps {
  availableEditors: WorkspaceEditorAvailability[]
  error: string | null
  isActive: boolean
  isAssistantSidebarOpen: boolean
  onBack: () => void
  onCloseAssistantSidebar: () => void
  onLaunchWorkspaceEditor: (editorId: WorkspaceEditorId) => Promise<void>
  onSelectEditor: (editorId: WorkspaceEditorId) => void
  onToggleAssistantSidebar: () => void
  onUpdateWorkspace: (workspace: WorkspaceSummary) => void
  selectedEditorId: WorkspaceEditorId
  workspace: WorkspaceSummary
}

interface ProjectSession {
  id: string
  type: CliLaunchTarget
  name: string | null
}

type CliToolStatusMap = Record<CliLaunchTarget, CliToolStatus | null>

export function ProjectScreen({
  availableEditors,
  error,
  isActive,
  isAssistantSidebarOpen,
  onBack,
  onCloseAssistantSidebar,
  onLaunchWorkspaceEditor,
  onSelectEditor,
  onToggleAssistantSidebar,
  onUpdateWorkspace,
  selectedEditorId,
  workspace,
}: ProjectScreenProps) {
  const { t } = useTranslation()
  const terminalRefs = useRef<Record<string, TerminalPaneHandle | null>>({})
  const sessionSequenceRef = useRef(0)
  const [actionError, setActionError] = useState<unknown>(null)
  const [activeEditorId, setActiveEditorId] = useState<WorkspaceEditorId | null>(null)
  const [selectedCliTarget, setSelectedCliTarget] = useState<CliLaunchTarget>('cliApp')
  const [cliToolStatuses, setCliToolStatuses] = useState<CliToolStatusMap>(
    createEmptyCliToolStatusMap,
  )
  const [sessions, setSessions] = useState<ProjectSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const assistantSidebarProvider =
    selectedCliTarget === 'claude' ? 'claude' : 'chatgpt'
  const assistantSidebarLabel = getAssistantSidebarLabel(assistantSidebarProvider)

  useEffect(() => {
    setActionError(null)
    setActiveEditorId(null)
    setSelectedCliTarget('cliApp')
    setCliToolStatuses(createEmptyCliToolStatusMap())
    setSessions([])
    setActiveSessionId(null)
  }, [workspace.path])

  useEffect(() => {
    let isCancelled = false

    async function refreshCliToolStatuses() {
      try {
        const statusEntries = await Promise.all(
          CLI_LAUNCH_TARGETS.map(async (target) => {
            const status = await getCliToolStatus(target)

            return [target, status] as const
          }),
        )

        if (isCancelled) {
          return
        }

        const nextStatuses = createEmptyCliToolStatusMap()

        statusEntries.forEach(([target, status]) => {
          nextStatuses[target] = status
        })

        setCliToolStatuses(nextStatuses)
        setSelectedCliTarget((currentTarget) =>
          resolveAvailableCliTarget(currentTarget, nextStatuses),
        )
      } catch (statusError) {
        if (isCancelled) {
          return
        }

        setActionError(statusError)
      }
    }

    void refreshCliToolStatuses()

    return () => {
      isCancelled = true
    }
  }, [workspace.path])

  useEffect(() => {
    if (!isActive || !activeSessionId) {
      return
    }

    terminalRefs.current[activeSessionId]?.focus()
  }, [activeSessionId, isActive])

  async function handleLaunchEditor(editorId: WorkspaceEditorId) {
    try {
      setActionError(null)
      setActiveEditorId(editorId)
      await onLaunchWorkspaceEditor(editorId)
    } catch (launchError) {
      setActionError(launchError)
    } finally {
      setActiveEditorId(null)
    }
  }

  function ensureSession(target: CliLaunchTarget) {
    sessionSequenceRef.current += 1
    const nextSession: ProjectSession = {
      id: `${workspace.path}:${target}:${sessionSequenceRef.current}`,
      type: target,
      name: null,
    }

    setSessions((currentSessions) => [...currentSessions, nextSession])
    setActiveSessionId(nextSession.id)

    return nextSession.id
  }

  function handleRenameSession(sessionId: string, newName: string) {
    setSessions((currentSessions) =>
      currentSessions.map((session) =>
        session.id === sessionId
          ? { ...session, name: newName.trim() || null }
          : session,
      ),
    )
  }

  function handleStartCliSession(target: CliLaunchTarget) {
    const cliStatus = cliToolStatuses[target]

    if (!cliStatus?.isInstalled) {
      setActionError(
        cliStatus?.error ?? getCliLaunchTargetUnavailableMessage(target, t),
      )
      return
    }

    setActionError(null)
    const sessionId = ensureSession(target)

    requestAnimationFrame(() => {
      terminalRefs.current[sessionId]?.startSession()
    })
  }

  function handleSelectCliTarget(target: CliLaunchTarget) {
    const cliStatus = cliToolStatuses[target]

    if (!cliStatus?.isInstalled) {
      return
    }

    setActionError(null)
    setSelectedCliTarget(target)
  }

  function handleCloseSession(sessionId: string) {
    setSessions((currentSessions) => {
      const nextSessions = currentSessions.filter((session) => session.id !== sessionId)

      delete terminalRefs.current[sessionId]

      setActiveSessionId((currentSessionId) => {
        if (currentSessionId !== sessionId) {
          return currentSessionId
        }

        const closedSessionIndex = currentSessions.findIndex(
          (session) => session.id === sessionId,
        )
        const fallbackSession =
          nextSessions[closedSessionIndex] ?? nextSessions[closedSessionIndex - 1] ?? null

        return fallbackSession?.id ?? null
      })

      return nextSessions
    })
  }

  return (
    <main className="min-w-0 flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--cli-bg)]">
      <section className="relative z-20 shrink-0 overflow-visible border-b border-[var(--cli-border-muted)] bg-[var(--cli-bg-raised)] px-2.5 py-1.5 sm:px-3">
        <WorkspaceTopBar
          activeEditorId={activeEditorId}
          assistantSidebarLabel={assistantSidebarLabel}
          availableEditors={availableEditors}
          isAssistantSidebarOpen={isAssistantSidebarOpen}
          onBack={onBack}
          onLaunchEditor={(editorId) => void handleLaunchEditor(editorId)}
          onSelectEditor={onSelectEditor}
          onStartCliSession={handleStartCliSession}
          onToggleAssistantSidebar={onToggleAssistantSidebar}
          onUpdateWorkspace={onUpdateWorkspace}
          cliToolStatuses={cliToolStatuses}
          selectedCliTarget={selectedCliTarget}
          selectedEditorId={selectedEditorId}
          onSelectCliTarget={handleSelectCliTarget}
          workspace={workspace}
        />
        {error || actionError ? (
          <div className="relative mt-1.5 rounded-md border border-rose-500/20 bg-rose-500/[0.08] px-3 py-1.5 text-sm text-rose-100">
            {actionError ? translateError(actionError, t) : error}
          </div>
        ) : null}
      </section>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="min-h-0 h-full flex-1 overflow-hidden">
          <div className="relative flex h-full min-h-0 overflow-hidden">
            {isAssistantSidebarOpen ? (
              <>
                <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-white/[0.06]" />
              </>
            ) : null}

            <section className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
              <div className="flex min-h-0 flex-1 overflow-hidden bg-[var(--cli-bg)]">
                {sessions.length > 0 ? (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="shrink-0 border-b border-[var(--cli-border-muted)] bg-[var(--cli-bg-raised)] px-1.5 py-1">
                      <div className="flex h-8 min-w-0 items-center gap-1 overflow-x-auto rounded-md border border-[var(--cli-border)] bg-[var(--cli-bg-deep)] p-0.5">
                        {sessions.map((session) => {
                          const isSessionActive = session.id === activeSessionId

                          return (
                            <SessionTab
                              isActive={isSessionActive}
                              key={session.id}
                              onActivate={() => setActiveSessionId(session.id)}
                              onClose={() => handleCloseSession(session.id)}
                              onRename={(newName: string) => handleRenameSession(session.id, newName)}
                              session={session}
                            />
                          )
                        })}
                      </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-hidden">
                      <div className="flex h-full min-h-0 flex-1">
                        {sessions.map((session) => {
                          const isSessionActive = isActive && session.id === activeSessionId

                          return (
                            <div
                              className={isSessionActive ? 'flex h-full min-h-0 flex-1' : 'hidden'}
                              key={session.id}
                            >
                              <TerminalPane
                                ref={(instance) => {
                                  terminalRefs.current[session.id] = instance
                                }}
                                isActive={isSessionActive}
                                onRequestClose={() => handleCloseSession(session.id)}
                                selectedLaunchTarget={session.type}
                                workspacePath={workspace.path}
                              />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[var(--cli-bg-deep)] px-6 text-center">
                    <div className="max-w-sm border-l border-[var(--cli-border)] pl-4 text-left text-[0.78rem] leading-6 text-[var(--cli-text-muted)]">
                      <span className="text-[var(--cli-accent)]">$</span>{' '}
                      {t('project.emptySessions')}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {isAssistantSidebarOpen ? (
              <div className="hidden w-px shrink-0 self-stretch bg-white/[0.06] xl:block" />
            ) : null}

            {isAssistantSidebarOpen ? (
              <ChatGPTSidebar
                key={assistantSidebarProvider}
                onClose={onCloseAssistantSidebar}
                provider={assistantSidebarProvider}
              />
            ) : null}
          </div>
        </div>
      </div>
    </main>
  )
}

function getAssistantSidebarLabel(provider: AssistantSidebarProvider) {
  return provider === 'claude' ? 'Claude' : 'ChatGPT'
}

function createEmptyCliToolStatusMap(): CliToolStatusMap {
  return {
    cliApp: null,
    claude: null,
  }
}

function resolveAvailableCliTarget(
  currentTarget: CliLaunchTarget,
  statuses: CliToolStatusMap,
): CliLaunchTarget {
  if (statuses[currentTarget]?.isInstalled) {
    return currentTarget
  }

  if (statuses.cliApp?.isInstalled) {
    return 'cliApp'
  }

  if (statuses.claude?.isInstalled) {
    return 'claude'
  }

  return currentTarget
}

function getCliLaunchTargetUnavailableMessage(target: CliLaunchTarget, t: TFunction) {
  return target === 'cliApp'
    ? t('project.cliUnavailable.cliApp')
    : t('project.cliUnavailable.claude')
}

function getCliLaunchTargetPendingMessage(target: CliLaunchTarget, t: TFunction) {
  return t('project.checkingCli', { label: getCliLaunchTargetLabel(target) })
}

function getCliLaunchTargetDisabledTitle(
  target: CliLaunchTarget,
  status: CliToolStatus | null,
  t: TFunction,
) {
  return status === null
    ? getCliLaunchTargetPendingMessage(target, t)
    : getCliLaunchTargetUnavailableMessage(target, t)
}

function WorkspaceTopBar({
  activeEditorId,
  assistantSidebarLabel,
  availableEditors,
  cliToolStatuses,
  isAssistantSidebarOpen,
  onBack,
  onLaunchEditor,
  onSelectEditor,
  onSelectCliTarget,
  onStartCliSession,
  onToggleAssistantSidebar,
  onUpdateWorkspace,
  selectedCliTarget,
  selectedEditorId,
  workspace,
}: {
  activeEditorId: WorkspaceEditorId | null
  assistantSidebarLabel: string
  availableEditors: WorkspaceEditorAvailability[]
  cliToolStatuses: CliToolStatusMap
  isAssistantSidebarOpen: boolean
  onBack: () => void
  onLaunchEditor: (editorId: WorkspaceEditorId) => void
  onSelectEditor: (editorId: WorkspaceEditorId) => void
  onSelectCliTarget: (target: CliLaunchTarget) => void
  onStartCliSession: (target: CliLaunchTarget) => void
  onToggleAssistantSidebar: () => void
  onUpdateWorkspace: (workspace: WorkspaceSummary) => void
  selectedCliTarget: CliLaunchTarget
  selectedEditorId: WorkspaceEditorId
  workspace: WorkspaceSummary
}) {
  const { t } = useTranslation()
  const selectedCliStatus = cliToolStatuses[selectedCliTarget]
  const isSelectedCliInstalled = selectedCliStatus?.isInstalled === true
  const selectedCliLabel = getCliLaunchTargetLabel(selectedCliTarget)
  const selectedCliDisabledTitle = getCliLaunchTargetDisabledTitle(
    selectedCliTarget,
    selectedCliStatus,
    t,
  )

  return (
    <div className="flex flex-col gap-1">
      <div className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto_minmax(4rem,1fr)] items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <button
            aria-label={t('project.back')}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent bg-transparent text-[var(--cli-text-muted)] transition hover:border-[var(--cli-border)] hover:bg-white/[0.035] hover:text-[var(--cli-text)]"
            onClick={onBack}
            type="button"
          >
            <ArrowLeftIcon size={12} />
          </button>

          <WindowDragRegion className="min-w-0">
            <div
              className="flex h-7 min-w-0 max-w-[12rem] items-center gap-1.5 rounded-md border border-[var(--cli-border)] bg-[var(--cli-bg-deep)] px-2 text-[0.7rem] font-medium text-[var(--cli-text)]"
              title={workspace.path}
            >
              <FolderIcon
                className="shrink-0 text-[var(--cli-text-muted)]"
                size={13}
                strokeWidth={1.7}
              />
              <span className="min-w-0 truncate">
                {formatWorkspaceShortPath(workspace.path)}
              </span>
            </div>
          </WindowDragRegion>

          <ProjectBranchSelector
            onUpdateWorkspace={onUpdateWorkspace}
            workspace={workspace}
          />
        </div>

        <div className="relative z-30 flex flex-wrap items-center justify-center gap-1">
          <EditorLaunchControls
            activeEditorId={activeEditorId}
            availableEditors={availableEditors}
            compact
            onLaunchEditor={onLaunchEditor}
            onSelectEditor={onSelectEditor}
            selectedEditorId={selectedEditorId}
          />
          <CliTargetSwitch
            onChange={onSelectCliTarget}
            statuses={cliToolStatuses}
            value={selectedCliTarget}
          />
          <HeaderActionButton
            compact
            disabled={!isSelectedCliInstalled}
            icon={<PlayIcon size={14} />}
            label={t('project.launchCli', { label: selectedCliLabel })}
            onClick={() => onStartCliSession(selectedCliTarget)}
            title={
              isSelectedCliInstalled
                ? t('project.launchCli', { label: selectedCliLabel })
                : selectedCliDisabledTitle
            }
            tone="primary"
          />
          <AssistantSidebarButton
            isOpen={isAssistantSidebarOpen}
            label={assistantSidebarLabel}
            onClick={onToggleAssistantSidebar}
          />
        </div>

        <div className="flex min-w-0 items-center justify-end">
          <WindowDragRegion className="hidden h-8 min-w-4 flex-1 sm:block" />
          <WindowControls align="right" />
        </div>
      </div>
    </div>
  )
}

function SessionTab({
  isActive,
  onActivate,
  onClose,
  onRename,
  session,
}: {
  isActive: boolean
  onActivate: () => void
  onClose: () => void
  onRename: (name: string) => void
  session: ProjectSession
}) {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.name ?? '')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

  useEffect(() => {
    setEditValue(session.name ?? '')
  }, [session.name])

  function handleSubmitEdit() {
    setIsEditing(false)
    onRename(editValue)
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmitEdit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
      setEditValue(session.name ?? '')
    }
  }

  function handleDoubleClick() {
    setIsEditing(true)
  }

  const sessionLabel = session.name ?? getCliLaunchTargetLabel(session.type)
  const sessionIconUrl = getSessionIconUrl(session.type)

  return (
    <div
      className={`group relative flex h-7 min-w-[8rem] max-w-[12.5rem] items-center gap-1.5 rounded-md border px-2 text-[0.71rem] transition ${
        isActive
          ? 'border-white/[0.12] bg-white/[0.095] text-[var(--cli-text)] shadow-[0_1px_0_rgba(255,255,255,0.045)_inset]'
          : 'border-transparent bg-transparent text-[var(--cli-text-muted)] hover:border-[var(--cli-border-muted)] hover:bg-white/[0.035] hover:text-[var(--cli-text)]'
      }`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-white/[0.045]">
        <img
          alt=""
          className="h-3.5 w-3.5 object-contain"
          draggable={false}
          src={sessionIconUrl}
        />
      </span>

      <span
        className={`absolute inset-x-2 bottom-0 h-px rounded-full transition ${
          isActive ? 'bg-[var(--cli-accent)]' : 'bg-transparent'
        }`}
      />

      {isEditing ? (
        <input
          className="h-6 min-w-0 flex-1 bg-transparent text-[0.71rem] font-medium text-white outline-none placeholder:text-[var(--cli-text-muted)]"
          onBlur={handleSubmitEdit}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('project.sessionNamePlaceholder')}
          ref={inputRef}
          type="text"
          value={editValue}
        />
      ) : (
        <button
          className="min-w-0 flex-1 truncate text-left font-medium"
          onClick={onActivate}
          onDoubleClick={handleDoubleClick}
          title={sessionLabel}
          type="button"
        >
          {sessionLabel}
        </button>
      )}

      <button
        aria-label={t('project.sessionClose', { label: sessionLabel })}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-transparent transition ${
          isActive
            ? 'text-[var(--cli-text-muted)] hover:border-[var(--cli-border)] hover:bg-white/[0.06] hover:text-[var(--cli-text)]'
            : 'text-slate-700 hover:border-[var(--cli-border-muted)] hover:bg-white/[0.05] hover:text-[var(--cli-text)] group-hover:text-[var(--cli-text-muted)]'
        }`}
        onClick={onClose}
        type="button"
      >
        <CloseIcon size={10} />
      </button>
    </div>
  )
}

function getSessionIconUrl(target: CliLaunchTarget) {
  return target === 'claude' ? claudeIconUrl : chatGptIconUrl
}

function CliTargetSwitch({
  onChange,
  statuses,
  value,
}: {
  onChange: (target: CliLaunchTarget) => void
  statuses: CliToolStatusMap
  value: CliLaunchTarget
}) {
  const { t } = useTranslation()

  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-[var(--cli-border)] bg-[var(--cli-bg-deep)] p-0.5">
      {CLI_LAUNCH_TARGETS.map((target) => {
        const isActive = target === value
        const status = statuses[target]
        const isInstalled = status?.isInstalled === true
        const disabledTitle = getCliLaunchTargetDisabledTitle(target, status, t)

        return (
          <span
            className="inline-flex"
            key={target}
            title={isInstalled ? undefined : disabledTitle}
          >
            <button
              aria-disabled={!isInstalled}
              aria-label={t('project.selectCli', { label: getCliLaunchTargetLabel(target) })}
              aria-pressed={isActive}
              className={`rounded px-1.5 py-1 text-[0.68rem] font-medium transition sm:px-2 ${
                !isInstalled
                  ? 'cursor-not-allowed text-[var(--cli-text-muted)] opacity-60'
                  : isActive
                    ? 'bg-white text-slate-950'
                    : 'text-[var(--cli-text)] hover:bg-white/[0.05] hover:text-white'
              }`}
              disabled={!isInstalled}
              onClick={() => onChange(target)}
              type="button"
            >
              {getCliLaunchTargetLabel(target)}
            </button>
          </span>
        )
      })}
    </div>
  )
}

function HeaderActionButton({
  compact = false,
  disabled = false,
  icon,
  isLoading = false,
  label,
  onClick,
  title,
  tone,
}: {
  compact?: boolean
  disabled?: boolean
  icon: ReactNode
  isLoading?: boolean
  label: string
  onClick: () => void
  title?: string
  tone: 'primary' | 'secondary'
}) {
  const { t } = useTranslation()
  const toneClassName = disabled
    ? 'border-white/[0.04] bg-white/[0.015] text-[var(--cli-text-muted)]'
    : tone === 'primary'
      ? 'border-white bg-white text-slate-950 hover:bg-slate-200'
      : 'border-[var(--cli-border)] bg-[var(--cli-bg-deep)] text-[var(--cli-text)] hover:border-white/[0.1] hover:bg-white/[0.05] hover:text-white'

  const button = (
    <button
      className={`inline-flex items-center justify-center gap-1 rounded-md border font-medium transition disabled:cursor-not-allowed ${
        compact
          ? 'h-7 px-2 text-[0.68rem] sm:px-2.5'
          : 'px-3 py-1.5 text-[0.84rem]'
      } ${toneClassName}`}
      disabled={disabled}
      onClick={onClick}
      title={title ?? label}
      type="button"
    >
      {icon}
      <span className={compact ? 'hidden sm:inline' : ''}>
        {isLoading ? t('common.opening') : label}
      </span>
    </button>
  )

  if (disabled && title) {
    return (
      <span className="inline-flex" title={title}>
        {button}
      </span>
    )
  }

  return button
}

function AssistantSidebarButton({
  isOpen,
  label,
  onClick,
}: {
  isOpen: boolean
  label: string
  onClick: () => void
}) {
  const { t } = useTranslation()

  return (
    <button
      aria-label={t('project.assistantOpen', { label })}
      className={`inline-flex h-7 items-center justify-center gap-1 rounded-md border px-2 text-[0.68rem] font-medium transition sm:px-2.5 ${
        isOpen
          ? 'border-white/[0.14] bg-white/[0.08] text-white'
          : 'border-[var(--cli-border)] bg-[var(--cli-bg-deep)] text-[var(--cli-text)] hover:border-white/[0.1] hover:bg-white/[0.05] hover:text-white'
      }`}
      onClick={onClick}
      title={label}
      type="button"
    >
      <svg
        fill="none"
        height="14"
        viewBox="0 0 24 24"
        width="14"
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
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

const WORKSPACE_EDITOR_OPTIONS: WorkspaceEditorId[] = [
  'vscode',
  'cursor',
  'antigravity',
  'windsurf',
  'zed',
]

function EditorLaunchControls({
  activeEditorId,
  availableEditors,
  compact = false,
  onLaunchEditor,
  onSelectEditor,
  selectedEditorId,
}: {
  activeEditorId: WorkspaceEditorId | null
  availableEditors: WorkspaceEditorAvailability[]
  compact?: boolean
  onLaunchEditor: (editorId: WorkspaceEditorId) => void
  onSelectEditor: (editorId: WorkspaceEditorId) => void
  selectedEditorId: WorkspaceEditorId
}) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const selectedEditor =
    availableEditors.find((editor) => editor.editorId === selectedEditorId) ?? null
  const isSelectedEditorInstalled = selectedEditor?.isInstalled ?? false
  const selectedEditorLabel = getWorkspaceEditorLabel(selectedEditorId)
  const isOpeningSelectedEditor = activeEditorId === selectedEditorId

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div className="relative flex items-center" ref={containerRef}>
      <div className="inline-flex items-center overflow-hidden rounded-md border border-[var(--cli-border)] bg-[var(--cli-bg-deep)]">
        <button
          aria-label={t('project.editor.open', { label: selectedEditorLabel })}
          className={`inline-flex items-center justify-center gap-1.5 font-medium transition ${
            isSelectedEditorInstalled
              ? 'text-[var(--cli-text)] hover:bg-white/[0.035] hover:text-white'
              : 'cursor-not-allowed text-[var(--cli-text-muted)]'
          } ${
            compact
              ? 'h-7 px-2 text-[0.68rem] sm:px-2.5'
              : 'px-3 py-1.5 text-[0.84rem]'
          }`}
          disabled={!isSelectedEditorInstalled}
          onClick={() => onLaunchEditor(selectedEditorId)}
          title={
            isSelectedEditorInstalled
              ? t('project.editor.open', { label: selectedEditorLabel })
              : t('project.editor.unavailable', { label: selectedEditorLabel })
          }
          type="button"
        >
          <CodeIcon size={14} />
          <span className={compact ? 'hidden sm:inline' : ''}>
            {isOpeningSelectedEditor ? t('common.opening') : selectedEditorLabel}
          </span>
        </button>

        <button
          aria-expanded={isOpen}
          aria-label={t('project.editor.select')}
          className={`inline-flex items-center justify-center border-l border-[var(--cli-border)] text-[var(--cli-text-muted)] transition hover:bg-white/[0.035] hover:text-white ${
            compact ? 'h-7 w-7' : 'px-2 py-1.5'
          }`}
          onClick={() => setIsOpen((currentValue) => !currentValue)}
          title={t('project.editor.select')}
          type="button"
        >
          <ChevronDownIcon
            className={`transition ${isOpen ? 'rotate-180' : ''}`}
            size={13}
          />
        </button>
      </div>

      {isOpen ? (
        <div className="absolute right-0 top-[calc(100%+0.45rem)] z-20 w-52 rounded-md border border-[var(--cli-border)] bg-[var(--cli-bg-raised)] p-1.5 shadow-[0_18px_42px_rgba(0,0,0,0.38)]">
          <div className="space-y-0.5">
            {WORKSPACE_EDITOR_OPTIONS.map((editorId) => {
              const editor =
                availableEditors.find((item) => item.editorId === editorId) ?? null
              const isSelected = editorId === selectedEditorId
              const isInstalled = editor?.isInstalled ?? false

              return (
                <button
                  aria-pressed={isSelected}
                  className={`flex h-8 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-[0.78rem] transition ${
                    isInstalled
                      ? isSelected
                        ? 'bg-white/[0.075] text-white'
                        : 'text-[var(--cli-text)] hover:bg-white/[0.045] hover:text-white'
                      : 'cursor-not-allowed text-[var(--cli-text-muted)]'
                  }`}
                  disabled={!isInstalled}
                  key={editorId}
                  onClick={() => {
                    onSelectEditor(editorId)
                    setIsOpen(false)
                  }}
                  type="button"
                >
                  <span className="truncate">{getWorkspaceEditorLabel(editorId)}</span>
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[0.55rem] uppercase tracking-[0.12em] ${
                      isInstalled
                        ? isSelected
                          ? 'border-white/[0.14] bg-white/[0.08] text-slate-200'
                          : 'border-transparent bg-transparent text-[var(--cli-text-muted)]'
                        : 'border-white/[0.05] bg-white/[0.025] text-slate-600'
                    }`}
                  >
                    {isSelected ? t('common.active') : isInstalled ? t('common.ok') : t('common.off')}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function getWorkspaceEditorLabel(editorId: WorkspaceEditorId) {
  switch (editorId) {
    case 'vscode':
      return 'VS Code'
    case 'cursor':
      return 'Cursor'
    case 'antigravity':
      return 'Antigravity'
    case 'windsurf':
      return 'Windsurf'
    case 'zed':
      return 'Zed'
  }
}

function ProjectBranchSelector({
  onUpdateWorkspace,
  workspace,
}: {
  onUpdateWorkspace: (workspace: WorkspaceSummary) => void
  workspace: WorkspaceSummary
}) {
  const { i18n, t } = useTranslation()
  const locale = getResolvedLocale(i18n.resolvedLanguage)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [branches, setBranches] = useState<WorkspaceBranchOption[]>([])
  const [isLoadingBranches, setIsLoadingBranches] = useState(false)
  const [isMutatingBranch, setIsMutatingBranch] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [branchError, setBranchError] = useState<unknown>(null)
  const isGitWorkspace = workspace.gitBranch !== null
  const normalizedQuery = query.trim().toLocaleLowerCase(locale)
  const visibleBranches = branches.filter((branch) => {
    if (!normalizedQuery) {
      return true
    }

    return branch.name.toLocaleLowerCase(locale).includes(normalizedQuery)
  })
  const exactMatch =
    normalizedQuery.length > 0
      ? branches.find((branch) => branch.name.toLocaleLowerCase(locale) === normalizedQuery)
      : null
  const canCreateBranch = normalizedQuery.length > 0 && !exactMatch
  const isBusy = isLoadingBranches || isMutatingBranch
  const branchErrorMessage = branchError ? translateError(branchError, t) : null
  const branchLabel = workspace.gitBranch ?? t('workspace.branch.noGit')

  useEffect(() => {
    setBranches([])
    setBranchError(null)
    setIsLoadingBranches(false)
    setIsMutatingBranch(false)
    setIsOpen(false)
    setQuery('')
  }, [workspace.path])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !isGitWorkspace) {
      return
    }

    inputRef.current?.focus()
    inputRef.current?.select()

    let isCancelled = false

    async function loadBranches() {
      try {
        setBranchError(null)
        setIsLoadingBranches(true)
        const nextBranches = await listWorkspaceBranches(workspace.path)

        if (isCancelled) {
          return
        }

        setBranches(sortBranches(nextBranches, locale))
      } catch (error) {
        if (isCancelled) {
          return
        }

        setBranchError(error)
      } finally {
        if (!isCancelled) {
          setIsLoadingBranches(false)
        }
      }
    }

    void loadBranches()

    return () => {
      isCancelled = true
    }
  }, [isGitWorkspace, isOpen, locale, workspace.path])

  async function handleCheckout(branchName: string, create: boolean) {
    try {
      setBranchError(null)
      setIsMutatingBranch(true)
      const nextWorkspace = await checkoutWorkspaceBranch(
        workspace.path,
        branchName,
        create,
      )
      onUpdateWorkspace(nextWorkspace)
      setIsOpen(false)
      setQuery('')
    } catch (error) {
      setBranchError(error)
    } finally {
      setIsMutatingBranch(false)
    }
  }

  function handleToggleOpen() {
    if (!isGitWorkspace || isMutatingBranch) {
      return
    }

    setQuery('')
    setIsOpen((currentValue) => !currentValue)
  }

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setIsOpen(false)
      return
    }

    if (event.key !== 'Enter' || isBusy) {
      return
    }

    event.preventDefault()

    if (exactMatch && !exactMatch.isCurrent) {
      void handleCheckout(exactMatch.name, false)
      return
    }

    if (canCreateBranch) {
      void handleCheckout(query.trim(), true)
    }
  }

  return (
    <div
      className="relative z-40 min-w-0"
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      ref={containerRef}
    >
      <button
        aria-expanded={isOpen}
        className={`flex h-7 min-w-0 max-w-[12rem] items-center justify-between gap-1.5 rounded-md border px-2 text-left transition ${
          isGitWorkspace
            ? 'border-[var(--cli-border)] bg-[var(--cli-bg-deep)] text-[var(--cli-text)] hover:border-white/[0.1] hover:bg-white/[0.05]'
            : 'cursor-not-allowed border-white/[0.05] bg-transparent text-[var(--cli-text-muted)]'
        }`}
        disabled={!isGitWorkspace || isMutatingBranch}
        onClick={handleToggleOpen}
        title={branchErrorMessage ?? branchLabel}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <GitBranchIcon
            className={
              isGitWorkspace
                ? 'shrink-0 text-[var(--cli-text-muted)]'
                : 'shrink-0 text-slate-600'
            }
            size={13}
          />
          <span className="min-w-0 truncate text-[0.7rem] font-medium leading-5">
            {branchLabel}
          </span>
        </span>
        {isMutatingBranch ? (
          <RefreshCwIcon
            className="shrink-0 animate-spin text-slate-400"
            size={12}
          />
        ) : isGitWorkspace ? (
          <ChevronDownIcon
            className={`shrink-0 text-[var(--cli-text-muted)] transition ${isOpen ? 'rotate-180' : ''}`}
            size={12}
          />
        ) : null}
      </button>

      {isOpen ? (
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-40 w-72 rounded-md border border-[var(--cli-border)] bg-[var(--cli-bg-raised)] p-2 shadow-[0_18px_46px_rgba(0,0,0,0.42)]">
          <label className="relative block">
            <SearchIcon
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--cli-text-muted)]"
              size={13}
            />
            <input
              className="w-full rounded-md border border-[var(--cli-border)] bg-[var(--cli-bg-deep)] py-1.5 pl-8 pr-3 text-[0.76rem] text-[var(--cli-text)] outline-none transition placeholder:text-[var(--cli-text-muted)] focus:border-white/[0.14] focus:bg-[#101011]"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={t('workspace.branch.searchPlaceholder')}
              ref={inputRef}
              type="text"
              value={query}
            />
          </label>

          {branchErrorMessage ? (
            <div className="mt-2 rounded-md border border-rose-300/10 bg-rose-300/[0.06] px-3 py-2 text-[0.76rem] text-rose-200">
              {branchErrorMessage}
            </div>
          ) : null}

          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-0.5">
            {isLoadingBranches ? (
              <div className="flex items-center gap-2 rounded-md px-3 py-2 text-[0.76rem] text-[var(--cli-text-muted)]">
                <RefreshCwIcon className="animate-spin" size={13} />
                {t('workspace.branch.loading')}
              </div>
            ) : null}

            {!isLoadingBranches
              ? visibleBranches.map((branch) => (
                  <button
                    className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-[0.76rem] transition ${
                      branch.isCurrent
                        ? 'cursor-default bg-emerald-400/[0.09] text-emerald-50'
                        : 'text-[var(--cli-text)] hover:bg-white/[0.05]'
                    }`}
                    disabled={branch.isCurrent || isMutatingBranch}
                    key={branch.name}
                    onClick={() => void handleCheckout(branch.name, false)}
                    type="button"
                  >
                    <span className="truncate">{branch.name}</span>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[0.58rem] uppercase tracking-[0.12em] ${
                        branch.isCurrent
                          ? 'border-emerald-300/20 bg-emerald-300/[0.12] text-emerald-100'
                          : 'border-white/[0.06] bg-white/[0.03] text-[var(--cli-text-muted)]'
                      }`}
                    >
                      {branch.isCurrent ? t('common.current') : t('common.local')}
                    </span>
                  </button>
                ))
              : null}

            {!isLoadingBranches && canCreateBranch ? (
              <button
                className="flex w-full items-center justify-between gap-3 rounded-md border border-dashed border-[var(--cli-border)] bg-white/[0.04] px-3 py-1.5 text-left text-[0.76rem] text-[var(--cli-text)] transition hover:bg-white/[0.07]"
                disabled={isMutatingBranch}
                onClick={() => void handleCheckout(query.trim(), true)}
                type="button"
              >
                <span className="truncate">
                  {t('workspace.branch.createAndSwitch')} <span>"{query.trim()}"</span>
                </span>
                <span className="shrink-0 rounded border border-[var(--cli-border)] bg-white/[0.06] px-1.5 py-0.5 text-[0.58rem] uppercase tracking-[0.12em] text-[var(--cli-text)]">
                  {t('common.new')}
                </span>
              </button>
            ) : null}

            {!isLoadingBranches && visibleBranches.length === 0 && !canCreateBranch ? (
              <div className="rounded-md px-3 py-2 text-[0.76rem] text-[var(--cli-text-muted)]">
                {t('workspace.branch.empty')}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function sortBranches(branches: WorkspaceBranchOption[], locale: string) {
  return [...branches].sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) {
      return left.isCurrent ? -1 : 1
    }

    return left.name.localeCompare(right.name, locale)
  })
}

function formatWorkspaceShortPath(path: string) {
  const windowsHomeMatch = path.match(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/)

  if (windowsHomeMatch) {
    return `~${path.slice(windowsHomeMatch[0].length)}`
  }

  const normalizedPath = path.replace(/\\/g, '/')
  const unixHomeMatch = normalizedPath.match(/^\/(?:home|Users)\/[^/]+(?=\/|$)/)

  if (unixHomeMatch) {
    return `~${normalizedPath.slice(unixHomeMatch[0].length)}`
  }

  return path
}
