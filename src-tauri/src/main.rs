// Use console subsystem so MCP mode doesn't flash a GUI window.
// The dashboard mode hides the console window immediately on startup.

fn main() {
    // Check if we're running in MCP mode (before Tauri starts).
    // If not MCP mode, hide the console window so only the Tauri UI shows.
    let is_mcp = std::env::args().any(|a| a == "mcp");

    #[cfg(windows)]
    if !is_mcp {
        unsafe {
            use windows::Win32::System::Console::{GetConsoleWindow, FreeConsole};
            use windows::Win32::UI::WindowsAndMessaging::ShowWindow;
            use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;
            let console = GetConsoleWindow();
            if !console.0.is_null() {
                let _ = ShowWindow(console, SW_HIDE);
                let _ = FreeConsole();
            }
        }
    }

    claude_hive_lib::run();
}
