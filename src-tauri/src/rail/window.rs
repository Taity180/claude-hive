use std::sync::atomic::{AtomicU64, Ordering};

use crate::rail::geometry::{
    anchored_position, primary_index, rect_contains, target_index, Anchor, MonitorRect, Rect,
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
        // Both the window and the webview default to white, and it shows: a
        // resize exposes area the page has not painted yet, and Win32 and
        // WebView2 fill it with their own background until it does. That is the
        // white flash before the panel appears — nothing to do with the page,
        // which is why no amount of CSS moved it.
        .background_color(tauri::window::Color(0, 0, 0, 0))
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

/// Show the rail, placed before it appears.
///
/// The geometry is optional but should always be passed. Showing first and
/// letting the frontend place it afterwards is a visible flash: the window
/// appears wherever it was last left — the wrong monitor, or the nub's old
/// rect — and only then jumps to where it belongs. The frontend cannot avoid
/// that on its own, because it does not know the window is visible until the
/// event that arrives after the fact.
#[tauri::command]
pub fn open_rail(
    app: AppHandle,
    anchor: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    offset: Option<i32>,
    monitor: Option<usize>,
) -> Result<(), String> {
    let Some(rail) = app.get_webview_window(RAIL_LABEL) else {
        diag("open_rail: rail window missing — create_hidden did not run");
        return Err("rail window was not created at startup".into());
    };

    if let (Some(anchor), Some(width), Some(height), Some(offset)) =
        (anchor.as_deref(), width, height, offset)
    {
        match Anchor::from_str_id(anchor) {
            // Placed while still hidden, so there is nothing to see move.
            Some(anchor) => {
                if let Err(e) =
                    position_rail(&app, &rail, anchor, (width, height), offset, monitor)
                {
                    // Showing it in the wrong place beats not showing it.
                    diag(&format!("open_rail: placement failed ({e}), showing anyway"));
                }
            }
            None => diag(&format!("open_rail: unknown anchor {anchor}, showing as-is")),
        }
    }

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
/// Last monitor the rail was placed on, so a change can be logged without
/// logging the four placements a second that do not move it.
static LAST_MONITOR: AtomicU64 = AtomicU64::new(u64::MAX);

fn apply_rect(rail: &tauri::WebviewWindow, rect: Rect, growing: bool) -> Result<(), String> {
    let position = tauri::Position::Physical(tauri::PhysicalPosition { x: rect.x, y: rect.y });
    let size = tauri::Size::Physical(tauri::PhysicalSize {
        width: rect.width,
        height: rect.height,
    });

    // Tauri has no atomic move-and-resize for a window, so there is always one
    // frame between the two calls. Which order puts that frame somewhere
    // harmless depends on the direction: growing, move first and the frame is
    // inside the final rect; shrinking, resize first. The wrong order leaves the
    // window briefly hanging off the screen edge.
    if growing {
        rail.set_position(position).map_err(|e| e.to_string())?;
        rail.set_size(size).map_err(|e| e.to_string())
    } else {
        rail.set_size(size).map_err(|e| e.to_string())?;
        rail.set_position(position).map_err(|e| e.to_string())
    }
}

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

    // Only when it actually changes screen: this runs four times a second.
    let previous = LAST_MONITOR.swap(index as u64, Ordering::SeqCst);
    if previous != index as u64 {
        diag(&format!(
            "place_rail: monitor {previous} -> {index}, size {}x{}",
            size.0, size.1
        ));
    }

    let (x, y) = anchored_position(monitors[index], anchor, size, offset);
    let target = Rect {
        x,
        y,
        width: size.0,
        height: size.1,
    };

    let growing = rail
        .outer_size()
        .map(|current| size.0 > current.width || size.1 > current.height)
        .unwrap_or(false);

    apply_rect(rail, target, growing)
}

/// Deliberately does not create the window: this runs on a command worker
/// thread, where `build()` would deadlock, and a caller that has no rail has
/// nothing to place. Resizing and moving an existing window is safe off the
/// main thread — Tauri proxies both.
/// Resize and reposition while hidden, then show.
///
/// The flash was never the page. For one frame after the OS resizes a visible
/// window, the webview's viewport has not caught up, so the page cannot paint
/// the newly exposed area and whatever is behind it — the window background,
/// the acrylic backdrop, Windows' own rounded-corner fill — shows instead. No
/// amount of painting earlier can help, because the page is not allowed to draw
/// there yet.
///
/// So the resize happens off screen. Hidden, resized, shown: the window is only
/// ever visible at a size the page has already laid out for.
#[tauri::command]
pub fn reopen_rail(
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

    let was_visible = rail.is_visible().unwrap_or(false);
    if was_visible {
        rail.hide().map_err(|e| e.to_string())?;
    }
    let placed = position_rail(&app, &rail, anchor, (width, height), offset, monitor);
    if was_visible {
        // Show it again whatever placement did: a hidden rail is worse than a
        // badly placed one.
        rail.show().map_err(|e| e.to_string())?;
        let _ = rail.set_always_on_top(true);
    }
    placed
}

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
