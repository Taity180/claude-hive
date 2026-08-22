use crate::rail::geometry::{anchored_position, monitor_containing, Anchor, MonitorRect};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const RAIL_LABEL: &str = "rail";

/// Every monitor's rect in physical pixels, in the order the OS reports them.
pub fn monitor_rects(app: &AppHandle) -> Result<Vec<MonitorRect>, String> {
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors
        .iter()
        .map(|m| MonitorRect {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
        })
        .collect())
}

/// The rail webview, created on first use. Undecorated, always on top, and
/// kept out of the taskbar — it is a dock, not a window you alt-tab to.
fn ensure_rail(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(RAIL_LABEL) {
        return Ok(existing);
    }
    WebviewWindowBuilder::new(app, RAIL_LABEL, WebviewUrl::App("index.html".into()))
        .title("Hive Rail")
        .inner_size(32.0, 140.0)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_rail(app: AppHandle) -> Result<(), String> {
    let rail = ensure_rail(&app)?;
    rail.show().map_err(|e| e.to_string())?;
    rail.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_rail(app: AppHandle) -> Result<(), String> {
    if let Some(rail) = app.get_webview_window(RAIL_LABEL) {
        rail.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Size and place the rail against `anchor` on whichever monitor the cursor is
/// on, falling back to the first monitor when the cursor sits in dead space
/// between screens of different heights.
#[tauri::command]
pub fn place_rail(
    app: AppHandle,
    anchor: String,
    width: u32,
    height: u32,
    offset: i32,
) -> Result<(), String> {
    let anchor = Anchor::from_str_id(&anchor).ok_or_else(|| format!("unknown anchor: {anchor}"))?;
    let rail = ensure_rail(&app)?;
    let monitors = monitor_rects(&app)?;
    if monitors.is_empty() {
        return Err("no monitors reported".into());
    }

    let cursor = rail.cursor_position().map_err(|e| e.to_string())?;
    let index = monitor_containing(&monitors, (cursor.x as i32, cursor.y as i32)).unwrap_or(0);
    let (x, y) = anchored_position(monitors[index], anchor, (width, height), offset);

    rail.set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }))
        .map_err(|e| e.to_string())?;
    rail.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())
}
