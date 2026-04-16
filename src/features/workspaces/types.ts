export interface WorkspaceSummary {
  path: string
  name: string
  gitBranch: string | null
  gitCommitShort: string | null
  lastCommitSubject: string | null
  lastCommitTimestamp: number | null
  detectedStack: string[]
  projectStatusLabel: string
  projectStatusDetails: string
}

export interface WorkspaceBranchOption {
  name: string
  isCurrent: boolean
}

export interface RecentWorkspace {
  path: string
  name: string
  lastOpenedAt: number
}

export type WorkspaceLaunchTarget = 'terminal'

export type WorkspaceEditorId =
  | 'vscode'
  | 'cursor'
  | 'antigravity'
  | 'windsurf'
  | 'zed'

export interface WorkspaceEditorAvailability {
  editorId: WorkspaceEditorId
  isInstalled: boolean
  executablePath: string | null
  error: string | null
}
