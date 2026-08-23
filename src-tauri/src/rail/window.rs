use crate::rail::geometry::{
    anchored_position, primary_index, rect_contains, target_index, Anchor, MonitorRect,
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const RAIL_LABEL: &str = "rail";

/// Append a line to `%TEMP%/hive-rail.log`.
///
/// A GUI process on Windows has no console of its own, and stdout redirected
/// through a pnpm shim gets swallowed — during development of this feature that
/// cost real time chasing a bug whose evidence was being discarded. Window
/// creation and every failure path record here so there is always a trail,
/// independent of how the process was launched. Deliberately not called from
/// the cursor-follow poll, which runs four times a second.
fn diag(msg: &str) {
    use std::io::Write;
    let path = std::env::temp_dir().join("hive-rail.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{msg}");
    }
}

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

/// Where the rail sits before its own JS has loaded and told us the user's
/// stored preference. Rust owns the first paint so a slow or broken webview
/// can never leave an invisible window parked at an OS default position.
const DEFAULT_ANCHOR: Anchor = Anchor::Right;
const DEFAULT_NUB: (u32, u32) = (32, 140);
const DEFAULT_OFFSET: i32 = 14;

/// Build the rail window, hidden, during `setup()`.
///
/// Undecorated, always on top, and kept out of the taskbar — it is a dock, not
/// a window you alt-tab to.
///
/// This MUST run before the event loop starts. `WebviewWindowBuilder::build()`
/// blocks until the webview is created, and once the event loop is running that
/// wait never completes — from a command worker thread *or* from
/// `run_on_main_thread`, because the closure is itself running on the loop it
/// would need to pump. The symptom is brutal to diagnose: no error, no panic,
/// just a window that half-exists and never paints. So the window is created
/// once here, up front, and `open_rail` only ever shows it.
pub fn create_hidden(app: &AppHandle) {
    if app.get_webview_window(RAIL_LABEL).is_some() {
        return;
    }

    diag("create_hidden: building window");
    let rail = WebviewWindowBuilder::new(app, RAIL_LABEL, WebviewUrl::App("index.html".into()))
        .title("Hive Rail")
        .inner_size(DEFAULT_NUB.0 as f64, DEFAULT_NUB.1 as f64)
        .decorations(false)
        // Transparent so the CSS alpha behind the opacity settings means
        // something. On an opaque window a translucent page renders white —
        // which is exactly what the rail looked like while this was being
        // debugged — so the window has to allow it, even though it paints a
        // solid ground at the default of full opacity.
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .visible(false)
        .build();

    let rail = match rail {
        Ok(w) => w,
        Err(e) => {
            diag(&format!("create_hidden: BUILD FAILED: {e}"));
            return;
        }
    };

    // Park it on an edge now, so the first frame after `show()` is already in
    // the right place rather than jumping once the rail's JS loads.
    match position_rail(app, &rail, DEFAULT_ANCHOR, DEFAULT_NUB, DEFAULT_OFFSET, None) {
        Ok(()) => diag("create_hidden: built and placed"),
        Err(e) => diag(&format!("create_hidden: placement FAILED: {e}")),
    }

    if std::env::var_os("HIVE_RAIL_AUTOOPEN").is_some() {
        diag("create_hidden: HIVE_RAIL_AUTOOPEN set, showing");
        // Same path as a real click, so the verification affordance cannot pass
        // while the button is broken.
        let _ = show(&rail);
    }
}

/// Show the rail and tell its webview it is on screen.
///
/// Safe from a command worker thread — `show()` is proxied to the event loop,
/// unlike window creation.
fn show(rail: &tauri::WebviewWindow) -> Result<(), String> {
    rail.show().map_err(|e| {
        diag(&format!("show FAILED: {e}"));
        e.to_string()
    })?;
    let _ = rail.set_always_on_top(true);
    diag(&format!(
        "show: is_visible={}, pos={:?}",
        rail.is_visible().unwrap_or(false),
        rail.outer_position().ok()
    ));
    // Starts the rail's cursor-follow poll, which stays idle while hidden.
    let _ = rail.emit("rail-visibility", true);
    Ok(())
}

#[tauri::command]
pub fn open_rail(app: AppHandle) -> Result<(), String> {
    let Some(rail) = app.get_webview_window(RAIL_LABEL) else {
        diag("open_rail: rail window missing — create_hidden did not run");
        return Err("rail window was not created at startup".into());
    };
    show(&rail)
}

#[tauri::command]
pub fn close_rail(app: AppHandle) -> Result<(), String> {
    if let Some(rail) = app.get_webview_window(RAIL_LABEL) {
        let _ = rail.emit("rail-visibility", false);
        rail.hide().map_err(|e| e.to_string())?;
        diag("close_rail: hidden");
    }
    Ok(())
}

/// Record a degraded-placement reason once per process.
///
/// `position_rail` runs four times a second while cursor-follow is on, so an
/// unguarded log here would write thousands of identical lines. Once is enough
/// to diagnose; repeating it only buries everything else.
fn warn_once(msg: &str) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static WARNED: AtomicBool = AtomicBool::new(false);
    if !WARNED.swap(true, Ordering::Relaxed) {
        diag(&format!("position_rail: {msg}"));
        tracing::warn!("rail: {msg}");
    }
}

/// Size and move `rail` against `anchor` on whichever monitor the cursor is on,
/// falling back to the first monitor when the cursor sits in dead space between
/// screens of different heights.
fn position_rail(
    app: &AppHandle,
    rail: &tauri::WebviewWindow,
    anchor: Anchor,
    size: (u32, u32),
    offset: i32,
    pinned: Option<usize>,
) -> Result<(), String> {
    let monitors = monitor_rects(app)?;
    if monitors.is_empty() {
        return Err("no monitors reported".into());
    }

    // Cursor position is best-effort. If it fails, or the cursor is in the dead
    // space between screens of different heights, `target_index` falls back to
    // the primary monitor rather than giving up — a rail on the wrong screen is
    // recoverable, an unplaced rail is not. A pin skips the question entirely.
    let cursor = match rail.cursor_position() {
        Ok(cursor) => Some((cursor.x as i32, cursor.y as i32)),
        Err(e) => {
            if pinned.is_none() {
                warn_once(&format!("cursor_position failed ({e}), using primary monitor"));
            }
            None
        }
    };
    let index = target_index(&monitors, pinned, cursor);

    let (x, y) = anchored_position(monitors[index], anchor, size, offset);

    rail.set_size(tauri::Size::Physical(tauri::PhysicalSize {
        width: size.0,
        height: size.1,
    }))
    .map_err(|e| e.to_string())?;
    rail.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::RAIL_LABEL;

    /// Capabilities are per-window in Tauri 2. A window missing from the
    /// capability's `windows` list gets no core plugin access, so its webview
    /// cannot invoke anything — and it fails silently, with no error in the
    /// Rust log and only a console message inside a window you cannot see.
    /// That exact omission shipped once; this test is why it cannot again.
    #[test]
    fn the_rail_window_is_granted_capabilities() {
        let raw = include_str!("../../capabilities/default.json");
        let parsed: serde_json::Value =
            serde_json::from_str(raw).expect("capabilities/default.json must be valid JSON");

        let windows = parsed["windows"]
            .as_array()
            .expect("capability must declare a windows list");
        let labels: Vec<&str> = windows.iter().filter_map(|w| w.as_str()).collect();

        assert!(
            labels.contains(&RAIL_LABEL),
            "the '{RAIL_LABEL}' window must be listed in capabilities/default.json, \
             otherwise its webview cannot invoke commands. Found: {labels:?}"
        );
        assert!(
            labels.contains(&"main"),
            "the 'main' window must stay listed. Found: {labels:?}"
        );
    }
}

/// Move and size the existing rail. Called from the rail's own window, four
/// times a second while cursor-follow is on.
///
/// Deliberately does not create the window: this runs on a command worker
/// thread, where `build()` would deadlock, and a caller that has no rail has
/// nothing to place. Resizing and moving an existing window is safe off the
/// main thread — Tauri proxies both.
#[tauri::command]
pub fn place_rail(
    app: AppHandle,
    anchor: String,
    width: u32,
    height: u32,
    offset: i32,
    monitor: Option<usize>,
) -> Result<(), String> {
    let anchor = Anchor::from_str_id(&anchor).ok_or_else(|| format!("unknown anchor: {anchor}"))?;
    let Some(rail) = app.get_webview_window(RAIL_LABEL) else {
        return Ok(());
    };
    position_rail(&app, &rail, anchor, (width, height), offset, monitor)
}

/// Is the cursor over the rail right now?
///
/// Hover-to-open cannot rely on the webview's own mouse events. A 32px strip at
/// the screen edge often never receives a `mouseenter`: with cursor-follow on it
/// worked only by accident, because repositioning the window four times a second
/// made Windows re-run hit-testing and synthesise the event. Pinned to a
/// monitor there is no poll, and hovering did nothing at all.
///
/// Asking for the cursor and the window rect is the same question without the
/// accident.
#[tauri::command]
pub fn cursor_over_rail(app: AppHandle) -> Result<bool, String> {
    let Some(rail) = app.get_webview_window(RAIL_LABEL) else {
        return Ok(false);
    };

    let cursor = rail.cursor_position().map_err(|e| e.to_string())?;
    let origin = rail.outer_position().map_err(|e| e.to_string())?;
    let size = rail.outer_size().map_err(|e| e.to_string())?;

    Ok(rect_contains(
        (origin.x, origin.y),
        (size.width, size.height),
        (cursor.x as i32, cursor.y as i32),
    ))
}

/// One screen, as the settings pane needs to describe it.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub index: usize,
    pub name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub primary: bool,
}

/// The monitors the rail can be pinned to, in enumeration order.
///
/// The index is the contract: it is what `place_rail` takes, and it is only
/// meaningful for as long as the display arrangement holds. An out-of-range pin
/// is ignored rather than fatal for exactly that reason.
#[tauri::command]
pub fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let Some(rail) = app.get_webview_window(RAIL_LABEL) else {
        return Ok(Vec::new());
    };
    let monitors = rail.available_monitors().map_err(|e| e.to_string())?;
    let rects = monitor_rects(&app)?;
    let primary = primary_index(&rects);

    Ok(monitors
        .iter()
        .enumerate()
        .map(|(index, m)| MonitorInfo {
            index,
            name: m.name().cloned(),
            width: m.size().width,
            height: m.size().height,
            x: m.position().x,
            y: m.position().y,
            primary: index == primary,
        })
        .collect())
}
