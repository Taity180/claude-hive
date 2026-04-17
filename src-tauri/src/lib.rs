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

// Convert a logical pixel dimension to physical pixels, rounding to the
// nearest u32. Used so resizes round-trip cleanly without floating-point drift.
fn to_physical(logical: f64, scale_factor: f64) -> u32 {
    let scale = if scale_factor > 0.0 { scale_factor } else { 1.0 };
    (logical * scale).round().max(0.0) as u32
}

fn scale_factor(window: &tauri::Window) -> Result<f64, String> {
    let monitor = window.current_monitor().map_err(|e| e.to_string())?;
    Ok(monitor.map(|m| m.scale_factor()).unwrap_or(1.0))
}

/// Resize the window to `height` logical pixels while preserving its current width.
///
/// All math happens in physical pixels to avoid a feedback loop that bit 1.0.1:
/// `outer_size()` on Windows reports a value that includes the non-client frame,
/// but `set_size()` sets the inner (client) area. Reading outer and writing it
/// back as a Logical size grew the outer width a few px per call, and because
/// the ResizeObserver on the collapsed content keeps firing as layout reflows,
/// the window expanded indefinitely. We now read `inner_size()` (physical) and
/// hand Tauri a `PhysicalSize` directly so width is preserved bit-for-bit.
#[tauri::command]
fn resize_preserving_width(window: tauri::Window, height: f64) -> Result<(), String> {
    let scale = scale_factor(&window)?;
    let current = window.inner_size().map_err(|e| e.to_string())?;
    let target_height = to_physical(height, scale);
    if current.height == target_height {
        return Ok(()); // No-op — skip redundant calls the observer may trigger.
    }
    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: current.width,
            height: target_height,
        }))
        .map_err(|e| e.to_string())
}

/// Return the current window inner size in logical pixels as `[width, height]`.
/// Used by the frontend to remember the user's expanded height before collapsing.
#[tauri::command]
fn get_logical_size(window: tauri::Window) -> Result<(f64, f64), String> {
    let scale = scale_factor(&window)?;
    let physical = window.inner_size().map_err(|e| e.to_string())?;
    Ok((to_logical(physical.width, scale), to_logical(physical.height, scale)))
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

    #[test]
    fn to_physical_multiplies_and_rounds_to_u32() {
        assert_eq!(to_physical(1920.0, 1.0), 1920);
        assert_eq!(to_physical(1600.0, 1.5), 2400);
        assert_eq!(to_physical(400.25, 2.0), 801); // 800.5 rounds up
        assert_eq!(to_physical(400.2, 2.0), 800); // 800.4 rounds down
    }

    #[test]
    fn to_physical_falls_back_when_scale_is_zero_or_negative() {
        assert_eq!(to_physical(800.0, 0.0), 800);
        assert_eq!(to_physical(800.0, -2.0), 800);
    }

    #[test]
    fn to_physical_clamps_negative_inputs_to_zero() {
        // Defensive: a negative computed height would wrap to a huge u32.
        assert_eq!(to_physical(-10.0, 1.5), 0);
    }

    #[test]
    fn logical_physical_round_trip_is_stable() {
        // The 1.0.1 bug was a round-trip that drifted because we used
        // set_size(Logical) where Logical → Physical rounding could grow the
        // stored size. With to_physical used for the write path, re-reading
        // via to_logical and writing back lands on the same physical value.
        for &physical_width in &[500u32, 501, 523, 1234, 1600, 1919, 3840] {
            for &scale in &[1.0, 1.25, 1.5, 1.75, 2.0] {
                let logical = to_logical(physical_width, scale);
                let back = to_physical(logical, scale);
                assert_eq!(
                    back, physical_width,
                    "round trip drifted for physical={} scale={}",
                    physical_width, scale
                );
            }
        }
    }
}
