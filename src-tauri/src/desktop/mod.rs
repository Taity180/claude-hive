/// Navigate to the virtual desktop/workspace containing the given window and focus it.
///
/// The `handle` parameter is platform-specific:
/// - Windows: HWND (window handle)
/// - macOS: PID of the terminal process
/// - Linux: PID of the terminal process (X11 window looked up via xdotool)

// ── Windows ──────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub fn navigate_to_window(handle: u64) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        IsWindow, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    let hwnd = HWND(handle as *mut _);

    if !unsafe { IsWindow(hwnd) }.as_bool() {
        return Err("Window no longer exists".to_string());
    }

    // Switch to the virtual desktop containing this window
    match winvd::get_desktop_by_window(hwnd) {
        Ok(desktop) => {
            if let Err(e) = winvd::switch_desktop(desktop) {
                return Err(format!("Failed to switch desktop: {:?}", e));
            }
        }
        Err(e) => {
            tracing::warn!("Could not get desktop for window: {:?}", e);
        }
    }

    unsafe {
        let _ = ShowWindow(hwnd, SW_RESTORE);
        let _ = SetForegroundWindow(hwnd);
    }

    Ok(())
}

// ── macOS ────────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub fn navigate_to_window(handle: u64) -> Result<(), String> {
    // handle = PID of the terminal process
    // AppleScript activates the process, which causes macOS to switch to its Space
    // (if "When switching to an application, switch to a Space with open windows" is on)
    let pid = handle;
    let script = format!(
        r#"tell application "System Events"
            set targetProcess to first process whose unix id is {}
            set frontmost of targetProcess to true
        end tell"#,
        pid
    );

    let output = std::process::Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("Failed to run osascript: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("osascript failed: {}", stderr.trim()));
    }

    Ok(())
}

// ── Linux ────────────────────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
pub fn navigate_to_window(handle: u64) -> Result<(), String> {
    // handle = PID of the terminal process
    // Use xdotool to find the window by PID and activate it (switches workspace + focuses)
    let pid = handle;

    // First try xdotool (works on X11)
    let search = std::process::Command::new("xdotool")
        .args(["search", "--pid", &pid.to_string()])
        .output();

    match search {
        Ok(output) if output.status.success() => {
            let window_ids = String::from_utf8_lossy(&output.stdout);
            // Take the last window ID (usually the most relevant one)
            if let Some(wid) = window_ids.lines().last() {
                let activate = std::process::Command::new("xdotool")
                    .args(["windowactivate", wid.trim()])
                    .output()
                    .map_err(|e| format!("xdotool windowactivate failed: {}", e))?;

                if !activate.status.success() {
                    // Fallback: try wmctrl
                    let _ = std::process::Command::new("wmctrl")
                        .args(["-i", "-a", wid.trim()])
                        .output();
                }
                return Ok(());
            }
            Err("No window found for PID".to_string())
        }
        _ => {
            // xdotool not available, try wmctrl with PID
            let wmctrl = std::process::Command::new("wmctrl")
                .args(["-lp"])
                .output()
                .map_err(|e| format!("Neither xdotool nor wmctrl available: {}", e))?;

            if wmctrl.status.success() {
                let output = String::from_utf8_lossy(&wmctrl.stdout);
                // wmctrl -lp format: "0x... desktop pid hostname title"
                for line in output.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 3 {
                        if let Ok(line_pid) = parts[2].parse::<u64>() {
                            if line_pid == pid {
                                let _ = std::process::Command::new("wmctrl")
                                    .args(["-i", "-a", parts[0]])
                                    .output();
                                return Ok(());
                            }
                        }
                    }
                }
            }
            Err("Could not find or activate window".to_string())
        }
    }
}

// ── Fallback (other platforms) ───────────────────────────────────────────────

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
pub fn navigate_to_window(_handle: u64) -> Result<(), String> {
    Err("Desktop navigation is not supported on this platform".to_string())
}

// ── Pin window to all desktops ───────────────────────────────────────────────

#[cfg(windows)]
pub fn pin_to_all_desktops(hwnd_raw: u64) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    let hwnd = HWND(hwnd_raw as *mut _);
    match winvd::pin_window(hwnd) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to pin window: {:?}", e)),
    }
}

#[cfg(target_os = "macos")]
pub fn pin_to_all_desktops(_handle: u64) -> Result<(), String> {
    // macOS: windows with NSWindowCollectionBehavior.canJoinAllSpaces appear on all Spaces.
    // Tauri's always-on-top + this behavior should keep the window visible.
    // Setting this requires NSWindow access — Tauri handles this via alwaysOnTop config.
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn pin_to_all_desktops(_handle: u64) -> Result<(), String> {
    // On Linux, "sticky" windows appear on all workspaces.
    // wmctrl -r :ACTIVE: -b add,sticky
    // But since we don't have the hub's window ID here easily,
    // rely on Tauri's always-on-top which most WMs treat as sticky.
    Ok(())
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
pub fn pin_to_all_desktops(_handle: u64) -> Result<(), String> {
    Ok(())
}
