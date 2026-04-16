import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getRecentWorkspaces,
  launchWorkspaceEditor,
  listWorkspaceEditors,
  openWorkspace,
  pickWorkspaceDirectory,
  removeRecentWorkspace,
} from '../features/workspaces/api'
import { ProjectScreen } from '../features/project/components/ProjectScreen'
import { WorkspaceHomeScreen } from '../features/workspaces/components/WorkspaceHomeScreen'
import { WorkspaceSidebar } from '../features/workspaces/components/WorkspaceSidebar'
import { translateError } from '../shared/i18n'
import { WindowChrome } from '../shared/ui/WindowChrome'
import type {
  RecentWorkspace,
  WorkspaceEditorAvailability,
  WorkspaceEditorId,
  WorkspaceSummary,
} from '../features/workspaces/types'

const FAVORITES_STORAGE_KEY = 'openbanjo.favorite-workspaces'
const PREFERRED_EDITOR_STORAGE_KEY = 'openbanjo.preferred-workspace-editor'

export function App() {
  const { t } = useTranslation()
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([])
  const [openWorkspaces, setOpenWorkspaces] = useState<WorkspaceSummary[]>([])
  const [activeWorkspacePath, setActiveWorkspacePath] = useState<string | null>(null)
  const [favoritePaths, setFavoritePaths] = useState<string[]>(readFavoritePaths)
  const [isWorkspaceSidebarPinned, setIsWorkspaceSidebarPinned] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false)
  const [assistantSidebarOpen, setAssistantSidebarOpen] = useState(false)
  const [preferredEditorId, setPreferredEditorId] =
    useState<WorkspaceEditorId>(readPreferredEditorId)
  const [workspaceEditors, setWorkspaceEditors] = useState<WorkspaceEditorAvailability[]>([])

  const activeWorkspace =
    openWorkspaces.find((workspace) => workspace.path === activeWorkspacePath) ?? null

  useEffect(() => {
    void refreshRecents()
    void refreshWorkspaceEditors()
  }, [])

  useEffect(() => {
    window.localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify(favoritePaths),
    )
  }, [favoritePaths])

  useEffect(() => {
    window.localStorage.setItem(PREFERRED_EDITOR_STORAGE_KEY, preferredEditorId)
  }, [preferredEditorId])

  useEffect(() => {
    setFavoritePaths((currentPaths) =>
      currentPaths.filter((path) =>
        recentWorkspaces.some((workspace) => workspace.path === path),
      ),
    )
  }, [recentWorkspaces])

  useEffect(() => {
    if (!activeWorkspace) {
      setAssistantSidebarOpen(false)
    }
  }, [activeWorkspace])

  async function refreshRecents() {
    try {
      setIsLoading(true)
      setRecentWorkspaces(await getRecentWorkspaces())
    } catch (loadError) {
      setError(loadError)
    } finally {
      setIsLoading(false)
    }
  }

  async function refreshWorkspaceEditors() {
    try {
      setWorkspaceEditors(await listWorkspaceEditors())
    } catch (loadError) {
      setError(loadError)
    }
  }

  async function handlePickWorkspace() {
    try {
      setIsPickingWorkspace(true)
      setError(null)

      const selectedPath = await pickWorkspaceDirectory(t('workspace.dialogTitle'))

      if (!selectedPath) {
        return
      }

      const workspace = await openWorkspace(selectedPath)
      upsertOpenWorkspace(workspace)
      setRecentWorkspaces(await getRecentWorkspaces())
    } catch (pickError) {
      setError(pickError)
    } finally {
      setIsPickingWorkspace(false)
    }
  }

  async function handleOpenRecent(path: string) {
    try {
      setError(null)
      const workspace = await openWorkspace(path)
      upsertOpenWorkspace(workspace)
      setRecentWorkspaces(await getRecentWorkspaces())
    } catch (openError) {
      setError(openError)
    }
  }

  async function handleRemoveRecent(path: string) {
    try {
      setError(null)
      setRecentWorkspaces(await removeRecentWorkspace(path))
      setFavoritePaths((currentPaths) =>
        currentPaths.filter((currentPath) => currentPath !== path),
      )

      setOpenWorkspaces((currentWorkspaces) =>
        currentWorkspaces.filter((workspace) => workspace.path !== path),
      )
      setActiveWorkspacePath((currentPath) => (currentPath === path ? null : currentPath))
    } catch (removeError) {
      setError(removeError)
    }
  }

  function upsertOpenWorkspace(workspace: WorkspaceSummary) {
    setOpenWorkspaces((currentWorkspaces) => {
      const nextWorkspaces = currentWorkspaces.filter(
        (currentWorkspace) => currentWorkspace.path !== workspace.path,
      )

      return [...nextWorkspaces, workspace]
    })
    setActiveWorkspacePath(workspace.path)
  }

  function handleToggleFavorite(path: string) {
    setFavoritePaths((currentPaths) =>
      currentPaths.includes(path)
        ? currentPaths.filter((currentPath) => currentPath !== path)
        : [path, ...currentPaths],
    )
  }

  async function handleLaunchWorkspaceEditor(editorId: WorkspaceEditorId) {
    if (!activeWorkspace) {
      return
    }

    setError(null)
    await launchWorkspaceEditor(activeWorkspace.path, editorId)
  }

  function handleOpenAssistantSidebar() {
    if (!activeWorkspace) {
      return
    }

    setAssistantSidebarOpen(true)
  }

  function handleCloseAssistantSidebar() {
    setAssistantSidebarOpen(false)
  }

  function handleToggleAssistantSidebar() {
    if (assistantSidebarOpen) {
      handleCloseAssistantSidebar()
      return
    }

    handleOpenAssistantSidebar()
  }

  function handleUpdateWorkspace(workspace: WorkspaceSummary) {
    upsertOpenWorkspace(workspace)
  }

  const translatedError = error === null ? null : translateError(error, t)

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#050505] text-slate-100">
      <WindowChrome />

      <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
        <WorkspaceSidebar
          activeWorkspacePath={activeWorkspacePath}
          favoritePaths={favoritePaths}
          isLoading={isLoading}
          isPickingWorkspace={isPickingWorkspace}
          isPinned={isWorkspaceSidebarPinned}
          recentWorkspaces={recentWorkspaces}
          onOpenRecent={handleOpenRecent}
          onPickWorkspace={handlePickWorkspace}
          onRemoveRecent={handleRemoveRecent}
          onShowHome={() => setActiveWorkspacePath(null)}
          onTogglePinned={() => setIsWorkspaceSidebarPinned((currentValue) => !currentValue)}
          onToggleFavorite={handleToggleFavorite}
        />

        <section className="relative z-0 min-w-0 flex min-h-0 flex-1 flex-col overflow-hidden bg-[#070707] lg:border-l lg:border-white/[0.06]">
          {activeWorkspace ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              {openWorkspaces.map((workspace) => {
                const isActive = workspace.path === activeWorkspacePath

                return (
                  <div
                    className={
                      isActive
                        ? 'flex h-full min-h-0 min-w-0 flex-1 overflow-hidden'
                        : 'hidden'
                    }
                    key={workspace.path}
                  >
                    <ProjectScreen
                      availableEditors={workspaceEditors}
                      error={isActive ? translatedError : null}
                      isActive={isActive}
                      isAssistantSidebarOpen={isActive && assistantSidebarOpen}
                      onBack={() => setActiveWorkspacePath(null)}
                      onCloseAssistantSidebar={handleCloseAssistantSidebar}
                      onLaunchWorkspaceEditor={handleLaunchWorkspaceEditor}
                      onSelectEditor={setPreferredEditorId}
                      onToggleAssistantSidebar={handleToggleAssistantSidebar}
                      onUpdateWorkspace={handleUpdateWorkspace}
                      selectedEditorId={preferredEditorId}
                      workspace={workspace}
                    />
                  </div>
                )
              })}
            </div>
          ) : (
            <WorkspaceHomeScreen
              error={translatedError}
              isLoading={isLoading}
              recentWorkspaces={recentWorkspaces}
              onOpenRecent={handleOpenRecent}
            />
          )}
        </section>
      </div>
    </div>
  )
}

function readFavoritePaths() {
  try {
    const rawValue = window.localStorage.getItem(FAVORITES_STORAGE_KEY)

    if (!rawValue) {
      return []
    }

    const parsedValue = JSON.parse(rawValue)
    return Array.isArray(parsedValue)
      ? parsedValue.filter((value): value is string => typeof value === 'string')
      : []
  } catch {
    return []
  }
}

function readPreferredEditorId(): WorkspaceEditorId {
  const validEditorIds: WorkspaceEditorId[] = [
    'vscode',
    'cursor',
    'antigravity',
    'windsurf',
    'zed',
  ]

  try {
    const rawValue = window.localStorage.getItem(PREFERRED_EDITOR_STORAGE_KEY)

    if (rawValue && validEditorIds.includes(rawValue as WorkspaceEditorId)) {
      return rawValue as WorkspaceEditorId
    }
  } catch {
    return 'vscode'
  }

  return 'vscode'
}
