import { open } from '@tauri-apps/plugin-dialog'

import { invokeCommand } from '../../shared/lib/tauri'
import type {
  WorkspaceEditorAvailability,
  WorkspaceEditorId,
  RecentWorkspace,
  WorkspaceBranchOption,
  WorkspaceLaunchTarget,
  WorkspaceSummary,
} from './types'

export async function pickWorkspaceDirectory(title: string) {
  const selectedPath = await open({
    title,
    directory: true,
    multiple: false,
  })

  if (Array.isArray(selectedPath)) {
    return selectedPath[0] ?? null
  }

  return selectedPath
}

export async function getRecentWorkspaces() {
  return invokeCommand<RecentWorkspace[]>('get_recent_workspaces')
}

export async function openWorkspace(path: string) {
  return invokeCommand<WorkspaceSummary>('open_workspace', { path })
}

export async function listWorkspaceBranches(path: string) {
  return invokeCommand<WorkspaceBranchOption[]>('list_workspace_branches', { path })
}

export async function checkoutWorkspaceBranch(
  path: string,
  branchName: string,
  create: boolean,
) {
  return invokeCommand<WorkspaceSummary>('checkout_workspace_branch', {
    path,
    branchName,
    create,
  })
}

export async function removeRecentWorkspace(path: string) {
  return invokeCommand<RecentWorkspace[]>('remove_recent_workspace', { path })
}

export async function listWorkspaceEditors() {
  return invokeCommand<WorkspaceEditorAvailability[]>('list_workspace_editors')
}

export async function launchWorkspaceTarget(
  path: string,
  target: WorkspaceLaunchTarget,
) {
  return invokeCommand<void>('launch_workspace_target', { path, target })
}

export async function launchWorkspaceEditor(
  path: string,
  editorId: WorkspaceEditorId,
) {
  return invokeCommand<void>('launch_workspace_editor', { path, editorId })
}
