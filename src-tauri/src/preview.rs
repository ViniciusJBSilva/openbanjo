use std::{
    collections::{hash_map::DefaultHasher, BTreeSet, HashMap},
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, bail, Context, Result};
use tauri::ipc::Channel;

use crate::models::{
    ChangePreviewErrorEvent, ChangePreviewEvent, ChangePreviewFile, ChangePreviewFileStatus,
    ChangePreviewSnapshot, DiffHunk, DiffLine, DiffLineKind,
};

const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_BASELINE_BYTES: u64 = 25 * 1024 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(700);
const CONTEXT_LINES: usize = 3;

pub struct ChangePreviewManager {
    sessions: Arc<Mutex<HashMap<u64, PreviewSession>>>,
    active_previews: Arc<Mutex<HashMap<u64, Arc<AtomicBool>>>>,
}

impl Default for ChangePreviewManager {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            active_previews: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone)]
pub struct PreparedPreviewSession {
    workspace_path: PathBuf,
    baseline: WorkspaceSnapshot,
}

#[derive(Clone)]
struct PreviewSession {
    workspace_path: PathBuf,
    baseline: WorkspaceSnapshot,
}

type WorkspaceSnapshot = HashMap<String, FileSnapshot>;

#[derive(Clone)]
struct FileSnapshot {
    fingerprint: u64,
    kind: FileSnapshotKind,
}

#[derive(Clone)]
enum FileSnapshotKind {
    Text(Vec<String>),
    Binary,
    TooLarge,
}

impl ChangePreviewManager {
    pub fn prepare_session(&self, raw_workspace_path: &str) -> Result<PreparedPreviewSession> {
        let workspace_path = canonicalize_directory(raw_workspace_path)?;
        let baseline = read_workspace_snapshot(&workspace_path)?;

        Ok(PreparedPreviewSession {
            workspace_path,
            baseline,
        })
    }

    pub fn register_session(
        &self,
        session_id: u64,
        prepared: PreparedPreviewSession,
    ) -> Result<()> {
        self.sessions
            .lock()
            .map_err(|_| anyhow!("change preview session lock poisoned"))?
            .insert(
                session_id,
                PreviewSession {
                    workspace_path: prepared.workspace_path,
                    baseline: prepared.baseline,
                },
            );

        Ok(())
    }

    pub fn unregister_session(&self, session_id: u64) -> Result<()> {
        self.stop_preview(session_id)?;
        self.sessions
            .lock()
            .map_err(|_| anyhow!("change preview session lock poisoned"))?
            .remove(&session_id);

        Ok(())
    }

    pub fn start_preview(
        &self,
        session_id: u64,
        on_event: Channel<ChangePreviewEvent>,
    ) -> Result<ChangePreviewSnapshot> {
        self.stop_preview(session_id)?;

        let preview_session = self.session(session_id)?;
        let initial_snapshot = build_preview_snapshot(session_id, &preview_session)?;
        let is_running = Arc::new(AtomicBool::new(true));

        self.active_previews
            .lock()
            .map_err(|_| anyhow!("change preview worker lock poisoned"))?
            .insert(session_id, Arc::clone(&is_running));

        let initial_signature = snapshot_signature(&initial_snapshot);

        thread::spawn(move || {
            let mut last_signature = initial_signature;

            while is_running.load(Ordering::Relaxed) {
                thread::sleep(POLL_INTERVAL);

                if !is_running.load(Ordering::Relaxed) {
                    break;
                }

                match build_preview_snapshot(session_id, &preview_session) {
                    Ok(snapshot) => {
                        let next_signature = snapshot_signature(&snapshot);

                        if next_signature != last_signature {
                            last_signature = next_signature;
                            let _ = on_event.send(ChangePreviewEvent::Snapshot(snapshot));
                        }
                    }
                    Err(error) => {
                        let _ = on_event.send(ChangePreviewEvent::Error(ChangePreviewErrorEvent {
                            session_id,
                            message: error.to_string(),
                        }));
                    }
                }
            }
        });

        Ok(initial_snapshot)
    }

    pub fn stop_preview(&self, session_id: u64) -> Result<()> {
        if let Some(flag) = self
            .active_previews
            .lock()
            .map_err(|_| anyhow!("change preview worker lock poisoned"))?
            .remove(&session_id)
        {
            flag.store(false, Ordering::Relaxed);
        }

        Ok(())
    }

    pub fn snapshot(&self, session_id: u64) -> Result<ChangePreviewSnapshot> {
        let preview_session = self.session(session_id)?;

        build_preview_snapshot(session_id, &preview_session)
    }

    fn session(&self, session_id: u64) -> Result<PreviewSession> {
        self.sessions
            .lock()
            .map_err(|_| anyhow!("change preview session lock poisoned"))?
            .get(&session_id)
            .cloned()
            .ok_or_else(|| anyhow!("change preview session {session_id} not found"))
    }
}

fn build_preview_snapshot(
    session_id: u64,
    preview_session: &PreviewSession,
) -> Result<ChangePreviewSnapshot> {
    let current = read_workspace_snapshot(&preview_session.workspace_path)?;
    let files = build_preview_files(&preview_session.baseline, &current);

    Ok(ChangePreviewSnapshot {
        session_id,
        workspace_path: preview_session.workspace_path.to_string_lossy().to_string(),
        files,
        updated_at: now_epoch_millis(),
        error: None,
    })
}

fn build_preview_files(
    baseline: &WorkspaceSnapshot,
    current: &WorkspaceSnapshot,
) -> Vec<ChangePreviewFile> {
    let mut paths = BTreeSet::new();
    paths.extend(baseline.keys().cloned());
    paths.extend(current.keys().cloned());

    paths
        .into_iter()
        .filter_map(|path| {
            let previous = baseline.get(&path);
            let next = current.get(&path);

            match (previous, next) {
                (None, Some(next_file)) => Some(build_added_file(path, next_file)),
                (Some(previous_file), None) => Some(build_deleted_file(path, previous_file)),
                (Some(previous_file), Some(next_file))
                    if previous_file.fingerprint != next_file.fingerprint =>
                {
                    Some(build_modified_file(path, previous_file, next_file))
                }
                _ => None,
            }
        })
        .collect()
}

fn build_added_file(path: String, file: &FileSnapshot) -> ChangePreviewFile {
    match &file.kind {
        FileSnapshotKind::Text(lines) => {
            let diff_lines = lines
                .iter()
                .enumerate()
                .map(|(index, text)| DiffLine {
                    kind: DiffLineKind::Add,
                    text: text.clone(),
                    old_line: None,
                    new_line: Some((index + 1) as u32),
                })
                .collect::<Vec<_>>();

            ChangePreviewFile {
                path,
                status: ChangePreviewFileStatus::Added,
                additions: lines.len() as u32,
                deletions: 0,
                is_binary: false,
                is_too_large: false,
                diff: hunk_for_full_file(0, lines.len(), diff_lines),
            }
        }
        FileSnapshotKind::Binary => {
            metadata_only_file(path, ChangePreviewFileStatus::Added, true, false)
        }
        FileSnapshotKind::TooLarge => {
            metadata_only_file(path, ChangePreviewFileStatus::Added, false, true)
        }
    }
}

fn build_deleted_file(path: String, file: &FileSnapshot) -> ChangePreviewFile {
    match &file.kind {
        FileSnapshotKind::Text(lines) => {
            let diff_lines = lines
                .iter()
                .enumerate()
                .map(|(index, text)| DiffLine {
                    kind: DiffLineKind::Delete,
                    text: text.clone(),
                    old_line: Some((index + 1) as u32),
                    new_line: None,
                })
                .collect::<Vec<_>>();

            ChangePreviewFile {
                path,
                status: ChangePreviewFileStatus::Deleted,
                additions: 0,
                deletions: lines.len() as u32,
                is_binary: false,
                is_too_large: false,
                diff: hunk_for_full_file(lines.len(), 0, diff_lines),
            }
        }
        FileSnapshotKind::Binary => {
            metadata_only_file(path, ChangePreviewFileStatus::Deleted, true, false)
        }
        FileSnapshotKind::TooLarge => {
            metadata_only_file(path, ChangePreviewFileStatus::Deleted, false, true)
        }
    }
}

fn build_modified_file(
    path: String,
    previous: &FileSnapshot,
    next: &FileSnapshot,
) -> ChangePreviewFile {
    match (&previous.kind, &next.kind) {
        (FileSnapshotKind::Text(previous_lines), FileSnapshotKind::Text(next_lines)) => {
            let (diff, additions, deletions) = diff_text(previous_lines, next_lines);

            ChangePreviewFile {
                path,
                status: ChangePreviewFileStatus::Modified,
                additions,
                deletions,
                is_binary: false,
                is_too_large: false,
                diff,
            }
        }
        (FileSnapshotKind::TooLarge, _) | (_, FileSnapshotKind::TooLarge) => {
            metadata_only_file(path, ChangePreviewFileStatus::Modified, false, true)
        }
        _ => metadata_only_file(path, ChangePreviewFileStatus::Modified, true, false),
    }
}

fn metadata_only_file(
    path: String,
    status: ChangePreviewFileStatus,
    is_binary: bool,
    is_too_large: bool,
) -> ChangePreviewFile {
    ChangePreviewFile {
        path,
        status,
        additions: 0,
        deletions: 0,
        is_binary,
        is_too_large,
        diff: Vec::new(),
    }
}

fn hunk_for_full_file(old_lines: usize, new_lines: usize, lines: Vec<DiffLine>) -> Vec<DiffHunk> {
    if lines.is_empty() {
        return Vec::new();
    }

    vec![DiffHunk {
        old_start: 1,
        old_lines: old_lines as u32,
        new_start: 1,
        new_lines: new_lines as u32,
        lines,
    }]
}

fn diff_text(previous_lines: &[String], next_lines: &[String]) -> (Vec<DiffHunk>, u32, u32) {
    let mut prefix_len = 0;
    while prefix_len < previous_lines.len()
        && prefix_len < next_lines.len()
        && previous_lines[prefix_len] == next_lines[prefix_len]
    {
        prefix_len += 1;
    }

    let mut suffix_len = 0;
    while suffix_len + prefix_len < previous_lines.len()
        && suffix_len + prefix_len < next_lines.len()
        && previous_lines[previous_lines.len() - 1 - suffix_len]
            == next_lines[next_lines.len() - 1 - suffix_len]
    {
        suffix_len += 1;
    }

    let previous_change_end = previous_lines.len() - suffix_len;
    let next_change_end = next_lines.len() - suffix_len;
    let context_start = prefix_len.saturating_sub(CONTEXT_LINES);
    let previous_context_end = (previous_change_end + CONTEXT_LINES).min(previous_lines.len());
    let next_context_end = (next_change_end + CONTEXT_LINES).min(next_lines.len());
    let mut lines = Vec::new();
    let mut additions = 0;
    let mut deletions = 0;

    for index in context_start..prefix_len {
        lines.push(DiffLine {
            kind: DiffLineKind::Context,
            text: previous_lines[index].clone(),
            old_line: Some((index + 1) as u32),
            new_line: Some((index + 1) as u32),
        });
    }

    for index in prefix_len..previous_change_end {
        deletions += 1;
        lines.push(DiffLine {
            kind: DiffLineKind::Delete,
            text: previous_lines[index].clone(),
            old_line: Some((index + 1) as u32),
            new_line: None,
        });
    }

    for index in prefix_len..next_change_end {
        additions += 1;
        lines.push(DiffLine {
            kind: DiffLineKind::Add,
            text: next_lines[index].clone(),
            old_line: None,
            new_line: Some((index + 1) as u32),
        });
    }

    for offset in 0..(previous_context_end - previous_change_end) {
        let previous_index = previous_change_end + offset;
        let next_index = next_change_end + offset;

        if next_index >= next_context_end {
            break;
        }

        lines.push(DiffLine {
            kind: DiffLineKind::Context,
            text: previous_lines[previous_index].clone(),
            old_line: Some((previous_index + 1) as u32),
            new_line: Some((next_index + 1) as u32),
        });
    }

    if lines.is_empty() {
        return (Vec::new(), 0, 0);
    }

    let old_start = (context_start + 1) as u32;
    let new_start = (context_start + 1) as u32;

    (
        vec![DiffHunk {
            old_start,
            old_lines: (previous_context_end - context_start) as u32,
            new_start,
            new_lines: (next_context_end - context_start) as u32,
            lines,
        }],
        additions,
        deletions,
    )
}

fn read_workspace_snapshot(workspace_path: &Path) -> Result<WorkspaceSnapshot> {
    let mut snapshot = HashMap::new();
    let mut consumed_bytes = 0;

    for relative_path in scan_workspace_files(workspace_path)? {
        let absolute_path = workspace_path.join(&relative_path);
        let metadata = match fs::metadata(&absolute_path) {
            Ok(metadata) if metadata.is_file() => metadata,
            _ => continue,
        };
        let byte_len = metadata.len();
        let relative_key = normalize_relative_path(&relative_path);

        if consumed_bytes + byte_len > MAX_BASELINE_BYTES {
            snapshot.insert(relative_key, too_large_snapshot(&metadata));
            continue;
        }

        consumed_bytes += byte_len;

        if let Ok(file_snapshot) = read_file_snapshot(&absolute_path, &metadata) {
            snapshot.insert(relative_key, file_snapshot);
        }
    }

    Ok(snapshot)
}

fn scan_workspace_files(workspace_path: &Path) -> Result<Vec<PathBuf>> {
    if is_git_repository(workspace_path) {
        return scan_git_files(workspace_path);
    }

    let mut files = Vec::new();
    scan_directory(workspace_path, workspace_path, &mut files)?;
    files.sort();

    Ok(files)
}

fn scan_git_files(workspace_path: &Path) -> Result<Vec<PathBuf>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(workspace_path)
        .args(["ls-files", "-co", "--exclude-standard", "-z"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .context("failed to list workspace files with git")?;

    if !output.status.success() {
        bail!(
            "{}",
            String::from_utf8_lossy(&output.stderr).trim().to_string()
        );
    }

    let mut files = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|segment| !segment.is_empty())
        .map(|segment| PathBuf::from(String::from_utf8_lossy(segment).to_string()))
        .collect::<Vec<_>>();
    files.sort();

    Ok(files)
}

fn scan_directory(root: &Path, current: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
    for entry in
        fs::read_dir(current).with_context(|| format!("failed to read {}", current.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();

        if should_skip_path_segment(&file_name) {
            continue;
        }

        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            scan_directory(root, &path, files)?;
        } else if file_type.is_file() {
            let relative_path = path
                .strip_prefix(root)
                .with_context(|| format!("failed to relativize {}", path.display()))?;
            files.push(relative_path.to_path_buf());
        }
    }

    Ok(())
}

fn read_file_snapshot(path: &Path, metadata: &fs::Metadata) -> Result<FileSnapshot> {
    if metadata.len() > MAX_FILE_BYTES {
        return Ok(too_large_snapshot(metadata));
    }

    let bytes = fs::read(path).with_context(|| format!("failed to read {}", path.display()))?;
    let fingerprint = bytes_fingerprint(&bytes);

    if bytes.contains(&0) {
        return Ok(FileSnapshot {
            fingerprint,
            kind: FileSnapshotKind::Binary,
        });
    }

    match String::from_utf8(bytes) {
        Ok(text) => Ok(FileSnapshot {
            fingerprint,
            kind: FileSnapshotKind::Text(text.lines().map(ToOwned::to_owned).collect()),
        }),
        Err(_) => Ok(FileSnapshot {
            fingerprint,
            kind: FileSnapshotKind::Binary,
        }),
    }
}

fn too_large_snapshot(metadata: &fs::Metadata) -> FileSnapshot {
    let mut hasher = DefaultHasher::new();
    metadata.len().hash(&mut hasher);
    metadata_millis(metadata).hash(&mut hasher);

    FileSnapshot {
        fingerprint: hasher.finish(),
        kind: FileSnapshotKind::TooLarge,
    }
}

fn bytes_fingerprint(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

fn metadata_millis(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn is_git_repository(workspace_path: &Path) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(workspace_path)
        .args(["rev-parse", "--is-inside-work-tree"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn should_skip_path_segment(segment: &str) -> bool {
    matches!(
        segment,
        ".git" | "node_modules" | "dist" | "target" | ".cache"
    )
}

fn normalize_relative_path(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn snapshot_signature(snapshot: &ChangePreviewSnapshot) -> String {
    serde_json::to_string(&snapshot.files).unwrap_or_default()
}

fn canonicalize_directory(raw_path: &str) -> Result<PathBuf> {
    let candidate = PathBuf::from(raw_path);

    if !candidate.exists() {
        bail!("workspace does not exist: {raw_path}");
    }

    if !candidate.is_dir() {
        bail!("workspace path is not a directory: {raw_path}");
    }

    candidate
        .canonicalize()
        .with_context(|| format!("failed to resolve workspace: {raw_path}"))
}

fn now_epoch_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
