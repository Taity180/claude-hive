pub mod desktop;
pub mod mcp;
pub mod models;
pub mod server;
pub mod state;
pub mod tray_badge;

use clap::{Parser, Subcommand};
use tauri::Manager;
use std::sync::Mutex;

#[derive(Parser)]
#[command(name = "claude-hive")]
#[command(about = "Claude Hive - Floating dashboard for Claude Code sessions")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Run as MCP server (stdio transport)
    Mcp,
}

// Convert a physical pixel dimension to logical pixels given the monitor's scale factor.
// Extracted so the math can be unit tested without a live webview.
fn to_logical(physical: u32, scale_factor: f64) -> f64 {
    if scale_factor > 0.0 {
        physical as f64 / scale_factor
    } else {
        physical as f64
    }
}

fn window_logical_size(window: &tauri::Window) -> Result<(f64, f64), String> {
    let monitor = window.current_monitor().map_err(|e| e.to_string())?;
    let scale = monitor.map(|m| m.scale_factor()).unwrap_or(1.0);
    let physical = window.outer_size().map_err(|e| e.to_string())?;
    Ok((to_logical(physical.width, scale), to_logical(physical.height, scale)))
}

/// Resize the window to `height` logical pixels while preserving its current logical width.
/// Keeps the math on the Rust side so the frontend doesn't need the `core:window` capability
/// for `currentMonitor` / `outerSize`.
#[tauri::command]
fn resize_preserving_width(window: tauri::Window, height: f64) -> Result<(), String> {
    let (width, _) = window_logical_size(&window)?;
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }))
        .map_err(|e| e.to_string())
}

/// Return the current window size in logical pixels as `[width, height]`.
/// Used by the frontend to remember the user's expanded height before collapsing.
#[tauri::command]
fn get_logical_size(window: tauri::Window) -> Result<(f64, f64), String> {
    window_logical_size(&window)
}

#[tauri::command]
fn configure_claude_code() -> Result<String, String> {
    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let settings_dir = home.join(".claude");
    let settings_path = settings_dir.join("settings.json");

    std::fs::create_dir_all(&settings_dir).map_err(|e| e.to_string())?;

    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let mcp_servers = settings
        .as_object_mut()
        .ok_or("Settings is not an object")?
        .entry("mcpServers")
        .or_insert(serde_json::json!({}));

    mcp_servers
        .as_object_mut()
        .ok_or("mcpServers is not an object")?
        .insert(
            "claude-hive".to_string(),
            serde_json::json!({
                "command": "claude-hive",
                "args": ["mcp"]
            }),
        );

    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&settings_path, content).map_err(|e| e.to_string())?;

    Ok(settings_path.to_string_lossy().to_string())
}

#[tauri::command]
fn navigate_to_session(session_handle: u64) -> Result<(), String> {
    desktop::navigate_to_window(session_handle)
}

// Store base icon bytes and tray icon ID for badge updates
struct TrayState {
    base_icon: Vec<u8>,
    tray_id: Option<tauri::tray::TrayIconId>,
}

#[tauri::command]
fn update_tray_badge(app: tauri::AppHandle, count: u32) {
    let state = app.state::<Mutex<TrayState>>();
    let state = state.lock().unwrap();
    if let Some(ref tray_id) = state.tray_id {
        if let Some(tray) = app.tray_by_id(tray_id) {
            match tray_badge::create_badged_icon(&state.base_icon, count) {
                Ok(icon) => { let _ = tray.set_icon(Some(icon)); }
                Err(e) => tracing::warn!("Failed to update tray badge: {}", e),
            }
        }
    }
}

#[tauri::command]
fn minimize_window(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
fn hide_window(window: tauri::Window) {
    let _ = window.hide();
}

#[tauri::command]
fn start_dragging(window: tauri::Window) {
    let _ = window.start_dragging();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();

    match cli.command {
        Some(Commands::Mcp) => {
            let port: u16 = std::env::var("CLAUDE_HIVE_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(9400);
            let hub_url = format!("http://localhost:{}", port);
            let mut handler = mcp::McpHandler::new(hub_url);
            handler.run();
        }
        None => {
            // Start Axum HTTP+WS server in background
            let state = server::AppState::new();

            let port: u16 = std::env::var("CLAUDE_HIVE_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(9400);

            let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));

            // Find dist directory for LAN static serving
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf()));
            let static_dir = exe_dir.and_then(|dir| {
                let candidates = vec![
                    dir.join("dist"),
                    dir.join("../dist"),
                    dir.join("../../dist"),
                ];
                candidates.into_iter().find(|p| p.exists())
            });

            let app = server::create_router(state.clone(), static_dir);

            // Spawn the HTTP server on a background tokio task
            std::thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
                rt.block_on(async {
                    // Start background task to prune stale sessions
                    server::start_session_pruner(state);

                    let listener = tokio::net::TcpListener::bind(addr)
                        .await
                        .expect("failed to bind HTTP server");
                    tracing::info!("Claude Hive server listening on {}", addr);
                    axum::serve(listener, app)
                        .await
                        .expect("HTTP server error");
                });
            });

            // Launch Tauri GUI app
            // Load base icon bytes for badge generation
            let base_icon_bytes = include_bytes!("../icons/32x32.png").to_vec();

            tauri::Builder::default()
                .plugin(tauri_plugin_notification::init())
                .plugin(tauri_plugin_shell::init())
                .manage(Mutex::new(TrayState {
                    base_icon: base_icon_bytes,
                    tray_id: None,
                }))
                .setup(|app| {
                    use tauri::{
                        menu::{Menu, MenuItem},
                        tray::TrayIconBuilder,
                    };

                    let show = MenuItem::with_id(app, "show", "Show Claude Hive", true, None::<&str>)?;
                    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                    let menu = Menu::with_items(app, &[&show, &quit])?;

                    let tray = TrayIconBuilder::new()
                        .icon(app.default_window_icon().cloned().unwrap())
                        .menu(&menu)
                        .tooltip("Claude Hive")
                        .on_menu_event(|app, event| {
                            match event.id.as_ref() {
                                "show" => {
                                    if let Some(window) = app.get_webview_window("main") {
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                    }
                                }
                                "quit" => {
                                    app.exit(0);
                                }
                                _ => {}
                            }
                        })
                        .build(app)?;

                    // Store tray ID for badge updates
                    let tray_state = app.state::<Mutex<TrayState>>();
                    tray_state.lock().unwrap().tray_id = Some(tray.id().clone());

                    // Pin the main window to all virtual desktops
                    #[cfg(windows)]
                    {
                        if let Some(window) = app.get_webview_window("main") {
                            match window.hwnd() {
                                Ok(hwnd) => {
                                    let hwnd_raw = hwnd.0 as u64;
                                    tracing::info!("Attempting to pin window HWND={} to all desktops", hwnd_raw);
                                    // Retry pinning after a short delay — the virtual desktop service
                                    // may not be ready immediately at window creation
                                    let hwnd_raw_clone = hwnd_raw;
                                    std::thread::spawn(move || {
                                        std::thread::sleep(std::time::Duration::from_millis(500));
                                        if let Err(e) = crate::desktop::pin_to_all_desktops(hwnd_raw_clone) {
                                            tracing::warn!("Failed to pin window to all desktops: {}", e);
                                        } else {
                                            tracing::info!("Hub window pinned to all virtual desktops");
                                        }
                                    });
                                }
                                Err(e) => {
                                    tracing::warn!("Could not get window HWND: {}", e);
                                }
                            }
                        } else {
                            tracing::warn!("Could not find main window for pinning");
                        }
                    }

                    Ok(())
                })
                .invoke_handler(tauri::generate_handler![
                    resize_preserving_width,
                    get_logical_size,
                    configure_claude_code,
                    navigate_to_session,
                    minimize_window,
                    hide_window,
                    start_dragging,
                    update_tray_badge
                ])
                .run(tauri::generate_context!())
                .expect("error while running tauri application");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_logical_divides_by_scale_factor() {
        assert_eq!(to_logical(1920, 1.0), 1920.0);
        assert_eq!(to_logical(3840, 2.0), 1920.0);
        assert_eq!(to_logical(2400, 1.5), 1600.0);
    }

    #[test]
    fn to_logical_falls_back_when_scale_is_zero_or_negative() {
        // Defensive: if the monitor reports a bogus scale factor we return the
        // raw physical value rather than dividing by zero.
        assert_eq!(to_logical(800, 0.0), 800.0);
        assert_eq!(to_logical(800, -1.0), 800.0);
    }
}
