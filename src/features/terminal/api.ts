import { Channel } from '@tauri-apps/api/core'

import { invokeCommand } from '../../shared/lib/tauri'
import type {
  ChangePreviewEvent,
  ChangePreviewSnapshot,
  CliLaunchTarget,
  CliToolKind,
  CliToolStatus,
  CliUsageResult,
  TerminalEvent,
  TerminalLaunchTarget,
  TerminalSessionSnapshot,
} from './types'

interface CreateTerminalSessionInput {
  workspacePath: string
  cols: number
  rows: number
  launchTarget: TerminalLaunchTarget
  onEvent: Channel<TerminalEvent>
}

export async function createTerminalSession({
  workspacePath,
  cols,
  rows,
  launchTarget,
  onEvent,
}: CreateTerminalSessionInput) {
  return invokeCommand<TerminalSessionSnapshot>('create_terminal_session', {
    workspacePath,
    cols,
    rows,
    launchTarget,
    onEvent,
  })
}

export async function writeTerminalInput(sessionId: number, input: string) {
  return invokeCommand<void>('write_terminal_input', { sessionId, input })
}

export async function resizeTerminalSession(
  sessionId: number,
  cols: number,
  rows: number,
) {
  return invokeCommand<void>('resize_terminal_session', {
    sessionId,
    cols,
    rows,
  })
}

export async function closeTerminalSession(sessionId: number) {
  return invokeCommand<void>('close_terminal_session', { sessionId })
}

export async function getCliToolStatus(launchTarget: CliLaunchTarget) {
  return invokeCommand<CliToolStatus>('get_cli_tool_status', { launchTarget })
}

export async function getCliUsage(tool: CliToolKind) {
  return invokeCommand<CliUsageResult>('get_cli_usage', { tool })
}

export async function startChangePreview(
  sessionId: number,
  onEvent: Channel<ChangePreviewEvent>,
) {
  return invokeCommand<ChangePreviewSnapshot>('start_change_preview', {
    sessionId,
    onEvent,
  })
}

export async function stopChangePreview(sessionId: number) {
  return invokeCommand<void>('stop_change_preview', { sessionId })
}

export async function getChangePreviewSnapshot(sessionId: number) {
  return invokeCommand<ChangePreviewSnapshot>('get_change_preview_snapshot', {
    sessionId,
  })
}
