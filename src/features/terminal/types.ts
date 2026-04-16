export type TerminalStream = 'stdout'

export type TerminalSessionStatus = 'running' | 'exited' | 'failed'
export type TerminalLifecycleStatus = 'starting' | 'running' | 'error' | 'closed'
export type TerminalLaunchTarget = 'shell' | 'cliApp' | 'claude'
export type CliLaunchTarget = Exclude<TerminalLaunchTarget, 'shell'>

export const CLI_LAUNCH_TARGETS = ['cliApp', 'claude'] as const satisfies readonly CliLaunchTarget[]

export function getCliLaunchTargetLabel(target: CliLaunchTarget) {
  switch (target) {
    case 'claude':
      return 'Claude'
    case 'cliApp':
      return 'Codex'
  }
}

export function isCliLaunchTarget(
  target: TerminalLaunchTarget | null | undefined,
): target is CliLaunchTarget {
  return target === 'cliApp' || target === 'claude'
}

export interface TerminalSessionSnapshot {
  id: number
  workspacePath: string
  shell: string
  launchTarget: TerminalLaunchTarget
  cols: number
  rows: number
  pid: number | null
  status: TerminalSessionStatus
  createdAt: number
  exitedAt: number | null
}

export interface TerminalExitInfo {
  exitCode: number
  signal: string | null
}

export interface CliToolStatus {
  target: CliLaunchTarget
  isInstalled: boolean
  executablePath: string | null
  version: string | null
  error: string | null
}

export type CliToolKind = 'claude' | 'codex'

export interface CliUsageResult {
  tool: CliToolKind
  output: string
  success: boolean
  error: string | null
}

export type ChangePreviewFileStatus = 'added' | 'modified' | 'deleted'
export type DiffLineKind = 'context' | 'add' | 'delete'

export interface DiffLine {
  kind: DiffLineKind
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface ChangePreviewFile {
  path: string
  status: ChangePreviewFileStatus
  additions: number
  deletions: number
  isBinary: boolean
  isTooLarge: boolean
  diff: DiffHunk[]
}

export interface ChangePreviewSnapshot {
  sessionId: number
  workspacePath: string
  files: ChangePreviewFile[]
  updatedAt: number
  error: string | null
}

export type ChangePreviewEvent =
  | {
      event: 'snapshot'
      data: ChangePreviewSnapshot
    }
  | {
      event: 'error'
      data: {
        sessionId: number
        message: string
      }
    }

export type TerminalEvent =
  | {
      event: 'output'
      data: {
        sessionId: number
        stream: TerminalStream
        payload: string
      }
    }
  | {
      event: 'error'
      data: {
        sessionId: number
        message: string
      }
    }
  | {
      event: 'exit'
      data: {
        sessionId: number
        exitCode: number
        signal: string | null
      }
    }
