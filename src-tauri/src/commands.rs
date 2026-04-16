use tauri::{ipc::Channel, AppHandle, State};

use crate::{
    chatgpt,
    models::{
        AssistantSidebarProvider, ChangePreviewEvent, ChangePreviewSnapshot,
        ChatGptSidebarWindowRequest, CliToolKind, CliToolStatus, CliUsageResult, IpcError,
        RecentWorkspace, TerminalEvent, TerminalLaunchTarget, TerminalSessionSnapshot,
        WorkspaceBranchOption, WorkspaceEditorAvailability, WorkspaceEditorId,
        WorkspaceLaunchTarget, WorkspaceSummary,
    },
    preview::ChangePreviewManager,
    terminal::{self, TerminalManager},
    workspaces,
};

#[tauri::command]
pub fn get_recent_workspaces(app: AppHandle) -> Result<Vec<RecentWorkspace>, IpcError> {
    workspaces::get_recent_workspaces(&app).map_err(IpcError::from_error)
}

#[tauri::command]
pub fn open_workspace(app: AppHandle, path: String) -> Result<WorkspaceSummary, IpcError> {
    workspaces::open_workspace(&app, &path).map_err(IpcError::from_error)
}

#[tauri::command]
pub fn remove_recent_workspace(
    app: AppHandle,
    path: String,
) -> Result<Vec<RecentWorkspace>, IpcError> {
    workspaces::remove_recent_workspace(&app, &path).map_err(IpcError::from_error)
}

#[tauri::command]
pub fn launch_workspace_target(
    path: String,
    target: WorkspaceLaunchTarget,
) -> Result<(), IpcError> {
    workspaces::launch_workspace_target(&path, target).map_err(IpcError::from_error)
}

#[tauri::command]
pub fn list_workspace_editors() -> Vec<WorkspaceEditorAvailability> {
    workspaces::list_workspace_editors()
}

#[tauri::command]
pub fn launch_workspace_editor(
    path: String,
    editor_id: WorkspaceEditorId,
) -> Result<(), IpcError> {
    workspaces::launch_workspace_editor(&path, editor_id).map_err(IpcError::from_error)
}

#[tauri::command]
pub fn list_workspace_branches(path: String) -> Result<Vec<WorkspaceBranchOption>, IpcError> {
    workspaces::list_workspace_branches(&path).map_err(IpcError::from_error)
}

#[tauri::command]
pub fn checkout_workspace_branch(
    path: String,
    branch_name: String,
    create: bool,
) -> Result<WorkspaceSummary, IpcError> {
    workspaces::checkout_workspace_branch(&path, &branch_name, create)
        .map_err(IpcError::from_error)
}

#[tauri::command]
pub fn create_terminal_session(
    manager: State<'_, TerminalManager>,
    preview_manager: State<'_, ChangePreviewManager>,
    workspace_path: String,
    cols: u16,
    rows: u16,
    launch_target: TerminalLaunchTarget,
    on_event: Channel<TerminalEvent>,
) -> Result<TerminalSessionSnapshot, IpcError> {
    let prepared_preview_session = preview_manager
        .prepare_session(&workspace_path)
        .map_err(IpcError::from_error)?;
    let snapshot = manager
        .create_session(workspace_path, cols, rows, launch_target, on_event)
        .map_err(IpcError::from_error)?;

    preview_manager
        .register_session(snapshot.id, prepared_preview_session)
        .map_err(IpcError::from_error)?;

    Ok(snapshot)
}

#[tauri::command]
pub fn write_terminal_input(
    manager: State<'_, TerminalManager>,
    session_id: u64,
    input: String,
) -> Result<(), IpcError> {
    manager
        .write_input(session_id, &input)
        .map_err(IpcError::from_error)
}

#[tauri::command]
pub fn resize_terminal_session(
    manager: State<'_, TerminalManager>,
    session_id: u64,
    cols: u16,
    rows: u16,
) -> Result<(), IpcError> {
    manager
        .resize_session(session_id, cols, rows)
        .map_err(IpcError::from_error)
}

#[tauri::command]
pub fn close_terminal_session(
    manager: State<'_, TerminalManager>,
    preview_manager: State<'_, ChangePreviewManager>,
    session_id: u64,
) -> Result<(), IpcError> {
    preview_manager
        .unregister_session(session_id)
        .map_err(IpcError::from_error)?;

    manager.close_session(session_id).map_err(IpcError::from_error)
}

#[tauri::command]
pub fn list_terminal_sessions(
    manager: State<'_, TerminalManager>,
) -> Result<Vec<TerminalSessionSnapshot>, IpcError> {
    manager.list_sessions().map_err(IpcError::from_error)
}

#[tauri::command]
pub fn start_change_preview(
    preview_manager: State<'_, ChangePreviewManager>,
    session_id: u64,
    on_event: Channel<ChangePreviewEvent>,
) -> Result<ChangePreviewSnapshot, IpcError> {
    preview_manager
        .start_preview(session_id, on_event)
        .map_err(IpcError::from_error)
}

#[tauri::command]
pub fn stop_change_preview(
    preview_manager: State<'_, ChangePreviewManager>,
    session_id: u64,
) -> Result<(), IpcError> {
    preview_manager
        .stop_preview(session_id)
        .map_err(IpcError::from_error)
}

#[tauri::command]
pub fn get_change_preview_snapshot(
    preview_manager: State<'_, ChangePreviewManager>,
    session_id: u64,
) -> Result<ChangePreviewSnapshot, IpcError> {
    preview_manager.snapshot(session_id).map_err(IpcError::from_error)
}

#[tauri::command]
pub fn get_cli_tool_status(launch_target: TerminalLaunchTarget) -> CliToolStatus {
    TerminalManager::cli_tool_status(launch_target)
}

#[tauri::command]
pub fn get_cli_usage(tool: CliToolKind) -> CliUsageResult {
    terminal::fetch_cli_usage(&tool)
}

#[tauri::command]
pub fn open_chatgpt_sidebar_window(
    app: AppHandle,
    request: ChatGptSidebarWindowRequest,
) -> Result<(), IpcError> {
    chatgpt::open_sidebar_window(&app, request).map_err(IpcError::from_message)
}

#[tauri::command]
pub fn sync_chatgpt_sidebar_window(
    app: AppHandle,
    request: ChatGptSidebarWindowRequest,
) -> Result<(), IpcError> {
    chatgpt::sync_sidebar_window(&app, request).map_err(IpcError::from_message)
}

#[tauri::command]
pub fn close_chatgpt_sidebar_window(
    app: AppHandle,
    parent_window_label: String,
    provider: AssistantSidebarProvider,
) -> Result<(), IpcError> {
    chatgpt::close_sidebar_window(&app, parent_window_label, provider)
        .map_err(IpcError::from_message)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), IpcError> {
    chatgpt::open_external_url(&url).map_err(IpcError::from_message)
}
