use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{bail, Context, Result};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::models::{
    RecentWorkspace, WorkspaceBranchOption, WorkspaceEditorAvailability, WorkspaceEditorId,
    WorkspaceLaunchTarget, WorkspaceSummary,
};

const MAX_RECENT_WORKSPACES: usize = 12;
const STORE_FILE_NAME: &str = "workspaces.json";

pub fn get_recent_workspaces(app: &AppHandle) -> Result<Vec<RecentWorkspace>> {
    let mut items = load_recent_workspaces(app)?;
    items.sort_by(|left, right| right.last_opened_at.cmp(&left.last_opened_at));
    Ok(items)
}

pub fn open_workspace(app: &AppHandle, raw_path: &str) -> Result<WorkspaceSummary> {
    let canonical_path = canonicalize_directory(raw_path)?;
    let workspace = workspace_summary_from_path(&canonical_path);

    let mut items = load_recent_workspaces(app)?;
    items.retain(|item| item.path != workspace.path);
    items.insert(
        0,
        RecentWorkspace {
            path: workspace.path.clone(),
            name: workspace.name.clone(),
            last_opened_at: now_epoch_millis(),
        },
    );
    items.truncate(MAX_RECENT_WORKSPACES);
    save_recent_workspaces(app, &items)?;

    Ok(workspace)
}

pub fn remove_recent_workspace(app: &AppHandle, raw_path: &str) -> Result<Vec<RecentWorkspace>> {
    let candidate = PathBuf::from(raw_path);
    let canonical = candidate
        .canonicalize()
        .unwrap_or(candidate)
        .to_string_lossy()
        .to_string();

    let mut items = load_recent_workspaces(app)?;
    items.retain(|item| item.path != canonical && item.path != raw_path);
    save_recent_workspaces(app, &items)?;

    Ok(items)
}

pub fn launch_workspace_target(raw_path: &str, target: WorkspaceLaunchTarget) -> Result<()> {
    let workspace_path = canonicalize_directory(raw_path)?;

    match target {
        WorkspaceLaunchTarget::Terminal => launch_in_terminal(&workspace_path),
    }
}

pub fn list_workspace_editors() -> Vec<WorkspaceEditorAvailability> {
    supported_workspace_editors()
        .iter()
        .map(|editor| detect_workspace_editor(editor.id, editor.command))
        .collect()
}

pub fn launch_workspace_editor(raw_path: &str, editor_id: WorkspaceEditorId) -> Result<()> {
    let workspace_path = canonicalize_directory(raw_path)?;
    let editors = supported_workspace_editors();
    let editor = editors
        .iter()
        .find(|editor| editor.id == editor_id)
        .context("IDE nao suportada")?;

    let executable_path = resolve_executable_path(editor.command)
        .with_context(|| format!("{} nao esta disponivel no PATH", editor.label))?;

    let path_arg = workspace_path.to_string_lossy().to_string();
    try_spawn(&executable_path, &[path_arg], None)
}

pub fn list_workspace_branches(raw_path: &str) -> Result<Vec<WorkspaceBranchOption>> {
    let workspace_path = canonicalize_directory(raw_path)?;
    let current_branch = git_stdout(&workspace_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let branches = git_stdout_allow_empty(
        &workspace_path,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )?;

    Ok(branches
        .lines()
        .map(str::trim)
        .filter(|branch_name| !branch_name.is_empty())
        .map(|branch_name| WorkspaceBranchOption {
            name: branch_name.to_string(),
            is_current: branch_name == current_branch,
        })
        .collect())
}

pub fn checkout_workspace_branch(
    raw_path: &str,
    raw_branch_name: &str,
    create: bool,
) -> Result<WorkspaceSummary> {
    let workspace_path = canonicalize_directory(raw_path)?;
    let branch_name = raw_branch_name.trim();

    if branch_name.is_empty() {
        bail!("Informe um nome de branch valido");
    }

    if create {
        git_stdout(&workspace_path, &["checkout", "-b", branch_name])?;
    } else {
        git_stdout(&workspace_path, &["checkout", branch_name])?;
    }

    Ok(workspace_summary_from_path(&workspace_path))
}

fn load_recent_workspaces(app: &AppHandle) -> Result<Vec<RecentWorkspace>> {
    let store_path = store_path(app)?;

    if !store_path.exists() {
        return Ok(Vec::new());
    }

    let contents = fs::read_to_string(&store_path)
        .with_context(|| format!("failed to read {}", store_path.display()))?;

    let items: Vec<RecentWorkspace> = serde_json::from_str(&contents)
        .with_context(|| format!("failed to parse {}", store_path.display()))?;

    Ok(items)
}

fn save_recent_workspaces(app: &AppHandle, items: &[RecentWorkspace]) -> Result<()> {
    let store_path = store_path(app)?;
    let payload = serde_json::to_string_pretty(items)?;

    fs::write(&store_path, payload)
        .with_context(|| format!("failed to write {}", store_path.display()))?;

    Ok(())
}

fn store_path(app: &AppHandle) -> Result<PathBuf> {
    let data_dir = app
        .path()
        .app_data_dir()
        .context("failed to resolve app data directory")?;

    fs::create_dir_all(&data_dir)
        .with_context(|| format!("failed to create {}", data_dir.display()))?;

    Ok(data_dir.join(STORE_FILE_NAME))
}

fn canonicalize_directory(raw_path: &str) -> Result<PathBuf> {
    let candidate = PathBuf::from(raw_path);

    if !candidate.exists() {
        bail!("directory does not exist: {raw_path}");
    }

    if !candidate.is_dir() {
        bail!("path is not a directory: {raw_path}");
    }

    candidate
        .canonicalize()
        .with_context(|| format!("failed to resolve directory: {raw_path}"))
}

fn workspace_summary_from_path(path: &Path) -> WorkspaceSummary {
    let name = path
        .file_name()
        .and_then(|segment| segment.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.to_string_lossy().to_string());
    let git_overview = read_git_overview(path);
    let detected_stack = detect_stack(path, git_overview.branch.is_some());
    let (project_status_label, project_status_details) =
        describe_project_status(&detected_stack, git_overview.branch.is_some());

    WorkspaceSummary {
        path: path.to_string_lossy().to_string(),
        name,
        git_branch: git_overview.branch,
        git_commit_short: git_overview.commit_short,
        last_commit_subject: git_overview.last_commit_subject,
        last_commit_timestamp: git_overview.last_commit_timestamp,
        detected_stack,
        project_status_label,
        project_status_details,
    }
}

#[derive(Default)]
struct GitOverview {
    branch: Option<String>,
    commit_short: Option<String>,
    last_commit_subject: Option<String>,
    last_commit_timestamp: Option<u64>,
}

fn read_git_overview(path: &Path) -> GitOverview {
    let branch = git_output(path, &["rev-parse", "--abbrev-ref", "HEAD"]);

    if branch.is_none() {
        return GitOverview::default();
    }

    let commit_short = git_output(path, &["rev-parse", "--short", "HEAD"]);
    let last_commit_subject = git_output(path, &["log", "-1", "--pretty=%s"]);
    let last_commit_timestamp = git_output(path, &["log", "-1", "--pretty=%ct"])
        .and_then(|value| value.parse::<u64>().ok())
        .map(|seconds| seconds * 1000);

    GitOverview {
        branch,
        commit_short,
        last_commit_subject,
        last_commit_timestamp,
    }
}

fn git_output(path: &Path, args: &[&str]) -> Option<String> {
    git_stdout(path, args).ok()
}

fn git_stdout(path: &Path, args: &[&str]) -> Result<String> {
    let value = git_stdout_allow_empty(path, args)?;

    if value.is_empty() {
        bail!("Git nao retornou dados para {}", args.join(" "));
    }

    Ok(value)
}

fn git_stdout_allow_empty(path: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .with_context(|| format!("failed to execute git {}", args.join(" ")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

        if stderr.is_empty() {
            bail!("Falha ao executar git {}", args.join(" "));
        }

        bail!(stderr);
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn detect_stack(path: &Path, has_git: bool) -> Vec<String> {
    let mut labels = Vec::new();
    let package_manifest = read_package_manifest(path);

    if path.join("package.json").exists() {
        push_stack_label(&mut labels, "Node.js");
    }

    if manifest_has_dependency(package_manifest.as_ref(), "react") {
        push_stack_label(&mut labels, "React");
    }

    if manifest_has_dependency(package_manifest.as_ref(), "vite")
        || [
            "vite.config.ts",
            "vite.config.js",
            "vite.config.mjs",
            "vite.config.cjs",
        ]
        .iter()
        .any(|file_name| path.join(file_name).exists())
    {
        push_stack_label(&mut labels, "Vite");
    }

    if manifest_has_dependency(package_manifest.as_ref(), "tailwindcss")
        || [
            "tailwind.config.ts",
            "tailwind.config.js",
            "tailwind.config.mjs",
            "tailwind.config.cjs",
        ]
        .iter()
        .any(|file_name| path.join(file_name).exists())
    {
        push_stack_label(&mut labels, "Tailwind");
    }

    if path.join("tsconfig.json").exists()
        || manifest_has_dependency(package_manifest.as_ref(), "typescript")
    {
        push_stack_label(&mut labels, "TypeScript");
    }

    if path.join("Cargo.toml").exists() || path.join("src-tauri").join("Cargo.toml").exists() {
        push_stack_label(&mut labels, "Rust");
    }

    if path.join("src-tauri").join("tauri.conf.json").exists()
        || path.join("tauri.conf.json").exists()
    {
        push_stack_label(&mut labels, "Tauri");
    }

    if path.join("pyproject.toml").exists() || path.join("requirements.txt").exists() {
        push_stack_label(&mut labels, "Python");
    }

    if path.join("docker-compose.yml").exists()
        || path.join("docker-compose.yaml").exists()
        || path.join("Dockerfile").exists()
    {
        push_stack_label(&mut labels, "Docker");
    }

    if has_git || path.join(".git").exists() {
        push_stack_label(&mut labels, "Git");
    }

    labels.truncate(6);
    labels
}

fn read_package_manifest(path: &Path) -> Option<Value> {
    let manifest_path = path.join("package.json");
    let contents = fs::read_to_string(manifest_path).ok()?;
    serde_json::from_str(&contents).ok()
}

fn manifest_has_dependency(manifest: Option<&Value>, dependency_name: &str) -> bool {
    ["dependencies", "devDependencies", "peerDependencies"]
        .iter()
        .any(|section| {
            manifest
                .and_then(|value| value.get(section))
                .and_then(Value::as_object)
                .map(|dependencies| dependencies.contains_key(dependency_name))
                .unwrap_or(false)
        })
}

fn push_stack_label(labels: &mut Vec<String>, label: &str) {
    if labels.iter().any(|current| current == label) {
        return;
    }

    labels.push(label.to_string());
}

fn describe_project_status(detected_stack: &[String], has_git: bool) -> (String, String) {
    match (detected_stack.is_empty(), has_git) {
        (false, true) => (
            "Ambiente OK".to_string(),
            format!(
                "{} tecnologias detectadas com Git ativo",
                detected_stack.len()
            ),
        ),
        (false, false) => (
            "Estrutura detectada".to_string(),
            format!("{} tecnologias detectadas", detected_stack.len()),
        ),
        (true, true) => (
            "Git pronto".to_string(),
            "Repositorio conectado, mas a stack nao foi reconhecida automaticamente".to_string(),
        ),
        (true, false) => (
            "Pasta conectada".to_string(),
            "Abra o terminal para inspecionar a estrutura do projeto".to_string(),
        ),
    }
}

#[cfg(target_os = "macos")]
fn launch_in_terminal(path: &Path) -> Result<()> {
    let path_arg = path.to_string_lossy().to_string();
    try_spawn(
        "open",
        &["-a".to_string(), "Terminal".to_string(), path_arg],
        None,
    )
}

#[cfg(target_os = "windows")]
fn launch_in_terminal(path: &Path) -> Result<()> {
    try_spawn(
        "cmd",
        &[
            "/C".to_string(),
            "start".to_string(),
            "".to_string(),
            "cmd".to_string(),
        ],
        Some(path),
    )
}

#[cfg(all(unix, not(target_os = "macos")))]
fn launch_in_terminal(path: &Path) -> Result<()> {
    let path_arg = path.to_string_lossy().to_string();
    let candidates = vec![
        ("x-terminal-emulator", Vec::new(), Some(path.to_path_buf())),
        ("gnome-terminal", Vec::new(), Some(path.to_path_buf())),
        ("kgx", Vec::new(), Some(path.to_path_buf())),
        (
            "konsole",
            vec!["--workdir".to_string(), path_arg.clone()],
            None,
        ),
        (
            "wezterm",
            vec!["start".to_string(), "--cwd".to_string(), path_arg.clone()],
            None,
        ),
        (
            "alacritty",
            vec!["--working-directory".to_string(), path_arg],
            None,
        ),
    ];

    for (program, args, current_dir) in candidates {
        if try_spawn(program, &args, current_dir.as_deref()).is_ok() {
            return Ok(());
        }
    }

    bail!("Nenhum terminal compativel encontrado para abrir o workspace externamente")
}

fn try_spawn(program: &str, args: &[String], current_dir: Option<&Path>) -> Result<()> {
    let mut command = Command::new(program);
    command.args(args);
    command.stdin(Stdio::null());
    command.stdout(Stdio::null());
    command.stderr(Stdio::null());

    if let Some(directory) = current_dir {
        command.current_dir(directory);
    }

    command
        .spawn()
        .with_context(|| format!("failed to spawn {program}"))?;

    Ok(())
}

#[derive(Clone, Copy)]
struct WorkspaceEditorDescriptor {
    id: WorkspaceEditorId,
    label: &'static str,
    command: &'static str,
}

fn supported_workspace_editors() -> [WorkspaceEditorDescriptor; 5] {
    [
        WorkspaceEditorDescriptor {
            id: WorkspaceEditorId::Vscode,
            label: "VS Code",
            command: "code",
        },
        WorkspaceEditorDescriptor {
            id: WorkspaceEditorId::Cursor,
            label: "Cursor",
            command: "cursor",
        },
        WorkspaceEditorDescriptor {
            id: WorkspaceEditorId::Antigravity,
            label: "Antigravity",
            command: "antigravity",
        },
        WorkspaceEditorDescriptor {
            id: WorkspaceEditorId::Windsurf,
            label: "Windsurf",
            command: "windsurf",
        },
        WorkspaceEditorDescriptor {
            id: WorkspaceEditorId::Zed,
            label: "Zed",
            command: "zed",
        },
    ]
}

fn detect_workspace_editor(
    editor_id: WorkspaceEditorId,
    command: &str,
) -> WorkspaceEditorAvailability {
    match resolve_executable_path(command) {
        Ok(executable_path) => WorkspaceEditorAvailability {
            editor_id,
            is_installed: true,
            executable_path: Some(executable_path),
            error: None,
        },
        Err(error) => WorkspaceEditorAvailability {
            editor_id,
            is_installed: false,
            executable_path: None,
            error: Some(error.to_string()),
        },
    }
}

fn resolve_executable_path(command: &str) -> Result<String> {
    let path_value = env::var_os("PATH").context("PATH nao disponivel")?;

    for directory in env::split_paths(&path_value) {
        for candidate in executable_candidates(&directory, command) {
            if candidate.is_file() {
                return Ok(candidate.to_string_lossy().to_string());
            }
        }
    }

    bail!("Executavel nao encontrado: {command}")
}

#[cfg(target_os = "windows")]
fn executable_candidates(directory: &Path, command: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let base = directory.join(command);
    candidates.push(base.clone());

    let has_extension = Path::new(command).extension().is_some();
    if has_extension {
        return candidates;
    }

    let pathext = env::var_os("PATHEXT")
        .map(|value| {
            value
                .to_string_lossy()
                .split(';')
                .filter(|segment| !segment.is_empty())
                .map(|segment| segment.trim_start_matches('.').to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| {
            vec![
                "EXE".to_string(),
                "CMD".to_string(),
                "BAT".to_string(),
                "COM".to_string(),
            ]
        });

    for extension in pathext {
        candidates.push(directory.join(format!("{command}.{}", extension.to_lowercase())));
        candidates.push(directory.join(format!("{command}.{}", extension)));
    }

    candidates
}

#[cfg(not(target_os = "windows"))]
fn executable_candidates(directory: &Path, command: &str) -> Vec<PathBuf> {
    vec![directory.join(command)]
}

fn now_epoch_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
