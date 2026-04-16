use std::{fs, process::Command};

use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::models::{AssistantSidebarProvider, ChatGptSidebarWindowRequest};

#[derive(Clone, Copy)]
struct SidebarProviderConfig {
    display_name: &'static str,
    sidebar_window_prefix: &'static str,
    url: &'static str,
}

pub fn open_sidebar_window(
    app: &AppHandle,
    request: ChatGptSidebarWindowRequest,
) -> Result<(), String> {
    let parent_window = app
        .get_webview_window(&request.parent_window_label)
        .ok_or_else(|| {
            format!(
                "Parent window '{}' was not found.",
                request.parent_window_label
            )
        })?;
    let provider_config = get_sidebar_provider_config(&request.provider);
    let sidebar_window = match app.get_webview_window(&sidebar_window_label(
        &request.parent_window_label,
        &request.provider,
    )) {
        Some(window) => window,
        None => build_sidebar_window(app, &parent_window, &request.provider, provider_config)?,
    };

    sync_sidebar_window_state(&parent_window, &sidebar_window, &request, provider_config)
}

pub fn sync_sidebar_window(
    app: &AppHandle,
    request: ChatGptSidebarWindowRequest,
) -> Result<(), String> {
    open_sidebar_window(app, request)
}

pub fn close_sidebar_window(
    app: &AppHandle,
    parent_window_label: String,
    provider: AssistantSidebarProvider,
) -> Result<(), String> {
    let provider_config = get_sidebar_provider_config(&provider);

    if let Some(window) =
        app.get_webview_window(&sidebar_window_label(&parent_window_label, &provider))
    {
        window.destroy().map_err(|error| {
            format!(
                "Failed to destroy {} sidebar window: {error}",
                provider_config.display_name
            )
        })?;
    }

    Ok(())
}

fn build_sidebar_window(
    app: &AppHandle,
    parent_window: &WebviewWindow,
    provider: &AssistantSidebarProvider,
    provider_config: SidebarProviderConfig,
) -> Result<WebviewWindow, String> {
    let label = sidebar_window_label(parent_window.label(), provider);
    let url = WebviewUrl::External(
        provider_config
            .url
            .parse()
            .map_err(|error| format!("Invalid {} URL: {error}", provider_config.display_name))?,
    );
    let mut data_directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Failed to resolve app cache dir: {error}"))?;

    data_directory.push(provider_config.sidebar_window_prefix);

    fs::create_dir_all(&data_directory).map_err(|error| {
        format!(
            "Failed to create {} sidebar data dir: {error}",
            provider_config.display_name
        )
    })?;

    let builder = WebviewWindowBuilder::new(app, &label, url)
        .decorations(false)
        .focused(false)
        .inner_size(1.0, 1.0)
        .position(0.0, 0.0)
        .resizable(false)
        .skip_taskbar(true)
        .title(provider_config.display_name)
        .visible(false)
        .data_directory(data_directory)
        .parent(parent_window)
        .map_err(|error| {
            format!(
                "Failed to attach {} sidebar window: {error}",
                provider_config.display_name
            )
        })?;

    builder.build().map_err(|error| {
        format!(
            "Failed to build {} sidebar window: {error}",
            provider_config.display_name
        )
    })
}

fn sync_sidebar_window_state(
    parent_window: &WebviewWindow,
    sidebar_window: &WebviewWindow,
    request: &ChatGptSidebarWindowRequest,
    provider_config: SidebarProviderConfig,
) -> Result<(), String> {
    if request.width < 1 || request.height < 1 {
        sidebar_window.hide().map_err(|error| {
            format!(
                "Failed to hide {} sidebar window: {error}",
                provider_config.display_name
            )
        })?;
        return Ok(());
    }

    if parent_window
        .is_minimized()
        .map_err(|error| format!("Failed to read parent window minimized state: {error}"))?
        || !parent_window
            .is_visible()
            .map_err(|error| format!("Failed to read parent window visibility: {error}"))?
    {
        sidebar_window.hide().map_err(|error| {
            format!(
                "Failed to hide {} sidebar window: {error}",
                provider_config.display_name
            )
        })?;
        return Ok(());
    }

    sidebar_window
        .set_position(PhysicalPosition::new(request.x, request.y))
        .map_err(|error| {
            format!(
                "Failed to move {} sidebar window: {error}",
                provider_config.display_name
            )
        })?;
    sidebar_window
        .set_size(PhysicalSize::new(request.width, request.height))
        .map_err(|error| {
            format!(
                "Failed to resize {} sidebar window: {error}",
                provider_config.display_name
            )
        })?;
    sidebar_window.show().map_err(|error| {
        format!(
            "Failed to show {} sidebar window: {error}",
            provider_config.display_name
        )
    })?;

    Ok(())
}

fn sidebar_window_label(parent_window_label: &str, provider: &AssistantSidebarProvider) -> String {
    let provider_config = get_sidebar_provider_config(provider);

    format!(
        "{}:{parent_window_label}",
        provider_config.sidebar_window_prefix
    )
}

fn get_sidebar_provider_config(provider: &AssistantSidebarProvider) -> SidebarProviderConfig {
    match provider {
        AssistantSidebarProvider::Chatgpt => SidebarProviderConfig {
            display_name: "ChatGPT",
            sidebar_window_prefix: "chatgpt-sidebar",
            url: "https://chatgpt.com",
        },
        AssistantSidebarProvider::Claude => SidebarProviderConfig {
            display_name: "Claude",
            sidebar_window_prefix: "claude-sidebar",
            url: "https://claude.ai",
        },
    }
}

pub fn open_external_url(url: &str) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http(s) URLs can be opened externally.".into());
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to open external URL: {error}"))
}
