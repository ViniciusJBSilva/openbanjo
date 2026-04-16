use std::{
    collections::HashMap,
    env,
    ffi::OsString,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, bail, Context, Result};
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;

use crate::models::{
    CliToolKind, CliToolStatus, CliUsageResult, TerminalErrorEvent, TerminalEvent,
    TerminalExitEvent, TerminalLaunchTarget, TerminalOutputEvent, TerminalSessionSnapshot,
    TerminalSessionStatus, TerminalStream,
};

pub struct TerminalManager {
    next_session_id: AtomicU64,
    sessions: Arc<Mutex<HashMap<u64, Arc<TerminalSession>>>>,
}

struct TerminalSession {
    snapshot: Mutex<TerminalSessionSnapshot>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

impl Default for TerminalManager {
    fn default() -> Self {
        Self {
            next_session_id: AtomicU64::new(1),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl TerminalManager {
    pub fn create_session(
        &self,
        workspace_path: String,
        cols: u16,
        rows: u16,
        launch_target: TerminalLaunchTarget,
        on_event: Channel<TerminalEvent>,
    ) -> Result<TerminalSessionSnapshot> {
        let workspace_dir = validate_workspace_path(&workspace_path)?;
        let launch_spec = resolve_launch_spec(&launch_target)?;
        let pty_size = normalize_size(cols, rows);
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(pty_size)?;

        let mut command = CommandBuilder::new(&launch_spec.program);
        for arg in &launch_spec.args {
            command.arg(arg);
        }
        command.cwd(workspace_dir.as_os_str());
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

        let child = pair
            .slave
            .spawn_command(command)
            .context("failed to start terminal session")?;
        let killer = child.clone_killer();
        let pid = child.process_id();

        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .context("failed to clone PTY reader")?;
        let writer = pair
            .master
            .take_writer()
            .context("failed to open PTY writer")?;

        let session_id = self.next_session_id.fetch_add(1, Ordering::Relaxed);
        let snapshot = TerminalSessionSnapshot {
            id: session_id,
            workspace_path: workspace_dir.to_string_lossy().to_string(),
            shell: launch_spec.label,
            launch_target,
            cols: pty_size.cols,
            rows: pty_size.rows,
            pid,
            status: TerminalSessionStatus::Running,
            created_at: now_epoch_millis(),
            exited_at: None,
        };

        let session = Arc::new(TerminalSession {
            snapshot: Mutex::new(snapshot.clone()),
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            killer: Mutex::new(killer),
        });

        self.sessions
            .lock()
            .map_err(|_| anyhow!("session manager lock poisoned"))?
            .insert(session_id, Arc::clone(&session));

        spawn_reader_thread(Arc::clone(&session), reader, on_event.clone());
        spawn_wait_thread(session, child, on_event, Arc::clone(&self.sessions));

        Ok(snapshot)
    }

    pub fn write_input(&self, session_id: u64, input: &str) -> Result<()> {
        if input.is_empty() {
            return Ok(());
        }

        let session = self.session(session_id)?;
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| anyhow!("terminal writer lock poisoned"))?;

        writer
            .write_all(input.as_bytes())
            .context("failed to write to terminal")?;
        writer.flush().ok();

        Ok(())
    }

    pub fn resize_session(&self, session_id: u64, cols: u16, rows: u16) -> Result<()> {
        let session = self.session(session_id)?;
        let pty_size = normalize_size(cols, rows);

        session
            .master
            .lock()
            .map_err(|_| anyhow!("terminal PTY lock poisoned"))?
            .resize(pty_size)
            .context("failed to resize terminal")?;

        let mut snapshot = session
            .snapshot
            .lock()
            .map_err(|_| anyhow!("terminal snapshot lock poisoned"))?;
        snapshot.cols = pty_size.cols;
        snapshot.rows = pty_size.rows;

        Ok(())
    }

    pub fn close_session(&self, session_id: u64) -> Result<()> {
        let session = match self
            .sessions
            .lock()
            .map_err(|_| anyhow!("session manager lock poisoned"))?
            .remove(&session_id)
        {
            Some(session) => session,
            None => return Ok(()),
        };

        let is_running = {
            let mut snapshot = session
                .snapshot
                .lock()
                .map_err(|_| anyhow!("terminal snapshot lock poisoned"))?;
            let is_running = matches!(snapshot.status, TerminalSessionStatus::Running);

            if is_running {
                snapshot.status = TerminalSessionStatus::Exited;
                snapshot.exited_at = Some(now_epoch_millis());
            }

            is_running
        };

        if is_running {
            session
                .killer
                .lock()
                .map_err(|_| anyhow!("terminal killer lock poisoned"))?
                .kill()
                .context("failed to terminate terminal")?;
        }

        Ok(())
    }

    pub fn list_sessions(&self) -> Result<Vec<TerminalSessionSnapshot>> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| anyhow!("session manager lock poisoned"))?;

        sessions
            .values()
            .map(|session| {
                session
                    .snapshot
                    .lock()
                    .map(|snapshot| snapshot.clone())
                    .map_err(|_| anyhow!("terminal snapshot lock poisoned"))
            })
            .collect()
    }

    fn session(&self, session_id: u64) -> Result<Arc<TerminalSession>> {
        self.sessions
            .lock()
            .map_err(|_| anyhow!("session manager lock poisoned"))?
            .get(&session_id)
            .cloned()
            .ok_or_else(|| anyhow!("terminal session {session_id} not found"))
    }

    pub fn cli_tool_status(launch_target: TerminalLaunchTarget) -> CliToolStatus {
        let Some(cli_tool) = cli_tool_descriptor(launch_target) else {
            return CliToolStatus {
                target: launch_target,
                is_installed: true,
                executable_path: Some(resolve_shell()),
                version: None,
                error: None,
            };
        };

        match find_executable_in_path(cli_tool.command_name) {
            Some(executable_path) => validate_cli_executable(executable_path, launch_target),
            None => CliToolStatus {
                target: launch_target,
                is_installed: false,
                executable_path: None,
                version: None,
                error: Some(format!(
                    "{} nao foi encontrado no PATH do aplicativo",
                    cli_tool.display_name
                )),
            },
        }
    }
}

struct SessionLaunchSpec {
    program: String,
    label: String,
    args: Vec<String>,
}

#[derive(Clone, Copy)]
struct CliToolDescriptor {
    command_name: &'static str,
    display_name: &'static str,
}

fn spawn_reader_thread(
    session: Arc<TerminalSession>,
    mut reader: Box<dyn Read + Send>,
    on_event: Channel<TerminalEvent>,
) {
    thread::spawn(move || {
        let session_id = snapshot_id(&session);
        let mut buffer = [0_u8; 8192];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(bytes_read) => {
                    send_event(
                        &on_event,
                        TerminalEvent::Output(TerminalOutputEvent {
                            session_id,
                            stream: TerminalStream::Stdout,
                            payload: String::from_utf8_lossy(&buffer[..bytes_read]).to_string(),
                        }),
                    );
                }
                Err(error) => {
                    if !session_is_running(&session) {
                        break;
                    }

                    send_event(
                        &on_event,
                        TerminalEvent::Error(TerminalErrorEvent {
                            session_id,
                            message: format!("PTY read failure: {error}"),
                        }),
                    );
                    break;
                }
            }
        }
    });
}

fn spawn_wait_thread(
    session: Arc<TerminalSession>,
    mut child: Box<dyn Child + Send + Sync>,
    on_event: Channel<TerminalEvent>,
    sessions: Arc<Mutex<HashMap<u64, Arc<TerminalSession>>>>,
) {
    thread::spawn(move || {
        let wait_result = child.wait();
        let session_id = snapshot_id(&session);

        match wait_result {
            Ok(exit_status) => {
                if let Ok(mut snapshot) = session.snapshot.lock() {
                    snapshot.status = TerminalSessionStatus::Exited;
                    snapshot.exited_at = Some(now_epoch_millis());
                }

                send_event(
                    &on_event,
                    TerminalEvent::Exit(TerminalExitEvent {
                        session_id,
                        exit_code: exit_status.exit_code(),
                        signal: exit_status.signal().map(ToOwned::to_owned),
                    }),
                );
            }
            Err(error) => {
                if let Ok(mut snapshot) = session.snapshot.lock() {
                    snapshot.status = TerminalSessionStatus::Failed;
                    snapshot.exited_at = Some(now_epoch_millis());
                }

                send_event(
                    &on_event,
                    TerminalEvent::Error(TerminalErrorEvent {
                        session_id,
                        message: format!("terminal wait failure: {error}"),
                    }),
                );

                send_event(
                    &on_event,
                    TerminalEvent::Exit(TerminalExitEvent {
                        session_id,
                        exit_code: 1,
                        signal: None,
                    }),
                );
            }
        }

        if let Ok(mut active_sessions) = sessions.lock() {
            active_sessions.remove(&session_id);
        }
    });
}

fn snapshot_id(session: &TerminalSession) -> u64 {
    session
        .snapshot
        .lock()
        .map(|snapshot| snapshot.id)
        .unwrap_or_default()
}

fn session_is_running(session: &TerminalSession) -> bool {
    session
        .snapshot
        .lock()
        .map(|snapshot| matches!(snapshot.status, TerminalSessionStatus::Running))
        .unwrap_or(false)
}

fn send_event(channel: &Channel<TerminalEvent>, event: TerminalEvent) {
    let _ = channel.send(event);
}

fn resolve_launch_spec(launch_target: &TerminalLaunchTarget) -> Result<SessionLaunchSpec> {
    match launch_target {
        TerminalLaunchTarget::Shell => {
            let shell = resolve_shell();

            Ok(SessionLaunchSpec {
                program: shell.clone(),
                label: shell,
                args: vec!["-i".to_string()],
            })
        }
        TerminalLaunchTarget::CliApp | TerminalLaunchTarget::Claude => {
            let cli_tool = cli_tool_descriptor(*launch_target)
                .ok_or_else(|| anyhow!("target de CLI invalido"))?;
            let status = TerminalManager::cli_tool_status(*launch_target);

            if !status.is_installed {
                bail!(
                    "{}",
                    status.error.unwrap_or_else(|| {
                        format!(
                            "{} nao esta acessivel no ambiente atual",
                            cli_tool.display_name
                        )
                    })
                );
            }

            let executable_path = status.executable_path.ok_or_else(|| {
                anyhow!(
                    "{} esta instalado, mas o caminho do executavel nao foi resolvido",
                    cli_tool.display_name
                )
            })?;

            Ok(SessionLaunchSpec {
                program: executable_path,
                label: cli_tool.command_name.to_string(),
                args: Vec::new(),
            })
        }
    }
}

fn validate_workspace_path(raw_path: &str) -> Result<PathBuf> {
    let path = PathBuf::from(raw_path);

    if !path.exists() {
        bail!("workspace does not exist: {raw_path}");
    }

    if !path.is_dir() {
        bail!("workspace path is not a directory: {raw_path}");
    }

    path.canonicalize()
        .with_context(|| format!("failed to resolve workspace: {raw_path}"))
}

fn normalize_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.max(20),
        rows: rows.max(6),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn resolve_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "/bin/bash".to_string())
}

fn cli_tool_descriptor(launch_target: TerminalLaunchTarget) -> Option<CliToolDescriptor> {
    match launch_target {
        TerminalLaunchTarget::Shell => None,
        TerminalLaunchTarget::CliApp => Some(CliToolDescriptor {
            command_name: "codex",
            display_name: "Codex",
        }),
        TerminalLaunchTarget::Claude => Some(CliToolDescriptor {
            command_name: "claude",
            display_name: "Claude CLI",
        }),
    }
}

fn validate_cli_executable(
    executable_path: PathBuf,
    launch_target: TerminalLaunchTarget,
) -> CliToolStatus {
    let cli_tool = cli_tool_descriptor(launch_target).expect("CLI descriptor must exist");

    match Command::new(&executable_path).arg("--version").output() {
        Ok(output) if output.status.success() => CliToolStatus {
            target: launch_target,
            is_installed: true,
            executable_path: Some(executable_path.to_string_lossy().to_string()),
            version: parse_version_output(&output.stdout, &output.stderr),
            error: None,
        },
        Ok(output) => CliToolStatus {
            target: launch_target,
            is_installed: false,
            executable_path: Some(executable_path.to_string_lossy().to_string()),
            version: None,
            error: Some(format!(
                "{} foi encontrado, mas `{} --version` falhou com status {}{}",
                cli_tool.display_name,
                cli_tool.command_name,
                output
                    .status
                    .code()
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "desconhecido".to_string()),
                format_command_output_suffix(&output.stdout, &output.stderr),
            )),
        },
        Err(error) => CliToolStatus {
            target: launch_target,
            is_installed: false,
            executable_path: Some(executable_path.to_string_lossy().to_string()),
            version: None,
            error: Some(format!(
                "{} foi encontrado, mas nao pode ser executado: {error}",
                cli_tool.display_name
            )),
        },
    }
}

fn parse_version_output(stdout: &[u8], stderr: &[u8]) -> Option<String> {
    let output = String::from_utf8_lossy(stdout);
    let fallback_output = String::from_utf8_lossy(stderr);

    output
        .lines()
        .chain(fallback_output.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

fn format_command_output_suffix(stdout: &[u8], stderr: &[u8]) -> String {
    let stdout_text = String::from_utf8_lossy(stdout);
    let stderr_text = String::from_utf8_lossy(stderr);
    let message = stdout_text
        .lines()
        .chain(stderr_text.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default();

    if message.is_empty() {
        String::new()
    } else {
        format!(": {message}")
    }
}

fn find_executable_in_path(command_name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;

    for base_path in env::split_paths(&path) {
        let candidate = base_path.join(command_name);

        if is_executable(&candidate) {
            return Some(candidate);
        }

        if cfg!(windows) {
            for extension in windows_path_extensions() {
                let candidate = base_path.join(format!("{command_name}{extension}"));

                if is_executable(&candidate) {
                    return Some(candidate);
                }
            }
        }
    }

    None
}

fn windows_path_extensions() -> Vec<String> {
    env::var_os("PATHEXT")
        .unwrap_or_else(|| OsString::from(".COM;.EXE;.BAT;.CMD"))
        .to_string_lossy()
        .split(';')
        .filter(|extension| !extension.is_empty())
        .map(|extension| extension.to_string())
        .collect()
}

fn is_executable(path: &Path) -> bool {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;

                metadata.permissions().mode() & 0o111 != 0
            }

            #[cfg(not(unix))]
            {
                true
            }
        }
        _ => false,
    }
}

fn now_epoch_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn fetch_cli_usage(tool: &CliToolKind) -> CliUsageResult {
    let (command_name, slash_command, display_name) = match tool {
        CliToolKind::Claude => ("claude", "/usage", "Claude"),
        CliToolKind::Codex => ("codex", "/status", "Codex"),
    };

    let executable = match find_executable_in_path(command_name) {
        Some(p) => p,
        None => {
            return CliUsageResult {
                tool: tool.clone(),
                output: String::new(),
                success: false,
                error: Some(format!("{display_name} not found in PATH")),
            };
        }
    };

    let home_dir = match dirs::home_dir() {
        Some(d) => d,
        None => {
            return CliUsageResult {
                tool: tool.clone(),
                output: String::new(),
                success: false,
                error: Some("Could not resolve home directory".to_string()),
            };
        }
    };

    let pty_size = PtySize {
        cols: 120,
        rows: 40,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pty_system = native_pty_system();
    let pair = match pty_system.openpty(pty_size) {
        Ok(p) => p,
        Err(e) => {
            return CliUsageResult {
                tool: tool.clone(),
                output: String::new(),
                success: false,
                error: Some(format!("Failed to create PTY: {e}")),
            };
        }
    };

    let mut cmd = CommandBuilder::new(&executable);
    cmd.cwd(&home_dir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("CLAUDE_CODE_DISABLE_TELEMETRY", "1");

    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            return CliUsageResult {
                tool: tool.clone(),
                output: String::new(),
                success: false,
                error: Some(format!("Failed to spawn {display_name}: {e}")),
            };
        }
    };
    drop(pair.slave);

    let mut reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => {
            let _ = child.kill();
            return CliUsageResult {
                tool: tool.clone(),
                output: String::new(),
                success: false,
                error: Some(format!("Failed to get PTY reader: {e}")),
            };
        }
    };
    let mut writer = match pair.master.take_writer() {
        Ok(w) => w,
        Err(e) => {
            let _ = child.kill();
            return CliUsageResult {
                tool: tool.clone(),
                output: String::new(),
                success: false,
                error: Some(format!("Failed to get PTY writer: {e}")),
            };
        }
    };

    // Wait for the CLI to initialize and display its welcome/prompt
    let mut initial_output = String::new();
    let init_timeout = std::time::Duration::from_secs(8);
    let start = std::time::Instant::now();

    loop {
        if start.elapsed() > init_timeout {
            break;
        }

        let mut buf = [0u8; 4096];
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                initial_output.push_str(&String::from_utf8_lossy(&buf[..n]));
                // Check if we see signs of a ready prompt
                if initial_output.contains("$ ")
                    || initial_output.contains("> ")
                    || initial_output.contains("? ")
                    || initial_output.contains("claude>")
                    || initial_output.contains("codex>")
                {
                    break;
                }
            }
            Err(_) => break,
        }
    }

    // Send the slash command followed by Enter
    let slash_input = format!("{slash_command}\n");
    let _ = writer.write_all(slash_input.as_bytes());
    let _ = writer.flush();

    // Collect the response
    let mut response = String::new();
    let response_timeout = std::time::Duration::from_secs(15);
    let start = std::time::Instant::now();
    let mut quiet_since = None;
    let quiet_threshold = std::time::Duration::from_millis(2000);

    loop {
        if start.elapsed() > response_timeout {
            break;
        }

        let mut buf = [0u8; 4096];
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                response.push_str(&String::from_utf8_lossy(&buf[..n]));
                let saw_prompt = response.len() > 100
                    && (response.contains("$ ")
                        || response.contains("claude>")
                        || response.contains("codex>"));

                if saw_prompt {
                    quiet_since.get_or_insert_with(std::time::Instant::now);
                } else {
                    quiet_since = None;
                }
            }
            Err(_) => break,
        }

        // Check if we've been quiet for too long after getting content
        if let Some(quiet_start) = quiet_since {
            if quiet_start.elapsed() > quiet_threshold && !response.is_empty() {
                break;
            }
        }

        // Small sleep to avoid busy-looping
        thread::sleep(std::time::Duration::from_millis(50));
    }

    // Kill the child process
    let _ = child.kill();

    // Clean up the output: strip ANSI escape codes
    let cleaned = strip_ansi_codes(&response);

    // Check if the output looks like it contains useful information
    let has_useful_content = cleaned.lines().any(|line| {
        let trimmed = line.trim();
        !trimmed.is_empty()
            && trimmed.len() > 3
            && !trimmed.starts_with('\x1b')
            && !trimmed.starts_with('[')
    });

    if !has_useful_content && cleaned.trim().is_empty() {
        return CliUsageResult {
            tool: tool.clone(),
            output: String::new(),
            success: false,
            error: Some(format!(
                "{display_name} did not return any output for {slash_command}"
            )),
        };
    }

    CliUsageResult {
        tool: tool.clone(),
        output: cleaned.trim().to_string(),
        success: true,
        error: None,
    }
}

fn strip_ansi_codes(text: &str) -> String {
    enum EscapeState {
        None,
        Esc,
        Csi,
        Osc,
        OscEscape,
    }

    let mut result = String::with_capacity(text.len());
    let mut state = EscapeState::None;

    for ch in text.chars() {
        match state {
            EscapeState::None => {
                if ch == '\x1b' {
                    state = EscapeState::Esc;
                } else if ch == '\n' || ch == '\r' || ch == '\t' || !ch.is_control() {
                    result.push(ch);
                }
            }
            EscapeState::Esc => {
                state = match ch {
                    '[' => EscapeState::Csi,
                    ']' => EscapeState::Osc,
                    _ => EscapeState::None,
                };
            }
            EscapeState::Csi => {
                if ('@'..='~').contains(&ch) {
                    state = EscapeState::None;
                }
            }
            EscapeState::Osc => {
                if ch == '\u{7}' {
                    state = EscapeState::None;
                } else if ch == '\x1b' {
                    state = EscapeState::OscEscape;
                }
            }
            EscapeState::OscEscape => {
                state = if ch == '\\' {
                    EscapeState::None
                } else {
                    EscapeState::Osc
                };
            }
        }
    }

    result
        .lines()
        .map(|line| line.trim_end())
        .collect::<Vec<_>>()
        .join("\n")
}
