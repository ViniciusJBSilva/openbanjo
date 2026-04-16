import { invokeCommand } from '../../shared/lib/tauri'

export type AssistantSidebarProvider = 'chatgpt' | 'claude'

export interface ChatGPTSidebarWindowRequest {
  provider: AssistantSidebarProvider
  parentWindowLabel: string
  x: number
  y: number
  width: number
  height: number
}

export function openChatGPTSidebarWindow(request: ChatGPTSidebarWindowRequest) {
  return invokeCommand<void>('open_chatgpt_sidebar_window', { request })
}

export function syncChatGPTSidebarWindow(request: ChatGPTSidebarWindowRequest) {
  return invokeCommand<void>('sync_chatgpt_sidebar_window', { request })
}

export function closeChatGPTSidebarWindow(
  parentWindowLabel: string,
  provider: AssistantSidebarProvider,
) {
  return invokeCommand<void>('close_chatgpt_sidebar_window', {
    parentWindowLabel,
    provider,
  })
}

export function openAssistantSidebarExternalUrl(url: string) {
  return invokeCommand<void>('open_external_url', { url })
}
