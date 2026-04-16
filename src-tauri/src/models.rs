use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    pub code: String,
    pub params: BTreeMap<String, String>,
    pub fallback: String,
}

impl IpcError {
    pub fn from_error(error: impl std::fmt::Display) -> Self {
        Self::from_message(error.to_string())
    }

    pub fn from_message(message: String) -> Self {
        let mut params = BTreeMap::new();

        if message == "Informe um nome de branch valido" {
            return Self::new("branchNameRequired", params, message);
        }

        if message == "target de CLI invalido" {
            return Self::new("cliInvalidTarget", params, message);
        }

        if message == "PATH nao disponivel" {
            return Self::new("pathUnavailable", params, message);
        }

        if message == "Only http(s) URLs can be opened externally." {
            return Self::new("invalidExternalUrl", params, message);
        }

        if message
            == "Nenhum terminal compativel encontrado para abrir o workspace externamente"
        {
            return Self::new("externalTerminalMissing", params, message);
        }

        if let Some(path) = message.strip_prefix("directory does not exist: ") {
            params.insert("path".to_string(), path.to_string());
            return Self::new("directoryMissing", params, message);
        }

        if let Some(path) = message.strip_prefix("path is not a directory: ") {
            params.insert("path".to_string(), path.to_string());
            return Self::new("pathNotDirectory", params, message);
        }

        if let Some(path) = message.strip_prefix("workspace does not exist: ") {
            params.insert("path".to_string(), path.to_string());
            return Self::new("workspaceMissing", params, message);
        }

        if let Some(path) = message.strip_prefix("workspace path is not a directory: ") {
            params.insert("path".to_string(), path.to_string());
            return Self::new("workspaceNotDirectory", params, message);
        }

        if let Some(command) = message.strip_prefix("Executavel nao encontrado: ") {
            params.insert("command".to_string(), command.to_string());
            return Self::new("executableNotFound", params, message);
        }

        if let Some(command) = message.strip_prefix("Git nao retornou dados para ") {
            params.insert("command".to_string(), command.to_string());
            return Self::new("gitEmptyOutput", params, message);
        }

        Self::new("commandFailed", command_failed_params(&message), message)
    }

    fn new(code: &str, params: BTreeMap<String, String>, fallback: String) -> Self {
        Self {
            code: code.to_string(),
            params,
            fallback,
        }
    }
}

fn command_failed_params(message: &str) -> BTreeMap<String, String> {
    let mut params = BTreeMap::new();
    params.insert("command".to_string(), "Command".to_string());
    params.insert("detail".to_string(), message.to_string());
    params
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub path: String,
    pub name: String,
    pub git_branch: Option<String>,
    pub git_commit_short: Option<String>,
    pub last_commit_subject: Option<String>,
    pub last_commit_timestamp: Option<u64>,
    pub detected_stack: Vec<String>,
    pub project_status_label: String,
    pub project_status_details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentWorkspace {
    pub path: String,
    pub name: String,
    pub last_opened_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceLaunchTarget {
    Terminal,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceEditorId {
    Vscode,
    Cursor,
    Antigravity,
    Windsurf,
    Zed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEditorAvailability {
    pub editor_id: WorkspaceEditorId,
    pub is_installed: bool,
    pub executable_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBranchOption {
    pub name: String,
    pub is_current: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalSessionStatus {
    Running,
    Exited,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalLaunchTarget {
    Shell,
    #[serde(alias = "cli-app")]
    CliApp,
    Claude,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionSnapshot {
    pub id: u64,
    pub workspace_path: String,
    pub shell: String,
    pub launch_target: TerminalLaunchTarget,
    pub cols: u16,
    pub rows: u16,
    pub pid: Option<u32>,
    pub status: TerminalSessionStatus,
    pub created_at: u64,
    pub exited_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalStream {
    Stdout,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputEvent {
    pub session_id: u64,
    pub stream: TerminalStream,
    pub payload: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalErrorEvent {
    pub session_id: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub session_id: u64,
    pub exit_code: u32,
    pub signal: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum TerminalEvent {
    Output(TerminalOutputEvent),
    Error(TerminalErrorEvent),
    Exit(TerminalExitEvent),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliToolStatus {
    pub target: TerminalLaunchTarget,
    pub is_installed: bool,
    pub executable_path: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CliToolKind {
    Claude,
    Codex,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssistantSidebarProvider {
    Chatgpt,
    Claude,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliUsageResult {
    pub tool: CliToolKind,
    pub output: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangePreviewFileStatus {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffLineKind {
    Context,
    Add,
    Delete,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub text: String,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePreviewFile {
    pub path: String,
    pub status: ChangePreviewFileStatus,
    pub additions: u32,
    pub deletions: u32,
    pub is_binary: bool,
    pub is_too_large: bool,
    pub diff: Vec<DiffHunk>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePreviewSnapshot {
    pub session_id: u64,
    pub workspace_path: String,
    pub files: Vec<ChangePreviewFile>,
    pub updated_at: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePreviewErrorEvent {
    pub session_id: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum ChangePreviewEvent {
    Snapshot(ChangePreviewSnapshot),
    Error(ChangePreviewErrorEvent),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptSidebarWindowRequest {
    pub provider: AssistantSidebarProvider,
    pub parent_window_label: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
