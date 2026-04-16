mod chatgpt;
mod commands;
mod models;
mod preview;
mod terminal;
mod workspaces;

use preview::ChangePreviewManager;
use terminal::TerminalManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalManager::default())
        .manage(ChangePreviewManager::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_recent_workspaces,
            commands::open_workspace,
            commands::remove_recent_workspace,
            commands::launch_workspace_target,
            commands::list_workspace_editors,
            commands::launch_workspace_editor,
            commands::list_workspace_branches,
            commands::checkout_workspace_branch,
            commands::create_terminal_session,
            commands::write_terminal_input,
            commands::resize_terminal_session,
            commands::close_terminal_session,
            commands::list_terminal_sessions,
            commands::start_change_preview,
            commands::stop_change_preview,
            commands::get_change_preview_snapshot,
            commands::get_cli_tool_status,
            commands::get_cli_usage,
            commands::open_chatgpt_sidebar_window,
            commands::sync_chatgpt_sidebar_window,
            commands::close_chatgpt_sidebar_window,
            commands::open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
